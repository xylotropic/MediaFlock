import { randomUUID } from "node:crypto";
import { db, scoped, workerContext } from "../../packages/db";
import { getConfig } from "../../packages/domain/config";
import { processDerivative } from "../../packages/media";
import { safeError, publicError } from "../../packages/domain/errors";
import { validateAssetUpload } from "../../packages/media/uploads";
export async function processAssetUploadQueue(max = 3, uploadId?: string) {
  // URL grants expire after two hours. The extra fifteen minutes protects
  // in-flight uploads. Keep quarantined bytes; release only empty reservations.
  await db().query(
    `update asset_uploads u set status='expired',signed_url=null,
    reserved_bytes=(case when exists(select 1 from storage.objects o where o.bucket_id='mediaflock' and o.name=u.storage_path) then 52428800 else 0 end) +
      (case when exists(select 1 from storage.objects o where o.bucket_id='mediaflock' and o.name=u.final_storage_path) then 52428800 else 0 end),
    error='The upload expired before validation was requested.'
    from workspaces w where w.id=u.workspace_id and w.mode=$1 and u.status='awaiting_upload' and u.expires_at<now()`,
    [getConfig().mode],
  );
  await db().query(
    `update asset_uploads u set signed_url=null,
      reserved_bytes=(case when exists(select 1 from storage.objects o where o.bucket_id='mediaflock' and o.name=u.storage_path) then 52428800 else 0 end) +
        (case when exists(select 1 from storage.objects o where o.bucket_id='mediaflock' and o.name=u.final_storage_path) then 52428800 else 0 end)
    from workspaces w where w.id=u.workspace_id and w.mode=$1 and u.status in ('failed','expired')
      and u.reserved_bytes>0 and u.expires_at<now()`,
    [getConfig().mode],
  );
  let n = 0;
  for (let i = 0; i < max; i++) {
    const job = (
      await db().query(
        `with c as (
      select u.id from asset_uploads u join workspaces w on w.id=u.workspace_id
      where w.mode=$1 and ($3::uuid is null or u.id=$3) and
        (u.status='queued' or (u.status='validating' and u.lease_expires_at<now()))
      order by u.created_at for update of u skip locked limit 1)
      update asset_uploads u set status='validating',lease_token=$2,lease_expires_at=now()+interval '5 minutes'
      from c where u.id=c.id returning u.*`,
        [getConfig().mode, randomUUID(), uploadId || null],
      )
    ).rows[0];
    if (!job) break;
    try {
      await validateAssetUpload(job);
      n++;
    } catch (e) {
      console.error(
        JSON.stringify({
          event: "media.validation_failed",
          id: job.id,
          message: safeError(e),
        }),
      );
      const finalExists = (
        await db().query(
          "select exists(select 1 from storage.objects where bucket_id='mediaflock' and name=$1) as present",
          [job.final_storage_path],
        )
      ).rows[0].present;
      await scoped(workerContext(job.workspace_id), async (tx) => {
        await tx.query(
          "update asset_uploads set status='failed',error=$1,reserved_bytes=$5,signed_url=null,lease_token=null,lease_expires_at=null where id=$2 and workspace_id=$3 and lease_token=$4",
          [
            publicError(e).message,
            job.id,
            job.workspace_id,
            job.lease_token,
            finalExists ? 104857600 : 52428800,
          ],
        );
      });
    }
  }
  return n;
}
export async function processMediaQueue(max = 5, derivativeId?: string) {
  let n = derivativeId ? 0 : await processAssetUploadQueue(max);
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
