import { scoped, one, audit, type Context, type Tx } from "../db";
import { authorize, humanReviewer, contentHash } from "./auth";
import { requireCondition, DomainError } from "./errors";
import { approvalInput } from "../schemas";
import { effectiveSettings } from "../publishing/validation";
import type { DeliveryEnvelope } from "../publishing/provider";
import { ProviderError } from "../publishing/provider";
import { integrationFingerprint } from "./integrations";
import { getConfig } from "./config";
import {
  requireFinalApprovalOwner,
  requireApprovingOwner,
  activeDeliveryForVariant,
  requestApprovalCancellation,
} from "./approved-delivery";
export async function snapshotFor(
  tx: Tx,
  ctx: Context,
  variant: Record<string, any>,
  revision: Record<string, any>,
  scheduledAt: string,
) {
  const account = await one(
    tx,
    "select * from social_accounts where id=$1 and workspace_id=$2 for share",
    [variant.account_id, ctx.workspaceId],
  );
  requireCondition(account, "invalid_account", "Account is unavailable.");
  const media = (
    await tx.query(
      "select ra.position,a.id as asset_id,a.checksum,a.mime_type,a.bytes,a.width,a.height,a.duration,a.storage_path,d.metadata as derivative_metadata,d.id as derivative_id,d.checksum as derivative_checksum,d.storage_path as derivative_path,d.status as derivative_status from revision_assets ra join assets a on a.id=ra.asset_id left join asset_derivatives d on d.id=ra.derivative_id where ra.revision_id=$1 and ra.workspace_id=$2 order by ra.position",
      [revision.id, ctx.workspaceId],
    )
  ).rows;
  requireCondition(
    media.every((x) => !x.derivative_id || x.derivative_status === "ready"),
    "media_not_ready",
    "Wait for media processing to finish.",
  );
  const integration = await one(
    tx,
    "select * from integration_secrets where workspace_id=$1 and service='postforme' for share",
    [ctx.workspaceId],
  );
  const snapshot = {
    version: 1,
    adapterVersion: "postforme-v1-20261002",
    integrationHash: integration ? integrationFingerprint(integration) : null,
    workspaceId: ctx.workspaceId,
    accountId: account.id,
    providerAccountId: account.provider_account_id,
    platform: account.platform,
    accountType: account.account_type,
    connectionGeneration: account.connection_generation,
    capabilityGeneration: account.capability_generation,
    variantId: variant.id,
    revisionId: revision.id,
    contentHash: revision.content_hash,
    format: variant.format,
    payload: revision.payload,
    media: media.map((x) => ({
      assetId: x.asset_id,
      checksum: x.checksum,
      storagePath: x.storage_path,
      mimeType: x.derivative_id ? x.derivative_metadata.mimeType : x.mime_type,
      bytes: x.derivative_id ? x.derivative_metadata.bytes : x.bytes,
      width: x.derivative_id ? x.derivative_metadata.width : x.width,
      height: x.derivative_id ? x.derivative_metadata.height : x.height,
      duration: x.derivative_id ? x.derivative_metadata.duration : x.duration,
      derivativeId: x.derivative_id,
      derivativeChecksum: x.derivative_checksum,
      derivativePath: x.derivative_path,
    })),
    visibility: revision.payload.visibility,
    scheduledAt: new Date(scheduledAt).toISOString(),
    provenance: account.provenance,
  };
  try {
    return {
      ...snapshot,
      effectiveSettings: effectiveSettings(snapshot as DeliveryEnvelope),
    };
  } catch (error) {
    if (error instanceof ProviderError && error.classification === "validation")
      throw new DomainError("invalid_media_or_settings", error.message, 400);
    throw error;
  }
}
export async function requestApproval(ctx: Context, input: unknown) {
  authorize(ctx, "request_approval");
  const data = approvalInput.parse(input);
  const date = new Date(data.scheduledAt);
  requireCondition(
    date.getTime() >= Date.now() - 300000 &&
      date.getTime() < Date.now() + 366 * 86400000,
    "invalid_schedule",
    "Choose a time between now and one year from now.",
  );
  return scoped(ctx, async (tx) => {
    const variant = await one(
      tx,
      "select * from platform_variants where id=$1 and workspace_id=$2 for update",
      [data.variantId, ctx.workspaceId],
    );
    requireCondition(variant, "not_found", "Variant not found.", 404);
    requireCondition(
      variant.current_revision_id === data.revisionId,
      "revision_conflict",
      "Request approval for the current revision.",
      409,
    );
    const revision = await one(
      tx,
      "select * from content_revisions where id=$1 and workspace_id=$2",
      [data.revisionId, ctx.workspaceId],
    );
    requireCondition(revision, "not_found", "Revision not found.", 404);
    const snapshot = await snapshotFor(
      tx,
      ctx,
      variant,
      revision,
      data.scheduledAt,
    );
    const existing = await one(
      tx,
      "select * from approvals where variant_id=$1 and revision_id=$2 and snapshot_hash=$3 and status in ('pending','approved')",
      [variant.id, revision.id, contentHash(snapshot)],
    );
    if (existing) return existing;
    const row = await one(
      tx,
      "insert into approvals(workspace_id,variant_id,account_id,revision_id,snapshot,snapshot_hash,scheduled_at,status,requested_by) values($1,$2,$3,$4,$5,$6,$7,'pending',$8) returning *",
      [
        ctx.workspaceId,
        variant.id,
        variant.account_id,
        revision.id,
        snapshot,
        contentHash(snapshot),
        date.toISOString(),
        ctx.userId,
      ],
    );
    await audit(tx, ctx, "approval.requested", "approval", row!.id, {
      revisionId: revision.id,
      accountId: variant.account_id,
    });
    return row;
  });
}
export async function decideApproval(
  ctx: Context,
  id: string,
  decision: "approved" | "rejected",
  reason = "",
) {
  if (decision === "approved") requireFinalApprovalOwner(ctx);
  else humanReviewer(ctx);
  return scoped(ctx, async (tx) => {
    const initial = await one(
      tx,
      "select variant_id from approvals where id=$1 and workspace_id=$2",
      [id, ctx.workspaceId],
    );
    requireCondition(initial, "not_found", "Approval not found.", 404);
    const variant = await one(
      tx,
      "select * from platform_variants where id=$1 and workspace_id=$2 for update",
      [initial.variant_id, ctx.workspaceId],
    );
    const approval = await one(
      tx,
      "select * from approvals where id=$1 and workspace_id=$2 for update",
      [id, ctx.workspaceId],
    );
    if (decision === "approved")
      await requireApprovingOwner(tx, ctx.workspaceId, ctx.userId);
    requireCondition(
      approval?.status === "pending",
      "approval_state",
      "Only a pending request can be decided.",
      409,
    );
    requireCondition(
      variant?.current_revision_id === approval.revision_id,
      "revision_conflict",
      "Content changed; request a fresh approval.",
      409,
    );
    requireCondition(
      contentHash(approval.snapshot) === approval.snapshot_hash,
      "snapshot_corrupt",
      "Approval snapshot integrity check failed.",
      409,
    );
    const revision = await one(
      tx,
      "select * from content_revisions where id=$1",
      [approval.revision_id],
    );
    const snapshot = await snapshotFor(
      tx,
      ctx,
      variant!,
      revision!,
      approval.scheduled_at,
    );
    requireCondition(
      contentHash(snapshot) === approval.snapshot_hash,
      "snapshot_changed",
      "Media or account mapping changed. Request approval again.",
      409,
    );
    const row = await one(
      tx,
      "update approvals set status=$1,approved_by=$2,decided_at=now(),reason=$3 where id=$4 and workspace_id=$5 returning *",
      [decision, ctx.userId, reason, id, ctx.workspaceId],
    );
    await audit(tx, ctx, "approval." + decision, "approval", id, {
      snapshotHash: approval.snapshot_hash,
    });
    return row;
  });
}
export async function revokeApproval(ctx: Context, id: string, reason: string) {
  humanReviewer(ctx);
  return scoped(ctx, async (tx) => {
    const initial = await one(
      tx,
      "select variant_id from approvals where id=$1 and workspace_id=$2",
      [id, ctx.workspaceId],
    );
    requireCondition(initial, "not_found", "Approval not found.", 404);
    await tx.query("select id from platform_variants where id=$1 for update", [
      initial.variant_id,
    ]);
    const row = await one(
      tx,
      "update approvals set status='revoked',reason=$1,decided_at=now() where id=$2 and workspace_id=$3 and status in ('pending','approved') returning *",
      [reason, id, ctx.workspaceId],
    );
    requireCondition(
      row,
      "approval_state",
      "Approval is already inactive.",
      409,
    );
    await requestApprovalCancellation(tx, ctx.workspaceId, [id]);
    await audit(tx, ctx, "approval.revoked", "approval", id, { reason });
    return row;
  });
}
export async function listApprovals(ctx: Context) {
  authorize(ctx, "read");
  return scoped(
    ctx,
    async (tx) =>
      (
        await tx.query(
          "select ap.*,a.handle,a.platform,a.display_name,p.title,r.revision,r.payload,prev.payload as previous_payload,v.current_revision_id from approvals ap join social_accounts a on a.id=ap.account_id join platform_variants v on v.id=ap.variant_id join content_packages p on p.id=v.package_id join content_revisions r on r.id=ap.revision_id left join content_revisions prev on prev.variant_id=v.id and prev.revision=r.revision-1 where ap.workspace_id=$1 order by ap.created_at desc",
          [ctx.workspaceId],
        )
      ).rows,
  );
}
export async function eligible(
  tx: Tx,
  ctx: Context,
  approval: Record<string, any>,
  variant: Record<string, any>,
) {
  requireCondition(
    approval.status === "approved",
    "approval_required",
    "A current human approval is required.",
    409,
  );
  requireCondition(
    variant.current_revision_id === approval.revision_id,
    "revision_conflict",
    "Approval is for an older revision.",
    409,
  );
  await requireApprovingOwner(tx, ctx.workspaceId, approval.approved_by);
  const account = await one(
    tx,
    "select * from social_accounts where id=$1 and workspace_id=$2 for share",
    [approval.account_id, ctx.workspaceId],
  );
  requireCondition(
    account?.status === "connected",
    "account_unavailable",
    "Reconnect the account before publishing.",
    409,
  );
  requireCondition(
    account.capabilities.operations?.publish === "supported" &&
      account.capabilities.formats?.[variant.format] === "supported",
    "capability_unavailable",
    "Current owner permission review and format support are required.",
    409,
  );
  requireCondition(
    account.provider_account_id === approval.snapshot.providerAccountId &&
      account.connection_generation ===
        approval.snapshot.connectionGeneration &&
      account.capability_generation ===
        approval.snapshot.capabilityGeneration &&
      account.account_type === approval.snapshot.accountType,
    "account_mapping_changed",
    "Account connection changed. Obtain a new approval.",
    409,
  );
  requireCondition(
    account.provenance ===
      (getConfig().mode === "demo" ? "simulated" : "provider"),
    "mode_mismatch",
    "Demo records cannot enter live publishing.",
    403,
  );
  if (getConfig().mode === "live") {
    const evidence = account.capabilities.verification;
    const integration = await one(
      tx,
      "select *,(ciphertext is not null) as has_key from integration_secrets where workspace_id=$1 and service='postforme' for share",
      [ctx.workspaceId],
    );
    requireCondition(
      evidence?.source === "owner_attestation" &&
        new Date(evidence.expiresAt).getTime() > Date.now() &&
        evidence.connectionGeneration === account.connection_generation &&
        evidence.integrationHash ===
          (integration ? integrationFingerprint(integration) : null),
      "permission_review_required",
      "Permission review expired or the integration changed. Review this account again.",
      409,
    );
    requireCondition(
      getConfig().livePublishing &&
        (integration
          ? integration.enabled &&
            integration.has_key &&
            integration.config.publishingEnabled === true
          : process.env.POSTFORME_API_KEY),
      "publishing_unavailable",
      "Configure Post for Me and explicitly enable live publishing before scheduling.",
      503,
    );
  }
  requireCondition(
    contentHash(approval.snapshot) === approval.snapshot_hash,
    "snapshot_corrupt",
    "Approval integrity check failed.",
    409,
  );
  const revision = await one(
    tx,
    "select * from content_revisions where id=$1 and workspace_id=$2",
    [approval.revision_id, ctx.workspaceId],
  );
  requireCondition(revision, "not_found", "Revision not found.");
  const current = await snapshotFor(
    tx,
    ctx,
    variant,
    revision,
    approval.scheduled_at,
  );
  requireCondition(
    contentHash(current) === approval.snapshot_hash,
    "snapshot_changed",
    "Approved media/account changed. Request a fresh approval.",
    409,
  );
  return account;
}
export async function scheduleApproved(ctx: Context, id: string) {
  authorize(ctx, "schedule");
  return scoped(ctx, async (tx) => {
    const initial = await one(
      tx,
      "select variant_id from approvals where id=$1 and workspace_id=$2",
      [id, ctx.workspaceId],
    );
    requireCondition(initial, "not_found", "Approval not found.", 404);
    const variant = await one(
      tx,
      "select * from platform_variants where id=$1 and workspace_id=$2 for update",
      [initial.variant_id, ctx.workspaceId],
    );
    const approval = await one(
      tx,
      "select * from approvals where id=$1 and workspace_id=$2 for update",
      [id, ctx.workspaceId],
    );
    requireCondition(
      approval && variant,
      "not_found",
      "Approval not found.",
      404,
    );
    const existing = await one(
      tx,
      "select j.* from publish_jobs j join publication_targets t on t.id=j.target_id where t.approval_id=$1 and j.workspace_id=$2",
      [id, ctx.workspaceId],
    );
    if (existing) return existing;
    await eligible(tx, ctx, approval, variant);
    const active = await activeDeliveryForVariant(
      tx,
      ctx.workspaceId,
      variant.id,
    );
    requireCondition(
      !active,
      "delivery_active",
      "Cancel the existing delivery and wait for confirmation before scheduling a replacement.",
      409,
    );
    const target = await one(
      tx,
      "insert into publication_targets(workspace_id,approval_id,account_id,local_key,provenance,variant_id) values($1,$2,$3,$4,$5,$6) returning *",
      [
        ctx.workspaceId,
        id,
        approval.account_id,
        "mf:" + id,
        approval.snapshot.provenance,
        variant.id,
      ],
    );
    const job = await one(
      tx,
      "insert into publish_jobs(workspace_id,target_id,account_id,state,variant_id) values($1,$2,$3,'queued',$4) returning *",
      [ctx.workspaceId, target!.id, approval.account_id, variant.id],
    );
    await audit(tx, ctx, "delivery.queued", "publish_job", job!.id, {
      approvalId: id,
      accountId: approval.account_id,
    });
    return job!;
  });
}
export async function cancelJob(ctx: Context, id: string) {
  authorize(ctx, "schedule");
  return scoped(ctx, async (tx) => {
    const initial = await one(
      tx,
      "select a.variant_id from publish_jobs j join publication_targets t on t.id=j.target_id join approvals a on a.id=t.approval_id where j.id=$1 and j.workspace_id=$2",
      [id, ctx.workspaceId],
    );
    requireCondition(initial, "not_found", "Publication not found.", 404);
    await tx.query("select id from platform_variants where id=$1 for update", [
      initial.variant_id,
    ]);
    const job = await one(
      tx,
      "select * from publish_jobs where id=$1 and workspace_id=$2 for update",
      [id, ctx.workspaceId],
    );
    requireCondition(job, "not_found", "Publication not found.", 404);
    requireCondition(
      job.state !== "published",
      "already_published",
      "This post was already published; scheduled cancellation cannot remove it.",
      409,
    );
    if (job.state === "cancelled") return job;
    const hasAttempt = await one(
      tx,
      "select id from publish_attempts where job_id=$1 and operation='submit'",
      [id],
    );
    const state =
      job.state === "queued" && !hasAttempt ? "cancelled" : job.state;
    await tx.query(
      "update publish_jobs set cancel_requested=true,state=$1,next_run_at=now(),updated_at=now(),generation=generation+1 where id=$2 and workspace_id=$3",
      [state, id, ctx.workspaceId],
    );
    await audit(
      tx,
      ctx,
      state === "cancelled"
        ? "delivery.cancelled"
        : "delivery.cancellation_requested",
      "publish_job",
      id,
    );
    return { ...job, state, cancel_requested: true };
  });
}
export async function getJob(
  ctx: Context,
  id: string,
): Promise<Record<string, any>> {
  authorize(ctx, "read");
  return scoped(ctx, async (tx) => {
    const row = await one(
      tx,
      "select j.*,a.handle,a.platform,ap.snapshot,ap.snapshot_hash,ap.scheduled_at,t.local_key from publish_jobs j join social_accounts a on a.id=j.account_id join publication_targets t on t.id=j.target_id join approvals ap on ap.id=t.approval_id where j.id=$1 and j.workspace_id=$2",
      [id, ctx.workspaceId],
    );
    requireCondition(row, "not_found", "Publication not found.", 404);
    return {
      ...row,
      attempts: (
        await tx.query(
          "select * from publish_attempts where job_id=$1 and workspace_id=$2 order by started_at",
          [id, ctx.workspaceId],
        )
      ).rows,
      events: (
        await tx.query(
          "select * from provider_events where job_id=$1 and workspace_id=$2 order by received_at",
          [id, ctx.workspaceId],
        )
      ).rows,
    };
  });
}
export async function listJobs(ctx: Context) {
  authorize(ctx, "read");
  return scoped(
    ctx,
    async (tx) =>
      (
        await tx.query(
          "select j.*,a.handle,a.platform,ap.snapshot,ap.scheduled_at,p.title from publish_jobs j join social_accounts a on a.id=j.account_id join publication_targets t on t.id=j.target_id join approvals ap on ap.id=t.approval_id join platform_variants v on v.id=ap.variant_id join content_packages p on p.id=v.package_id where j.workspace_id=$1 order by ap.scheduled_at desc",
          [ctx.workspaceId],
        )
      ).rows,
  );
}
