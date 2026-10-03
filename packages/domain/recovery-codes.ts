import {
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { createClient, type User } from "@supabase/supabase-js";
import { z } from "zod";
import { db, type Context, type Tx } from "../db";
import { getConfig } from "./config";
import { DomainError, requireCondition } from "./errors";
import { emailInput, passwordInput } from "./registration";
import {
  beginAccountSecurityReset,
  finishAccountSecurityReset,
  guardContextSecurity,
  lockAccountSecurity,
} from "./session-security";

export function recoveryCodesEnabled() {
  return process.env.MEDIAFLOCK_RECOVERY_CODES_ENABLED === "true";
}
export function requireRecoveryCodesEnabled() {
  requireCondition(
    recoveryCodesEnabled(),
    "recovery_codes_unavailable",
    "Recovery codes are not available yet.",
    503,
  );
}
const codePattern = /^mf_recovery_[A-Za-z0-9_-]{43}$/;
export const generateRecoveryInput = z
  .object({ currentPassword: z.string().min(1).max(200) })
  .strict();
export const resetRecoveryInput = z
  .object({
    email: emailInput,
    recoveryCode: z.string().trim().min(1).max(200),
    newPassword: passwordInput,
  })
  .strict();
export function recoveryCodeHash(code: string) {
  const secret =
    process.env.MEDIAFLOCK_RECOVERY_PEPPER || getConfig().csrfSecret;
  requireCondition(
    secret.length >= 32,
    "recovery_key_unavailable",
    "Account recovery is temporarily unavailable.",
    503,
  );
  return createHmac("sha256", secret)
    .update("mediaflock:recovery-code:v1:" + code)
    .digest("hex");
}
function newRecoveryCode() {
  return "mf_recovery_" + randomBytes(32).toString("base64url");
}
function recoveryDenied() {
  return new DomainError(
    "recovery_denied",
    "The account details or recovery code were not accepted.",
    403,
  );
}
function sameHash(expected: string | undefined, provided: string) {
  const expectedBytes = Buffer.from(expected || "0".repeat(64), "hex");
  const providedBytes = Buffer.from(recoveryCodeHash(provided), "hex");
  return (
    expectedBytes.length === providedBytes.length &&
    timingSafeEqual(expectedBytes, providedBytes)
  );
}
async function ownerMembership(tx: Tx, userId: string, workspaceId: string) {
  const member = (
    await tx.query(
      "select m.role from memberships m join workspaces w on w.id=m.workspace_id where m.user_id=$1 and m.workspace_id=$2 and w.mode=$3",
      [userId, workspaceId, getConfig().mode],
    )
  ).rows[0];
  requireCondition(
    member?.role === "owner",
    "recovery_owner_required",
    "Only an authenticated account owner can create a recovery code.",
    403,
  );
}
async function recoveryAudit(
  tx: Tx,
  userId: string,
  workspaceId: string,
  action: string,
  attemptId?: string,
) {
  await tx.query(
    "insert into audit_events(workspace_id,actor_id,actor_kind,action,resource_type,resource_id,details) values($1,$2,'human',$3,'account_recovery',$2,$4)",
    [workspaceId, userId, action, attemptId ? { attemptId } : {}],
  );
}

// This is first-issue only: callback retries and existing users can never
// replace or reveal a stored capability. Caller supplies a getUser identity.
export async function issueInitialRecoveryCode(
  user: User,
  workspaceId: string,
): Promise<string | undefined> {
  if (!recoveryCodesEnabled()) return undefined;
  requireCondition(
    user.email && user.email_confirmed_at && !user.is_anonymous,
    "authentication_required",
    "Sign in to create a recovery code.",
    401,
  );
  const tx = await db().connect();
  try {
    await tx.query("begin");
    await lockAccountSecurity(tx, user.id);
    await tx.query(
      "select pg_advisory_xact_lock(hashtextextended($1,721041325))",
      [user.id],
    );
    await ownerMembership(tx, user.id, workspaceId);
    const registration = (
      await tx.query(
        "select 1 from self_service_registrations where user_id=$1 and workspace_id=$2 and mode=$3",
        [user.id, workspaceId, getConfig().mode],
      )
    ).rows[0];
    if (!registration) {
      await tx.query("commit");
      return undefined;
    }
    const code = newRecoveryCode();
    const inserted = await tx.query(
      "insert into account_recovery_codes(user_id,mode,workspace_id,code_hash) values($1,$2,$3,$4) on conflict(user_id,mode) do nothing returning user_id",
      [user.id, getConfig().mode, workspaceId, recoveryCodeHash(code)],
    );
    if (inserted.rowCount)
      await recoveryAudit(tx, user.id, workspaceId, "account_recovery.created");
    await tx.query("commit");
    return inserted.rowCount ? code : undefined;
  } catch (error) {
    await tx.query("rollback");
    throw error;
  } finally {
    tx.release();
  }
}

export type Reauthenticate = (
  email: string,
  password: string,
) => Promise<User | null>;
async function reauthenticate(
  email: string,
  password: string,
): Promise<User | null> {
  const config = getConfig();
  const client = createClient(config.supabaseUrl, config.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  try {
    const signin = await client.auth.signInWithPassword({ email, password });
    if (signin.error || !signin.data.session) return null;
    const verified = await client.auth.getUser();
    return verified.error ? null : verified.data.user;
  } finally {
    // Destroy only this independent reauthentication session, preserving the
    // user's browser session and sessions on their other devices.
    await client.auth.signOut({ scope: "local" });
  }
}

export async function rotateRecoveryCode(
  ctx: Context,
  user: User,
  currentPassword: string,
  authenticate: Reauthenticate = reauthenticate,
) {
  requireRecoveryCodesEnabled();
  requireCondition(
    ctx.kind === "human" &&
      ctx.role === "owner" &&
      user.id === ctx.userId &&
      user.email &&
      !user.is_anonymous,
    "recovery_owner_required",
    "Only an authenticated account owner can create a recovery code.",
    403,
  );
  const confirmed = await authenticate(user.email, currentPassword);
  requireCondition(
    confirmed?.id === ctx.userId,
    "reauthentication_required",
    "Your current password was not accepted.",
    403,
  );
  const tx = await db().connect();
  try {
    await tx.query("begin");
    await guardContextSecurity(tx, ctx);
    await tx.query(
      "select pg_advisory_xact_lock(hashtextextended($1,721041325))",
      [ctx.userId],
    );
    await ownerMembership(tx, ctx.userId, ctx.workspaceId);
    const existing = (
      await tx.query(
        "select state from account_recovery_codes where user_id=$1 and mode=$2 for update",
        [ctx.userId, getConfig().mode],
      )
    ).rows[0];
    requireCondition(
      !existing || !["claimed", "uncertain"].includes(existing.state),
      "recovery_unresolved",
      "A previous recovery attempt needs to be checked before creating another code.",
      409,
    );
    const code = newRecoveryCode();
    await tx.query(
      "insert into account_recovery_codes(user_id,mode,workspace_id,code_hash) values($1,$2,$3,$4) on conflict(user_id,mode) do update set workspace_id=excluded.workspace_id,code_hash=excluded.code_hash,generation=account_recovery_codes.generation+1,state='active',attempt_id=null,claimed_at=null,used_at=null,updated_at=now()",
      [ctx.userId, getConfig().mode, ctx.workspaceId, recoveryCodeHash(code)],
    );
    await recoveryAudit(
      tx,
      ctx.userId,
      ctx.workspaceId,
      existing ? "account_recovery.rotated" : "account_recovery.created",
    );
    await tx.query("commit");
    return code;
  } catch (error) {
    await tx.query("rollback");
    throw error;
  } finally {
    tx.release();
  }
}

export type PasswordUpdateResult = "success" | "rejected" | "uncertain";
export type RecoveryPasswordProvider = (
  userId: string,
  password: string,
) => Promise<PasswordUpdateResult>;
async function updatePassword(
  userId: string,
  password: string,
): Promise<PasswordUpdateResult> {
  // Disallow transport retries for this privileged mutation: a lost response
  // must not produce a second password write. Supabase API errors with 5xx,
  // timeout or retryable fetch status have an unknown outcome.
  try {
    const config = getConfig();
    const admin = createClient(config.supabaseUrl, config.serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: (input, init) =>
          fetch(input, {
            ...init,
            signal: init?.signal
              ? AbortSignal.any([init.signal, AbortSignal.timeout(10000)])
              : AbortSignal.timeout(10000),
          }),
      },
    });
    const result = await admin.auth.admin.updateUserById(userId, { password });
    if (!result.error && result.data.user?.id === userId) return "success";
    if (
      result.error &&
      result.error.status &&
      result.error.status >= 400 &&
      result.error.status < 500 &&
      result.error.status !== 408
    )
      return "rejected";
    return "uncertain";
  } catch {
    return "uncertain";
  }
}

export async function resetWithRecoveryCode(
  input: z.infer<typeof resetRecoveryInput>,
  provider: RecoveryPasswordProvider = updatePassword,
) {
  requireRecoveryCodesEnabled();
  const data = resetRecoveryInput.parse(input);
  const attemptId = randomUUID();
  const tx = await db().connect();
  let claim: { user_id: string; workspace_id: string; generation: number };
  try {
    await tx.query("begin");
    const initialRows = (
      await tx.query(
        "select r.user_id,r.code_hash,r.state from account_recovery_codes r join auth.users u on u.id=r.user_id join workspaces w on w.id=r.workspace_id where lower(u.email)=$1 and r.mode=$2 and w.mode=$2 and u.deleted_at is null and not u.is_anonymous",
        [data.email, getConfig().mode],
      )
    ).rows;
    const initial = initialRows.length === 1 ? initialRows[0] : undefined;
    if (
      !sameHash(initial?.code_hash, data.recoveryCode) ||
      !codePattern.test(data.recoveryCode) ||
      initial?.state !== "active"
    )
      throw recoveryDenied();
    // Prove the capability before taking an identity-wide lock. Wrong codes
    // cannot block an account's normal requests. Recheck after ordered locks.
    await lockAccountSecurity(tx, initial.user_id, true);
    await tx.query(
      "select pg_advisory_xact_lock(hashtextextended($1,721041325))",
      [initial.user_id],
    );
    const row = (
      await tx.query(
        "select r.user_id,r.workspace_id,r.code_hash,r.state,r.generation from account_recovery_codes r join auth.users u on u.id=r.user_id where r.user_id=$1 and r.mode=$2 and lower(u.email)=$3 and u.deleted_at is null and not u.is_anonymous for update of r",
        [initial.user_id, getConfig().mode, data.email],
      )
    ).rows[0];
    const validProof = sameHash(row?.code_hash, data.recoveryCode);
    if (
      !validProof ||
      !codePattern.test(data.recoveryCode) ||
      row?.state !== "active"
    )
      throw recoveryDenied();
    const cutoff = await beginAccountSecurityReset(tx, row.user_id, attemptId);
    const claimed = await tx.query(
      "update account_recovery_codes set state='claimed',attempt_id=$3,claimed_at=clock_timestamp(),auth_cutoff_at=$5,updated_at=clock_timestamp() where user_id=$1 and mode=$2 and state='active' and generation=$4 returning user_id,workspace_id,generation",
      [row.user_id, getConfig().mode, attemptId, row.generation, cutoff],
    );
    if (!claimed.rows[0]) throw recoveryDenied();
    claim = claimed.rows[0];
    await recoveryAudit(
      tx,
      claim.user_id,
      claim.workspace_id,
      "account_recovery.claimed",
      attemptId,
    );
    // Commit the one-use fence BEFORE any remote call. Crashes, timeouts and
    // concurrent requests cannot reactivate the key or issue another reset.
    await tx.query("commit");
  } catch (error) {
    await tx.query("rollback");
    throw error;
  } finally {
    tx.release();
  }
  let outcome: PasswordUpdateResult;
  try {
    outcome = await provider(claim.user_id, data.newPassword);
  } catch {
    outcome = "uncertain";
  }
  const final = await db().connect();
  try {
    await final.query("begin");
    await lockAccountSecurity(final, claim.user_id, true);
    await final.query(
      "select pg_advisory_xact_lock(hashtextextended($1,721041325))",
      [claim.user_id],
    );
    const result = await final.query(
      "update account_recovery_codes set state=$5,used_at=now(),updated_at=now() where user_id=$1 and mode=$2 and generation=$3 and attempt_id=$4 and state='claimed' returning user_id",
      [
        claim.user_id,
        getConfig().mode,
        claim.generation,
        attemptId,
        outcome === "uncertain" ? "uncertain" : "spent",
      ],
    );
    requireCondition(
      result.rowCount === 1,
      "recovery_unresolved",
      "The password reset result could not be confirmed. Try signing in with your new password.",
      503,
    );
    await finishAccountSecurityReset(final, claim.user_id, attemptId, outcome);
    await recoveryAudit(
      final,
      claim.user_id,
      claim.workspace_id,
      outcome === "success"
        ? "account_recovery.completed"
        : outcome === "rejected"
          ? "account_recovery.rejected"
          : "account_recovery.uncertain",
      attemptId,
    );
    await final.query("commit");
  } catch (error) {
    await final.query("rollback");
    throw error;
  } finally {
    final.release();
  }
  requireCondition(
    outcome === "success",
    "recovery_unresolved",
    "The password reset result could not be confirmed. Try signing in with your new password. This recovery code has been used.",
    503,
  );
  return { ok: true };
}
