import { randomUUID } from "node:crypto";
import { db, scoped, one, workerContext, audit } from "../../packages/db";
import { getConfig } from "../../packages/domain/config";
import { safeError } from "../../packages/domain/errors";
import {
  publishingProvider,
  type PublishingProvider,
} from "../../packages/publishing";
import { normalizeMetrics, storeMetrics } from "../../packages/analytics";
export async function collectDueMetrics(
  provider?: PublishingProvider,
  max = 20,
  jobId?: string,
) {
  let count = 0;
  for (let n = 0; n < max; n++) {
    const lease = randomUUID();
    const claim = (
      await db().query(
        `with c as (select mc.id from metric_collection_jobs mc join workspaces w on w.id=mc.workspace_id where w.mode=$1 and ($3::uuid is null or mc.job_id=$3) and mc.state in ('queued','running') and mc.due_at<=now() and (mc.lease_expires_at is null or mc.lease_expires_at<now()) order by mc.due_at for update of mc skip locked limit 1) update metric_collection_jobs mc set state='running',lease_token=$2,lease_expires_at=now()+interval '60 seconds' from c where mc.id=c.id returning mc.*`,
        [getConfig().mode, lease, jobId || null],
      )
    ).rows[0];
    if (!claim) break;
    const ctx = workerContext(claim.workspace_id);
    const data = await scoped(ctx, async (tx) => {
      const job = await one(
        tx,
        "select * from publish_jobs where id=$1 and workspace_id=$2",
        [claim.job_id, ctx.workspaceId],
      );
      const account = job
        ? await one(
            tx,
            "select * from social_accounts where id=$1 and workspace_id=$2",
            [job.account_id, ctx.workspaceId],
          )
        : null;
      return { job, account };
    });
    try {
      if (!data.job || data.job.state !== "published" || !data.account)
        throw new Error("Publication is not confirmed.");
      const stale =
        getConfig().mode === "live" &&
        Date.now() - new Date(claim.due_at).getTime() > 15 * 60000;
      if (stale) {
        await scoped(ctx, async (tx) => {
          if (
            !(await one(
              tx,
              "select id from metric_collection_jobs where id=$1 and lease_token=$2 for update",
              [claim.id, lease],
            ))
          )
            return;
          const metrics = normalizeMetrics(
            data.account!.platform,
            {},
            data.account!.capabilities,
          ).map((x) => ({
            ...x,
            value: null,
            availability: "missed" as const,
          }));
          await storeMetrics(
            tx,
            ctx.workspaceId,
            data.job,
            data.account,
            claim.horizon_hours,
            metrics,
            {
              reason:
                "Scheduled observation was missed; historical value is unavailable.",
            },
          );
          await tx.query(
            "update metric_collection_jobs set state='missed',error='Historical observation unavailable',lease_token=null,lease_expires_at=null where id=$1 and lease_token=$2",
            [claim.id, lease],
          );
        });
        continue;
      }
      const activeProvider =
        provider || (await publishingProvider(ctx.workspaceId));
      const posts = await activeProvider.feed(
        data.account.provider_account_id,
        data.job!.platform_post_id,
      );
      const post = posts.find(
        (x) => x.platformPostId === data.job!.platform_post_id,
      );
      const metrics = normalizeMetrics(
        data.account.platform,
        post?.metrics || {},
        data.account.capabilities,
        getConfig().mode === "demo",
      );
      await scoped(ctx, async (tx) => {
        if (
          !(await one(
            tx,
            "select id from metric_collection_jobs where id=$1 and lease_token=$2 for update",
            [claim.id, lease],
          ))
        )
          return;
        await storeMetrics(
          tx,
          ctx.workspaceId,
          data.job,
          data.account,
          claim.horizon_hours,
          metrics,
          post?.raw || { reason: "Metric absent from permitted feed response" },
        );
        await tx.query(
          "update metric_collection_jobs set state='done',error=null,lease_token=null,lease_expires_at=null where id=$1 and workspace_id=$2 and lease_token=$3",
          [claim.id, ctx.workspaceId, lease],
        );
        await audit(tx, ctx, "metrics.collected", "publish_job", claim.job_id, {
          horizonHours: claim.horizon_hours,
          provenance: data.account!.provenance,
        });
      });
      count++;
    } catch (e) {
      await scoped(ctx, async (tx) => {
        await tx.query(
          "update metric_collection_jobs set state=case when retry_count>=3 then 'failed' else 'queued' end,error=$1,retry_count=retry_count+1,due_at=now()+interval '60 seconds',lease_token=null,lease_expires_at=null where id=$2 and workspace_id=$3 and lease_token=$4",
          [safeError(e), claim.id, ctx.workspaceId, lease],
        );
      });
    }
  }
  return count;
}
