import type { Context, Tx } from "../db";
import { DomainError, requireCondition } from "./errors";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const securityLockSeed = 721041326;
type Queryable = Pick<Tx, "query">;

// Call only after getUser has verified this Auth client's session. JWT payload
// fields alone never authorize a request; the Auth session row below must also
// belong to the verified user and have been created after the durable cutoff.
export function verifiedSessionId(
  accessToken: string | undefined,
  userId: string,
) {
  try {
    if (!accessToken || accessToken.length > 65536)
      throw new Error("Missing token");
    const parts = accessToken.split(".");
    if (parts.length !== 3) throw new Error("Invalid token");
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8"),
    );
    if (
      payload.sub !== userId ||
      typeof payload.session_id !== "string" ||
      !uuidPattern.test(payload.session_id)
    )
      throw new Error("Invalid session");
    return payload.session_id as string;
  } catch {
    throw new DomainError(
      "authentication_required",
      "Sign in again to continue.",
      401,
    );
  }
}

export async function lockAccountSecurity(
  tx: Queryable,
  userId: string,
  exclusive = false,
) {
  await tx.query(
    exclusive
      ? "select pg_advisory_xact_lock(hashtextextended($1,$2))"
      : "select pg_advisory_xact_lock_shared(hashtextextended($1,$2))",
    [userId, securityLockSeed],
  );
}

export async function validateHumanSession(
  tx: Queryable,
  userId: string,
  sessionId: string,
) {
  const session = (
    await tx.query(
      "select s.id,sec.state,(sec.session_cutoff_at is null or s.created_at>sec.session_cutoff_at) as after_cutoff from auth.sessions s left join account_security_state sec on sec.user_id=s.user_id where s.id=$1 and s.user_id=$2",
      [sessionId, userId],
    )
  ).rows[0];
  requireCondition(
    session && session.after_cutoff,
    "authentication_required",
    "Sign in again to continue.",
    401,
  );
  requireCondition(
    !session.state || session.state === "active",
    "recovery_unresolved",
    "Account recovery is still being checked. Access is paused until its result is confirmed.",
    503,
  );
}

export async function guardContextSecurity(tx: Queryable, ctx: Context) {
  if (ctx.kind === "worker") return;
  await lockAccountSecurity(tx, ctx.userId);
  // Trusted local fixtures may omit the session identifier. Actual human
  // requestContext always requires and supplies one from verified Auth.
  if (ctx.kind === "human" && ctx.authSessionId)
    await validateHumanSession(tx, ctx.userId, ctx.authSessionId);
  if (ctx.kind === "token") {
    const state = (
      await tx.query(
        "select state from account_security_state where user_id=$1",
        [ctx.userId],
      )
    ).rows[0];
    requireCondition(
      !state || state.state === "active",
      "recovery_unresolved",
      "Account recovery is still being checked. Access is paused until its result is confirmed.",
      503,
    );
  }
}

// Caller must already have proved an email-recovery grant or recovery code.
// Hold the exclusive identity lock until this transaction commits, so old
// scoped writes finish before token/approval revocation and none can follow it.
export async function beginAccountSecurityReset(
  tx: Tx,
  userId: string,
  attemptId: string,
) {
  await lockAccountSecurity(tx, userId, true);
  const prior = (
    await tx.query(
      "select state from account_security_state where user_id=$1 for update",
      [userId],
    )
  ).rows[0];
  requireCondition(
    !prior || prior.state === "active",
    "recovery_unresolved",
    "A previous recovery attempt needs to be checked before another reset.",
    409,
  );
  const state = (
    await tx.query(
      "insert into account_security_state(user_id,session_cutoff_at,state,reset_attempt_id) values($1,clock_timestamp(),'resetting',$2) on conflict(user_id) do update set session_cutoff_at=excluded.session_cutoff_at,state='resetting',reset_attempt_id=excluded.reset_attempt_id,updated_at=clock_timestamp() returning session_cutoff_at::text as cutoff",
      [userId, attemptId],
    )
  ).rows[0];
  const tokens = (
    await tx.query(
      "update api_tokens set revoked_at=clock_timestamp() where user_id=$1 and revoked_at is null returning workspace_id",
      [userId],
    )
  ).rows;
  // Variant-first lock order matches normal approval/scheduling/worker paths.
  await tx.query(
    "select v.id from platform_variants v where exists(select 1 from approvals a where a.variant_id=v.id and a.status in ('pending','approved') and (a.approved_by=$1 or (a.requested_by=$1 and a.status='pending'))) order by v.id for update of v",
    [userId],
  );
  const approvals = (
    await tx.query(
      "update approvals set status='revoked',reason='Account recovery requires a fresh approval',decided_at=clock_timestamp() where status in ('pending','approved') and (approved_by=$1 or (requested_by=$1 and status='pending')) returning id,workspace_id",
      [userId],
    )
  ).rows;
  const jobs = approvals.length
    ? (
        await tx.query(
          "update publish_jobs j set cancel_requested=true,next_run_at=clock_timestamp(),updated_at=clock_timestamp() from publication_targets t where t.id=j.target_id and t.approval_id=any($1::uuid[]) and j.state not in ('published','failed','cancelled') returning j.id,j.workspace_id",
          [approvals.map((approval) => approval.id)],
        )
      ).rows
    : [];
  const workspaces = new Set(
    [...tokens, ...approvals, ...jobs].map((row) => row.workspace_id as string),
  );
  for (const workspaceId of [...workspaces].sort())
    await tx.query(
      "insert into audit_events(workspace_id,actor_id,actor_kind,action,resource_type,resource_id,details) values($1,$2,'human','account.security_reset','account_recovery',$2,$3)",
      [
        workspaceId,
        userId,
        {
          attemptId,
          tokensRevoked: tokens.filter(
            (row) => row.workspace_id === workspaceId,
          ).length,
          approvalsRevoked: approvals.filter(
            (row) => row.workspace_id === workspaceId,
          ).length,
          jobsCancellationRequested: jobs.filter(
            (row) => row.workspace_id === workspaceId,
          ).length,
        },
      ],
    );
  return state.cutoff as string;
}

export async function finishAccountSecurityReset(
  tx: Tx,
  userId: string,
  attemptId: string,
  outcome: "success" | "rejected" | "uncertain",
) {
  await lockAccountSecurity(tx, userId, true);
  const result = await tx.query(
    "update account_security_state set state=$3,session_cutoff_at=clock_timestamp(),updated_at=clock_timestamp() where user_id=$1 and reset_attempt_id=$2 and state='resetting' returning user_id",
    [userId, attemptId, outcome === "uncertain" ? "uncertain" : "active"],
  );
  requireCondition(
    result.rowCount === 1,
    "recovery_unresolved",
    "The password reset result could not be confirmed. Access remains paused.",
    503,
  );
}
