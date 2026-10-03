import { randomUUID } from "node:crypto";
import {
  db,
  scoped,
  one,
  audit,
  workerContext,
  type Context,
} from "../../packages/db";
import { eligible } from "../../packages/domain/approvals";
import { getConfig } from "../../packages/domain/config";
import { safeError, DomainError } from "../../packages/domain/errors";
import {
  publishingProvider,
  ProviderError,
  type PublishingProvider,
  type DeliveryEnvelope,
  type Receipt,
} from "../../packages/publishing";
export async function claimJob(jobId?: string) {
  const tx = await db().connect();
  try {
    await tx.query("begin");
    const account = await one(
      tx,
      `select a.id from social_accounts a join workspaces w on w.id=a.workspace_id where w.mode=$1 and exists(select 1 from publish_jobs j where j.account_id=a.id and ($2::uuid is null or j.id=$2) and j.state not in ('published','failed','cancelled') and j.next_run_at<=now() and (j.lease_expires_at is null or j.lease_expires_at<now())) and not exists(select 1 from publish_jobs j where j.account_id=a.id and j.lease_expires_at>now()) order by a.id for update of a skip locked limit 1`,
      [getConfig().mode, jobId || null],
    );
    if (!account) {
      await tx.query("commit");
      return null;
    }
    const job = await one(
      tx,
      `select * from publish_jobs where account_id=$1 and ($2::uuid is null or id=$2) and state not in ('published','failed','cancelled') and next_run_at<=now() and (lease_expires_at is null or lease_expires_at<now()) order by next_run_at,created_at for update skip locked limit 1`,
      [account.id, jobId || null],
    );
    if (!job) {
      await tx.query("commit");
      return null;
    }
    const token = randomUUID();
    await tx.query(
      "update publish_jobs set lease_token=$1,lease_expires_at=now()+interval '180 seconds',generation=generation+1,updated_at=now() where id=$2",
      [token, job.id],
    );
    await tx.query("commit");
    return { ...job, lease_token: token, generation: job.generation + 1 };
  } catch (e) {
    await tx.query("rollback");
    throw e;
  } finally {
    tx.release();
  }
}
export async function processJob(
  claim: Record<string, any>,
  provider?: PublishingProvider,
) {
  const ctx = workerContext(claim.workspace_id);
  let reservation: any;
  try {
    provider = provider || (await publishingProvider(claim.workspace_id));
    reservation = await scoped(ctx, async (tx) => {
      const initial = await one(
        tx,
        "select a.variant_id from publish_jobs j join publication_targets t on t.id=j.target_id join approvals a on a.id=t.approval_id where j.id=$1 and j.workspace_id=$2",
        [claim.id, ctx.workspaceId],
      );
      if (!initial) return null;
      const variant = await one(
        tx,
        "select * from platform_variants where id=$1 and workspace_id=$2 for update",
        [initial.variant_id, ctx.workspaceId],
      );
      const job = await one(
        tx,
        "select j.*,t.local_key,a.id as approval_id,a.snapshot,a.snapshot_hash,a.status as approval_status,a.revision_id,a.scheduled_at from publish_jobs j join publication_targets t on t.id=j.target_id join approvals a on a.id=t.approval_id where j.id=$1 and j.workspace_id=$2 for update of j",
        [claim.id, ctx.workspaceId],
      );
      if (
        !job ||
        job.lease_token !== claim.lease_token ||
        ["published", "failed", "cancelled"].includes(job.state)
      )
        return null;
      const prior = await one(
        tx,
        "select id,provider_response from publish_attempts where job_id=$1 and operation='submit' and outcome<>'safe_rejection' order by started_at desc limit 1",
        [job.id],
      );
      // A fenced late receipt can still supply a provider ID for an authenticated read.
      if (!job.provider_job_id && prior?.provider_response?.providerJobId)
        job.provider_job_id = prior.provider_response.providerJobId;
      let operation: "submit" | "reconcile" | "status" | "cancel";
      if (job.provider_job_id)
        operation = job.cancel_requested ? "cancel" : "status";
      else if (
        prior ||
        job.state === "submitting" ||
        job.state === "needs_reconciliation"
      )
        operation = "reconcile";
      else if (job.cancel_requested) {
        await tx.query(
          "update publish_jobs set state='cancelled',lease_token=null,lease_expires_at=null where id=$1",
          [job.id],
        );
        await audit(tx, ctx, "delivery.cancelled", "publish_job", job.id);
        return null;
      } else operation = "submit";
      if (operation === "submit") {
        const approval = await one(
          tx,
          "select * from approvals where id=$1 and workspace_id=$2 for update",
          [job.approval_id, ctx.workspaceId],
        );
        await eligible(tx, ctx, approval!, variant!);
        const reviewer = await one(
          tx,
          "select role from memberships where workspace_id=$1 and user_id=$2 and role in ('owner','reviewer')",
          [ctx.workspaceId, approval!.approved_by],
        );
        if (!reviewer)
          throw new DomainError(
            "approval_reviewer_removed",
            "The approving reviewer no longer has permission. Obtain a fresh approval.",
            409,
          );
        // Live submissions cannot silently turn a missed schedule into an immediate publication.
        if (
          getConfig().mode === "live" &&
          new Date(job.scheduled_at).getTime() < Date.now() + 60000
        )
          throw new DomainError(
            "missed_schedule",
            "The approved schedule is too close or has passed. Choose a new time and obtain a new approval.",
            409,
          );
        await tx.query(
          "update publish_jobs set state='submitting' where id=$1",
          [job.id],
        );
      }
      const attempt = await one(
        tx,
        "insert into publish_attempts(workspace_id,job_id,operation,lease_token) values($1,$2,$3,$4) returning id",
        [ctx.workspaceId, job.id, operation, claim.lease_token],
      );
      await audit(
        tx,
        ctx,
        "delivery." + operation + "_started",
        "publish_job",
        job.id,
        {
          attemptId: attempt!.id,
          localKey: job.local_key,
          snapshotHash: job.snapshot_hash,
        },
      );
      return { job, operation, attemptId: attempt!.id };
    });
  } catch (error) {
    await scoped(ctx, async (tx) => {
      await tx.query(
        "update publish_jobs set state='failed',error=$1,lease_token=null,lease_expires_at=null,updated_at=now() where id=$2 and workspace_id=$3 and lease_token=$4",
        [
          {
            code:
              error instanceof DomainError ? error.code : "eligibility_failed",
            message: safeError(error),
          },
          claim.id,
          ctx.workspaceId,
          claim.lease_token,
        ],
      );
      await audit(
        tx,
        ctx,
        "delivery.eligibility_failed",
        "publish_job",
        claim.id,
        { message: safeError(error) },
      );
    });
    return;
  }
  if (!reservation) return;
  const { job, operation, attemptId } = reservation;
  const envelope = job.snapshot as DeliveryEnvelope;
  let receipt: Receipt | null = null;
  let error: unknown;
  try {
    if (operation === "submit")
      receipt = await provider.submit(
        envelope,
        job.local_key,
        job.snapshot_hash,
      );
    else if (operation === "reconcile")
      receipt = await provider.reconcile(
        job.local_key,
        job.snapshot_hash,
        envelope,
      );
    else if (operation === "cancel")
      receipt = await provider.cancel(job.provider_job_id, envelope);
    else receipt = await provider.status(job.provider_job_id, envelope);
  } catch (e) {
    error = e;
  }
  await scoped(ctx, async (tx) => {
    // Always retain a late response. A stale lease cannot apply it to the current lifecycle.
    await tx.query(
      "update publish_attempts set finished_at=now(),outcome=$1,error=$2,provider_response=$3 where id=$4 and workspace_id=$5",
      [
        error
          ? error instanceof ProviderError && error.safeToRetry
            ? "safe_rejection"
            : "uncertain"
          : receipt
            ? "response"
            : "no_match",
        error
          ? {
              classification:
                error instanceof ProviderError
                  ? error.classification
                  : "unknown",
              message: safeError(error),
            }
          : null,
        receipt || null,
        attemptId,
        ctx.workspaceId,
      ],
    );
    const current = await one(
      tx,
      "select * from publish_jobs where id=$1 and workspace_id=$2 for update",
      [job.id, ctx.workspaceId],
    );
    if (!current || current.lease_token !== claim.lease_token) {
      await audit(tx, ctx, "delivery.late_receipt", "publish_job", job.id, {
        attemptId,
      });
      return;
    }
    let state = current.state,
      err: any = null,
      delay = 1000;
    if (error) {
      const safe =
        error instanceof ProviderError &&
        error.safeToRetry &&
        operation === "submit";
      if (safe && current.retry_count < 4) {
        state = "queued";
        delay =
          Math.max(
            1000,
            (error instanceof ProviderError
              ? error.retryAfterSeconds || 0
              : 0) * 1000,
            1000 * 2 ** current.retry_count,
          ) + Math.floor(Math.random() * 250);
      } else if (safe) {
        state = "failed";
      } else state = "needs_reconciliation";
      err = {
        classification:
          error instanceof ProviderError ? error.classification : "unknown",
        message: safeError(error),
        deadLetter: safe && current.retry_count >= 4,
      };
    } else if (!receipt) {
      state = "needs_reconciliation";
      err = {
        classification: "no_match",
        message:
          "No authoritative matching provider job found. Automatic resubmission is blocked.",
      };
      delay = 60000;
    } else {
      state =
        receipt.authoritative && receipt.state !== "uncertain"
          ? receipt.state
          : "needs_reconciliation";
      if (receipt.error)
        err = { classification: "provider_result", message: receipt.error };
      if (current.cancel_requested && state === "published")
        err = {
          classification: "cancellation_race",
          message:
            "Publication completed before cancellation could be confirmed.",
        };
      if (current.cancel_requested && state === "scheduled") delay = 0;
    }
    if (state === "needs_reconciliation")
      delay = Math.max(
        delay,
        30000,
        error instanceof ProviderError
          ? (error.retryAfterSeconds || 0) * 1000
          : 0,
      );
    await tx.query(
      `update publish_jobs set state=$1,scheduling_owner=case when $2::text is not null then 'provider' else scheduling_owner end,provider_job_id=coalesce($2,provider_job_id),platform_post_id=coalesce($3,platform_post_id),receipt=coalesce($4,receipt),error=$5,retry_count=retry_count+$6,next_run_at=now()+($7*interval '1 millisecond'),lease_token=null,lease_expires_at=null,published_at=case when $1='published' then coalesce(published_at,now()) else published_at end,updated_at=now() where id=$8 and workspace_id=$9`,
      [
        state,
        receipt?.providerJobId || null,
        receipt?.platformPostId || null,
        receipt || null,
        err,
        error ? 1 : 0,
        delay,
        job.id,
        ctx.workspaceId,
      ],
    );
    await audit(tx, ctx, "delivery." + state, "publish_job", job.id, {
      attemptId,
      providerJobId: receipt?.providerJobId,
    });
    if (state === "published") {
      const horizons = (process.env.METRIC_HORIZONS || "1,24,72,168")
        .split(",")
        .map(Number)
        .filter((x) => x > 0 && x <= 720);
      for (const horizon of horizons)
        await tx.query(
          "insert into metric_collection_jobs(workspace_id,job_id,horizon_hours,due_at) values($1,$2,$3,now()+($3::integer*interval '1 hour')) on conflict(job_id,horizon_hours) do nothing",
          [ctx.workspaceId, job.id, horizon],
        );
    }
  });
}
export async function drainPublications(
  max = 30,
  provider?: PublishingProvider,
) {
  let n = 0;
  while (n < max) {
    const job = await claimJob();
    if (!job) break;
    await processJob(job, provider);
    n++;
  }
  return n;
}
export async function ingestProviderHint(
  ctx: Context,
  eventId: string,
  jobId: string,
  payload: unknown,
) {
  return scoped(ctx, async (tx) => {
    const job = await one(
      tx,
      "select id from publish_jobs where id=$1 and workspace_id=$2",
      [jobId, ctx.workspaceId],
    );
    if (!job) throw new DomainError("not_found", "Publication not found.", 404);
    const event = await one(
      tx,
      "insert into provider_events(workspace_id,provider_event_id,job_id,payload,authenticated) values($1,$2,$3,$4,false) on conflict(workspace_id,provider_event_id) do nothing returning id",
      [ctx.workspaceId, eventId, jobId, payload],
    );
    if (event)
      await tx.query(
        "update publish_jobs set next_run_at=now() where id=$1 and workspace_id=$2 and state not in ('published','cancelled','failed')",
        [jobId, ctx.workspaceId],
      );
    return event || null;
  });
}
