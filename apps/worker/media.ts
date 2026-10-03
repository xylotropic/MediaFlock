import { randomUUID } from "node:crypto";
import { db, scoped, workerContext } from "../../packages/db";
import { getConfig } from "../../packages/domain/config";
import { processDerivative } from "../../packages/media";
import { safeError } from "../../packages/domain/errors";
export async function processMediaQueue(max = 5, derivativeId?: string) {
  let n = 0;
  for (let i = 0; i < max; i++) {
    const job = (
      await db().query(
        `with c as (select d.id from asset_derivatives d join workspaces w on w.id=d.workspace_id where w.mode=$1 and ($3::uuid is null or d.id=$3) and (d.status='queued' or (d.status='processing' and d.lease_expires_at<now())) order by d.created_at for update of d skip locked limit 1) update asset_derivatives d set status='processing',lease_token=$2,lease_expires_at=now()+interval '5 minutes' from c where d.id=c.id returning d.*`,
        [getConfig().mode, randomUUID(), derivativeId || null],
      )
    ).rows[0];
    if (!job) break;
    try {
      await processDerivative(job);
      n++;
    } catch (e) {
      await scoped(workerContext(job.workspace_id), async (tx) => {
        await tx.query(
          "update asset_derivatives set status='failed',error=$1,lease_token=null,lease_expires_at=null where id=$2 and workspace_id=$3 and lease_token=$4",
          [safeError(e), job.id, job.workspace_id, job.lease_token],
        );
      });
    }
  }
  return n;
}
