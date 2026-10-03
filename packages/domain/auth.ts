import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { getConfig } from "./config";
import { requireCondition } from "./errors";
import { db, scoped, audit, one, type Context } from "../db";
import { tokenInput } from "../schemas";
import { ensureRegisteredWorkspace } from "./registration";
import { validateHumanSession, verifiedSessionId } from "./session-security";
import { localRequestAuthority } from "./local-request";
export const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value !== null && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ":" + canonical(v))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
export const contentHash = (value: unknown) => hash(canonical(value));
export function storageAdmin() {
  const c = getConfig();
  return createClient(c.supabaseUrl, c.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
export async function authClient(options: { timeoutMs?: number } = {}) {
  const c = getConfig(),
    jar = await cookies();
  return createServerClient(c.supabaseUrl, c.anonKey, {
    ...(options.timeoutMs
      ? {
          global: {
            fetch: (input: RequestInfo | URL, init?: RequestInit) =>
              fetch(input, {
                ...init,
                signal: init?.signal
                  ? AbortSignal.any([
                      init.signal,
                      AbortSignal.timeout(options.timeoutMs!),
                    ])
                  : AbortSignal.timeout(options.timeoutMs!),
              }),
          },
        }
      : {}),
    cookieOptions: {
      httpOnly: true,
      sameSite: "lax",
      secure: c.secureCookies,
      path: "/",
    },
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (items) =>
        items.forEach(({ name, value, options }) =>
          jar.set(name, value, options),
        ),
    },
  });
}
export function csrfToken(userId: string) {
  return createHmac("sha256", getConfig().csrfSecret)
    .update(userId)
    .digest("hex");
}
export function sameOrigin(req: Request) {
  requireCondition(
    req.headers.get("origin") === getConfig().origin,
    "csrf_origin",
    "The request must come from the MediaFlock application.",
    403,
  );
}
export async function limit(key: string, max = 120) {
  const result = await db().query(
    "insert into request_limits(key,window_at,count) values($1,date_trunc('minute',now()),1) on conflict(key,window_at) do update set count=request_limits.count+1 returning count",
    [key],
  );
  requireCondition(
    result.rows[0].count <= max,
    "rate_limited",
    "Too many requests. Retry after one minute.",
    429,
  );
}
export async function tokenContext(
  secret: string,
  workspaceId?: string,
): Promise<Context> {
  requireCondition(
    /^mf_[A-Za-z0-9_-]{40,100}$/.test(secret),
    "invalid_token",
    "Invalid API token.",
    401,
  );
  const result = await db().query(
    "select t.*,m.role,w.mode from api_tokens t join memberships m on m.workspace_id=t.workspace_id and m.user_id=t.user_id join workspaces w on w.id=t.workspace_id where token_hash=$1 and revoked_at is null and expires_at>now()",
    [hash(secret)],
  );
  const row = result.rows[0];
  requireCondition(
    row,
    "invalid_token",
    "API token is expired, revoked or invalid.",
    401,
  );
  requireCondition(
    !workspaceId || row.workspace_id === workspaceId,
    "workspace_denied",
    "Token is scoped to another workspace.",
    403,
  );
  requireCondition(
    row.mode === getConfig().mode,
    "mode_mismatch",
    "Workspace mode does not match this server.",
    403,
  );
  await limit("token:" + row.id, 120);
  return {
    workspaceId: row.workspace_id,
    userId: row.user_id,
    role: row.role,
    kind: "token",
    scopes: row.scopes,
    tokenId: row.id,
  };
}
export async function requestContext(req: Request): Promise<Context> {
  const bearer = req.headers.get("authorization");
  const workspaceId = req.headers.get("x-workspace-id") || undefined;
  if (bearer?.startsWith("Bearer "))
    return tokenContext(bearer.slice(7), workspaceId);
  const auth = await authClient();
  const {
    data: { user },
    error,
  } = await auth.auth.getUser();
  requireCondition(
    user && !error,
    "authentication_required",
    "Sign in to MediaFlock.",
    401,
  );
  const currentSession = await auth.auth.getSession();
  requireCondition(
    !currentSession.error,
    "authentication_required",
    "Sign in again to continue.",
    401,
  );
  const authSessionId = verifiedSessionId(
    currentSession.data.session?.access_token,
    user.id,
  );
  await validateHumanSession(db(), user.id, authSessionId);
  const memberships = await db().query(
    "select m.workspace_id,m.role,w.mode from memberships m join workspaces w on w.id=m.workspace_id where user_id=$1 and w.mode=$2 order by w.created_at",
    [user.id, getConfig().mode],
  );
  let member = memberships.rows.find(
    (x) => !workspaceId || x.workspace_id === workspaceId,
  );
  if (!member && !workspaceId && memberships.rows.length === 0)
    member = await ensureRegisteredWorkspace(user);
  requireCondition(
    member,
    "workspace_denied",
    "No membership in the selected workspace.",
    403,
  );
  requireCondition(
    member.mode === getConfig().mode,
    "mode_mismatch",
    "Workspace mode does not match this server.",
    403,
  );
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    sameOrigin(req);
    const got = Buffer.from(req.headers.get("x-mediaflock-csrf") || ""),
      expected = Buffer.from(csrfToken(user.id));
    requireCondition(
      got.length === expected.length && timingSafeEqual(got, expected),
      "csrf_token",
      "Refresh the application before trying this action.",
      403,
    );
  }
  await limit("human:" + user.id, 180);
  return {
    workspaceId: member.workspace_id,
    userId: user.id,
    role: member.role,
    kind: "human",
    authSessionId,
    localInteractive: localRequestAuthority(req, getConfig().origin),
    scopes: ["read", "draft", "request_approval", "schedule", "analytics"],
  };
}
export function authorize(ctx: Context, scope: string) {
  requireCondition(
    ctx.kind === "worker" || ctx.scopes.includes(scope),
    "scope_denied",
    `This action requires ${scope} permission.`,
    403,
  );
  if (scope !== "read" && scope !== "analytics")
    requireCondition(
      ctx.role !== "viewer",
      "role_denied",
      "Viewer membership cannot modify content.",
      403,
    );
}
export function humanReviewer(ctx: Context) {
  requireCondition(
    ctx.kind === "human" && ["owner", "reviewer"].includes(ctx.role),
    "human_approval_required",
    "Approval requires an authenticated human owner or reviewer. API and MCP tokens cannot approve.",
    403,
  );
}
export async function createToken(ctx: Context, input: unknown) {
  humanReviewer(ctx);
  const data = tokenInput.parse(input);
  requireCondition(
    new Date(data.expiresAt) > new Date(),
    "invalid_expiration",
    "Choose a future expiration date.",
  );
  const secret = "mf_" + randomBytes(32).toString("base64url");
  const token = await scoped(ctx, async (tx) => {
    const row = await one(
      tx,
      "insert into api_tokens(workspace_id,user_id,name,token_hash,prefix,scopes,expires_at) values($1,$2,$3,$4,$5,$6,$7) returning id,name,prefix,scopes,expires_at",
      [
        ctx.workspaceId,
        ctx.userId,
        data.name,
        hash(secret),
        secret.slice(0, 10),
        data.scopes,
        data.expiresAt,
      ],
    );
    await audit(tx, ctx, "token.created", "api_token", row!.id, {
      scopes: data.scopes,
    });
    return row;
  });
  return { ...token!, secret };
}
export async function revokeToken(ctx: Context, id: string) {
  humanReviewer(ctx);
  return scoped(ctx, async (tx) => {
    const row = await one(
      tx,
      "update api_tokens set revoked_at=now() where id=$1 and workspace_id=$2 returning id",
      [id, ctx.workspaceId],
    );
    requireCondition(row, "not_found", "API token not found.", 404);
    await audit(tx, ctx, "token.revoked", "api_token", id);
    return row;
  });
}
