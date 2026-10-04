import type { Context, Tx } from "../db";
import { DomainError, requireCondition, safeError } from "./errors";

// Callers own the transaction and acquire variant locks before changing grants.
// This module also runs in identity recovery: keep runtime database imports out.
export function requireFinalApprovalOwner(ctx: Context) {
  requireCondition(
    ctx.kind === "human" && ctx.role === "owner",
    "human_approval_required",
    "Final approval requires the authenticated workspace owner. Reviewers, API and MCP tokens cannot approve.",
    403,
  );
}

export async function requireApprovingOwner(
  tx: Tx,
  workspaceId: string,
  userId: string,
) {
  const owner = (
    await tx.query(
      "select public.mf_approval_owner_current($1::uuid,$2::uuid) as is_owner",
      [workspaceId, userId],
    )
  ).rows[0];
  requireCondition(
    owner?.is_owner === true,
    "approval_owner_required",
    "The approving owner no longer has permission. Obtain a fresh owner approval.",
    409,
  );
}

export async function activeDeliveryForVariant(
  tx: Tx,
  workspaceId: string,
  variantId: string,
) {
  return (
    await tx.query(
      "select j.id from publish_jobs j join publication_targets t on t.id=j.target_id join approvals a on a.id=t.approval_id where j.workspace_id=$1 and a.variant_id=$2 and j.state not in ('failed','cancelled','published') limit 1",
      [workspaceId, variantId],
    )
  ).rows[0];
}

export async function activeDeliveryForAccount(
  tx: Tx,
  workspaceId: string,
  accountId: string,
) {
  return (
    await tx.query(
      "select id from publish_jobs where workspace_id=$1 and account_id=$2 and state not in ('failed','cancelled','published') limit 1",
      [workspaceId, accountId],
    )
  ).rows[0];
}

export async function revokeVariantApprovals(
  tx: Tx,
  workspaceId: string,
  variantId: string,
  reason: string,
) {
  await tx.query(
    "update approvals set status='revoked',decided_at=now(),reason=$3 where workspace_id=$1 and variant_id=$2 and status in ('pending','approved')",
    [workspaceId, variantId, reason],
  );
}

export async function revokeAccountApprovals(
  tx: Tx,
  workspaceId: string,
  accountId: string,
  reason: string,
) {
  await tx.query(
    "update approvals set status='revoked',decided_at=now(),reason=$3 where workspace_id=$1 and account_id=$2 and status in ('pending','approved')",
    [workspaceId, accountId, reason],
  );
}

export async function requestApprovalCancellation(
  tx: Tx,
  workspaceId: string,
  approvalIds: string[],
  clock: "transaction" | "wall" = "transaction",
) {
  // Recovery supplies its already selected grants per workspace in the same tx.
  const time = clock === "wall" ? "clock_timestamp()" : "now()";
  return (
    await tx.query(
      `update publish_jobs j set cancel_requested=true,next_run_at=${time},updated_at=${time} from publication_targets t where t.id=j.target_id and j.workspace_id=$1 and t.approval_id=any($2::uuid[]) and j.state not in ('published','failed','cancelled') returning j.id,j.workspace_id`,
      [workspaceId, approvalIds],
    )
  ).rows;
}

export async function requestAccountCancellation(
  tx: Tx,
  workspaceId: string,
  accountId: string,
  error?: { code: string; message: string },
) {
  await tx.query(
    `update publish_jobs set cancel_requested=true,next_run_at=now(),updated_at=now()${error ? ",error=$3" : ""} where workspace_id=$1 and account_id=$2 and state not in ('published','failed','cancelled')`,
    error ? [workspaceId, accountId, error] : [workspaceId, accountId],
  );
}

export async function retainedPublicationEvidence(
  tx: Tx,
  workspaceId: string,
  jobId: string,
) {
  return (
    await tx.query(
      "select id,provider_response from publish_attempts where job_id=$1 and workspace_id=$2 and (provider_response is not null or (operation='submit' and (outcome<>'safe_rejection' or finished_at is null))) order by (provider_response is not null) desc,started_at desc limit 1",
      [jobId, workspaceId],
    )
  ).rows[0];
}

// Job-local: never acquire a variant lock here. Reservation owns that order.
// A setup error is not proof that an earlier provider write had no effect.
export async function recordPreparationFailure(
  tx: Tx,
  workspaceId: string,
  jobId: string,
  leaseToken: string,
  failure: unknown,
) {
  const job = (
    await tx.query(
      "select * from publish_jobs where id=$1 and workspace_id=$2 and lease_token=$3 and lease_expires_at>now() and state not in ('published','failed','cancelled') for update",
      [jobId, workspaceId, leaseToken],
    )
  ).rows[0];
  if (!job) return null;
  const evidence = await retainedPublicationEvidence(tx, workspaceId, job.id);
  const uncertain =
    job.state !== "queued" ||
    !!job.provider_job_id ||
    !!job.platform_post_id ||
    !!job.receipt ||
    !!evidence;
  const state = uncertain
    ? "needs_reconciliation"
    : job.cancel_requested
      ? "cancelled"
      : "failed";
  const error = {
    code: failure instanceof DomainError ? failure.code : "preparation_failed",
    message: safeError(failure),
    publicationUncertain: !!uncertain,
  };
  await tx.query(
    "update publish_jobs set state=$1,error=$2,next_run_at=now()+interval '60 seconds',lease_token=null,lease_expires_at=null,updated_at=now() where id=$3 and workspace_id=$4 and lease_token=$5",
    [state, error, job.id, workspaceId, leaseToken],
  );
  return { state, error };
}
