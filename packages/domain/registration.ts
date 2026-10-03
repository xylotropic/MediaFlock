import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import type { User } from "@supabase/supabase-js";
import { z } from "zod";
import { db, type Tx } from "../db";
import { boundedBody } from "../security";
import { getConfig } from "./config";
import { DomainError, requireCondition } from "./errors";

function quota(name: string, fallback: number, maximum: number) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 1 || value > maximum)
    throw new Error(`${name} must be an integer between 1 and ${maximum}.`);
  return value;
}

export function registrationSettings() {
  return {
    enabled: process.env.MEDIAFLOCK_SELF_SIGNUP_ENABLED === "true",
    emailDeliveryEnabled: process.env.MEDIAFLOCK_AUTH_EMAIL_ENABLED === "true",
    dailyWorkspaces: quota("MEDIAFLOCK_SIGNUP_DAILY_WORKSPACES", 25, 1000),
    maxWorkspaces: quota("MEDIAFLOCK_SIGNUP_MAX_WORKSPACES", 500, 10000),
  };
}

export function requireRegistrationEnabled() {
  requireCondition(
    registrationSettings().enabled,
    "signup_unavailable",
    "Account creation is temporarily unavailable. Try again later.",
    403,
  );
}

export function requireAuthEmailEnabled() {
  requireCondition(
    registrationSettings().emailDeliveryEnabled,
    "email_unavailable",
    "Email confirmation and password reset are not available yet.",
    503,
  );
}

export function cleanName(value: unknown) {
  return typeof value === "string"
    ? value
        .replace(/[\u0000-\u001f\u007f-\u009f]/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 80)
    : "";
}

export function validTimezone(value: unknown) {
  if (typeof value !== "string" || value.length > 80) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const passwordInput = z
  .string()
  .min(12, "Use a password with at least 12 characters.")
  .max(200, "Use a password with no more than 200 characters.");
export const emailInput = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email("Enter a valid email address."));
export const signupInput = z
  .object({
    email: emailInput,
    password: passwordInput,
    name: z
      .string()
      .max(80, "Use a name with no more than 80 characters.")
      .optional()
      .transform(cleanName),
    timezone: z
      .string()
      .max(80)
      .refine(validTimezone, "Choose a valid timezone.")
      .optional(),
  })
  .strict();

export async function registrationBody<T>(
  req: Request,
  schema: z.ZodType<T>,
): Promise<T> {
  requireCondition(
    req.headers.get("content-type")?.split(";")[0].trim() ===
      "application/json",
    "invalid_request",
    "Send account details as JSON.",
    415,
  );
  let data: unknown;
  try {
    data = JSON.parse(
      Buffer.from(await boundedBody(req, 4096)).toString("utf8"),
    );
  } catch (error) {
    if (error instanceof DomainError) throw error;
    throw new DomainError(
      "invalid_request",
      "Check the account details and try again.",
    );
  }
  const parsed = schema.safeParse(data);
  if (!parsed.success)
    throw new DomainError(
      "invalid_request",
      parsed.error.issues[0]?.message ||
        "Check the account details and try again.",
    );
  return parsed.data;
}

// No raw email addresses or client IPs are stored in the rate-limit table.
export function clientAddressHash(req: Request) {
  // Vercel overwrites these headers at its edge. Direct local requests cannot
  // supply a trusted client IP, so they share a conservative fallback bucket.
  const forwarded =
    process.env.VERCEL === "1"
      ? req.headers.get("x-vercel-forwarded-for") ||
        req.headers.get("x-forwarded-for") ||
        ""
      : "";
  const candidate = forwarded.split(",")[0].trim();
  return createHash("sha256")
    .update(isIP(candidate) ? candidate : "unknown")
    .digest("hex");
}
export type RegistrationPurpose =
  | "signup"
  | "resend"
  | "email_recover"
  | "recovery_code"
  | "recovery_generate"
  | "password_reset";
export async function registrationRateLimit(
  req: Request,
  email?: string,
  purpose: RegistrationPurpose = "signup",
) {
  const digest = (value: string) =>
    createHash("sha256").update(value).digest("hex");
  const prefix = "account:" + purpose + ":";
  const keys: Array<[string, number]> = [
    [prefix + "ip:" + clientAddressHash(req), 12],
  ];
  if (email) keys.push([prefix + "email:" + digest(email), 4]);
  keys.push([prefix + "global", 120]);
  const tx = await db().connect();
  try {
    await tx.query("begin");
    // A rejected source cannot spend a shared budget or any other bucket.
    // All buckets use the transaction's same hourly window and commit together.
    for (const [key, maximum] of keys) {
      const result = await tx.query(
        "insert into request_limits(key,window_at,count) values($1,date_trunc('hour',now()),1) on conflict(key,window_at) do update set count=request_limits.count+1 returning count",
        [key],
      );
      requireCondition(
        result.rows[0].count <= maximum,
        "rate_limited",
        "Too many account requests. Try again later.",
        429,
      );
    }
    await tx.query("commit");
  } catch (error) {
    await tx.query("rollback");
    throw error;
  } finally {
    tx.release();
  }
}

async function checkCapacity(tx: Pick<Tx, "query">) {
  const settings = registrationSettings();
  const counts = (
    await tx.query(
      "select count(*)::integer as total,count(*) filter (where created_at>=date_trunc('day',now()))::integer as today from self_service_registrations where mode=$1",
      [getConfig().mode],
    )
  ).rows[0];
  requireCondition(
    counts.total < settings.maxWorkspaces &&
      counts.today < settings.dailyWorkspaces,
    "signup_capacity",
    "Account creation is temporarily at capacity. Try again later.",
    503,
  );
}

export async function checkRegistrationCapacity() {
  await checkCapacity(db());
}

export interface WorkspaceMembership {
  workspace_id: string;
  role: "owner" | "reviewer" | "editor" | "viewer";
  mode: "demo" | "live";
}

// Call only with a user returned by Auth getUser, never client-provided metadata.
export async function ensureRegisteredWorkspace(
  user: User,
): Promise<WorkspaceMembership> {
  requireCondition(
    user.email && user.email_confirmed_at && !user.is_anonymous,
    "confirmation_required",
    "Confirm your email address before opening your workspace.",
    403,
  );
  const tx = await db().connect();
  try {
    await tx.query("begin");
    // A user lock makes repeated logins/callbacks idempotent. A global lock
    // serializes quota checks and allocations across concurrent new accounts.
    await tx.query(
      "select pg_advisory_xact_lock(hashtextextended($1,721041324))",
      [user.id],
    );
    const existing = (
      await tx.query<WorkspaceMembership>(
        "select m.workspace_id,m.role,w.mode from memberships m join workspaces w on w.id=m.workspace_id where m.user_id=$1 and w.mode=$2 order by w.created_at limit 1",
        [user.id, getConfig().mode],
      )
    ).rows[0];
    if (existing) {
      await tx.query("commit");
      return existing;
    }
    requireRegistrationEnabled();
    await tx.query("select pg_advisory_xact_lock(721041324)");
    await checkCapacity(tx);
    const name = cleanName(user.user_metadata?.full_name);
    const timezone = validTimezone(user.user_metadata?.timezone)
      ? user.user_metadata.timezone
      : "America/New_York";
    const workspace = (
      await tx.query(
        "insert into workspaces(name,timezone,mode) values($1,$2,$3) returning id,mode",
        [
          name ? `${name}'s workspace` : "Your workspace",
          timezone,
          getConfig().mode,
        ],
      )
    ).rows[0];
    await tx.query(
      "insert into memberships(workspace_id,user_id,role) values($1,$2,'owner')",
      [workspace.id, user.id],
    );
    await tx.query(
      "insert into self_service_registrations(user_id,workspace_id,mode) values($1,$2,$3)",
      [user.id, workspace.id, workspace.mode],
    );
    await tx.query(
      "insert into audit_events(workspace_id,actor_id,actor_kind,action,resource_type,resource_id,details) values($1,$2,'human','workspace.created','workspace',$1,'{\"source\":\"self_service\"}')",
      [workspace.id, user.id],
    );
    await tx.query("commit");
    return { workspace_id: workspace.id, role: "owner", mode: workspace.mode };
  } catch (error) {
    await tx.query("rollback");
    throw error;
  } finally {
    tx.release();
  }
}

export const recoveryCookie = "mediaflock-recovery";
export function authRedirect(path: string) {
  return new Response(null, {
    status: 303,
    headers: {
      Location: getConfig().origin + path,
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}
export function recoveryGrant(userId: string, now = Date.now()) {
  const payload = `${userId}:${Math.floor(now / 1000) + 900}`;
  return (
    payload +
    ":" +
    createHmac("sha256", getConfig().csrfSecret)
      .update("password-recovery:" + payload)
      .digest("hex")
  );
}
export function validRecoveryGrant(
  value: string,
  userId: string,
  now = Date.now(),
) {
  const [id, expires, signature, extra] = value.split(":");
  if (
    id !== userId ||
    extra ||
    !/^\d+$/.test(expires || "") ||
    !/^[a-f0-9]{64}$/.test(signature || "")
  )
    return false;
  const remaining = Number(expires) - Math.floor(now / 1000);
  if (remaining <= 0 || remaining > 900) return false;
  const expected = createHmac("sha256", getConfig().csrfSecret)
    .update(`password-recovery:${id}:${expires}`)
    .digest();
  return timingSafeEqual(expected, Buffer.from(signature, "hex"));
}
