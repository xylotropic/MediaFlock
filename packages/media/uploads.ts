import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import {
  scoped,
  one,
  audit,
  type Context,
  type Tx,
  workerContext,
} from "../db";
import { authorize, storageAdmin } from "../domain/auth";
import { requireCondition } from "../domain/errors";
import { getConfig } from "../domain/config";
import { probeBytes, checksum } from "./index";

export const MAX_ORIGINAL_BYTES = 50 * 1024 * 1024;
export const ORIGINAL_RESERVATION_BYTES = 2 * MAX_ORIGINAL_BYTES;
export const WORKSPACE_MEDIA_BYTES = 1024 * 1024 * 1024;
export const uploadInput = z
  .object({
    requestId: z.uuid(),
    filename: z.string().min(1).max(255),
    bytes: z.number().int().min(1).max(MAX_ORIGINAL_BYTES),
    mimeType: z.enum([
      "image/png",
      "image/jpeg",
      "image/webp",
      "video/mp4",
      "video/quicktime",
    ]),
    checksum: z.string().regex(/^[a-f0-9]{64}$/),
    tags: z.array(z.string().max(50)).max(20).default([]),
    notes: z.string().max(5000).default(""),
  })
  .strict();
export type UploadInput = z.input<typeof uploadInput>;

export function boundedMediaStorage() {
  const config = getConfig();
  return createClient(config.supabaseUrl, config.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) =>
        fetch(input, { ...init, signal: AbortSignal.timeout(120000) }),
    },
  }).storage.from("mediaflock");
}

export function safeFilename(filename: string) {
  return (
    filename
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .replace(/^\.+/, "")
      .slice(0, 120) || "media"
  );
}

export function totalStorageLimit() {
  const configured = process.env.MEDIAFLOCK_STORAGE_TOTAL_BYTES;
  const limit =
    configured === undefined
      ? (getConfig().mode === "demo" ? 20 : 1) * WORKSPACE_MEDIA_BYTES
      : Number(configured);
  requireCondition(
    (configured === undefined || /^[0-9]+$/.test(configured)) &&
      Number.isSafeInteger(limit) &&
      limit > 0,
    "storage_configuration",
    "Set a valid total media storage allowance before uploading.",
    503,
  );
  return limit;
}

export async function checkGlobalMediaCapacity(tx: Tx, additionalBytes = 0) {
  await tx.query(
    "select pg_advisory_xact_lock(hashtextextended('media:global',0))",
  );
  const usage = await one(tx, "select mf_media_storage_usage() as used");
  requireCondition(
    Number(usage!.used) + additionalBytes <= totalStorageLimit(),
    "storage_capacity",
    "Media storage is full. Ask the workspace owner to review the storage allowance.",
    429,
  );
}

export async function checkMediaQuota(
  tx: Tx,
  ctx: Context,
  additionalBytes = MAX_ORIGINAL_BYTES,
) {
  await checkGlobalMediaCapacity(tx, additionalBytes);
  await tx.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [
    "media:" + ctx.workspaceId,
  ]);
  const quota = await one(
    tx,
    `select
    (select coalesce(sum(bytes),0) from assets where workspace_id=$1) +
    (select coalesce(sum(reserved_bytes+staged_bytes),0) from asset_uploads where workspace_id=$1) +
    (select coalesce(sum(case when status='ready' then coalesce((metadata->>'bytes')::bigint,52428800) else 52428800 end),0) from asset_derivatives where workspace_id=$1) as used,
    (select count(*) from asset_uploads where workspace_id=$1 and created_at>now()-interval '24 hours') +
    (select count(*) from asset_derivatives where workspace_id=$1 and created_at>now()-interval '24 hours') as daily,
    (select count(*) from asset_uploads where workspace_id=$1 and (status in ('queued','validating') or (status='awaiting_upload' and expires_at>now()))) +
    (select count(*) from asset_derivatives where workspace_id=$1 and status in ('queued','processing')) as pending`,
    [ctx.workspaceId],
  );
  requireCondition(
    Number(quota!.used) + additionalBytes <= WORKSPACE_MEDIA_BYTES,
    "media_quota",
    "This workspace has reached its 1 GiB media allowance.",
    429,
  );
  requireCondition(
    Number(quota!.daily) < 20,
    "upload_quota",
    "Create or upload up to 20 media files per workspace in 24 hours. Try again later.",
    429,
  );
  requireCondition(
    Number(quota!.pending) < 3,
    "upload_pending",
    "Three media files are already pending. Wait for validation before adding another file.",
    429,
  );
}

// Reserve both a 50 MiB staged file and a separate 50 MiB immutable original.
// A client cannot consume extra capacity by understating its selected file size.
async function reserve(
  tx: Tx,
  ctx: Context,
  input: z.output<typeof uploadInput>,
  direct: boolean,
) {
  await tx.query(
    "select pg_advisory_xact_lock(hashtextextended('media:global',0))",
  );
  await tx.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [
    "media:" + ctx.workspaceId,
  ]);
  const existing = await one(
    tx,
    "select * from asset_uploads where workspace_id=$1 and user_id=$2 and request_id=$3",
    [ctx.workspaceId, ctx.userId, input.requestId],
  );
  if (existing) {
    requireCondition(
      existing.filename === safeFilename(input.filename) &&
        Number(existing.declared_bytes) === input.bytes &&
        existing.declared_mime_type === input.mimeType &&
        existing.expected_checksum === input.checksum &&
        JSON.stringify(existing.tags) === JSON.stringify(input.tags) &&
        existing.notes === input.notes,
      "upload_request_changed",
      "This upload retry does not match the original file and notes.",
      409,
    );
    return existing;
  }
  await checkMediaQuota(tx, ctx, ORIGINAL_RESERVATION_BYTES);
  const uploadId = randomUUID(),
    filename = safeFilename(input.filename);
  const storagePath = `${ctx.workspaceId}/uploads/${uploadId}/${filename}`;
  const bucket = await storageAdmin().storage.getBucket("mediaflock");
  requireCondition(
    bucket.data &&
      !bucket.error &&
      !bucket.data.public &&
      typeof bucket.data.file_size_limit === "number" &&
      bucket.data.file_size_limit > 0 &&
      bucket.data.file_size_limit <= MAX_ORIGINAL_BYTES,
    "storage_configuration",
    "Private storage must enforce the 50 MiB file limit before uploading.",
    503,
  );
  let signedUrl: string | null = null;
  if (direct) {
    const { data, error } = await storageAdmin()
      .storage.from("mediaflock")
      .createSignedUploadUrl(storagePath, { upsert: false });
    requireCondition(
      data && !error,
      "storage_failed",
      "Private storage could not prepare the upload. Try again shortly.",
      503,
    );
    signedUrl = data.signedUrl;
  }
  return one(
    tx,
    `insert into asset_uploads(id,workspace_id,user_id,request_id,filename,storage_path,declared_mime_type,declared_bytes,expected_checksum,tags,notes,status,signed_url,lease_token,lease_expires_at)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,case when $14::uuid is null then null else now()+interval '5 minutes' end) returning *`,
    [
      uploadId,
      ctx.workspaceId,
      ctx.userId,
      input.requestId,
      filename,
      storagePath,
      input.mimeType,
      input.bytes,
      input.checksum,
      input.tags,
      input.notes,
      direct ? "awaiting_upload" : "validating",
      signedUrl,
      direct ? null : randomUUID(),
    ],
  );
}

function publicUpload(row: Record<string, any>, asset?: Record<string, any>) {
  return {
    id: row.id,
    status: row.status,
    expiresAt: new Date(
      new Date(row.expires_at).getTime() - 15 * 60 * 1000,
    ).toISOString(),
    error: row.error || undefined,
    asset: asset || undefined,
  };
}

export async function beginAssetUpload(ctx: Context, raw: unknown) {
  authorize(ctx, "draft");
  const input = uploadInput.parse(raw);
  return scoped(ctx, async (tx) => {
    const row = (await reserve(tx, ctx, input, true))!;
    if (row.status === "awaiting_upload")
      requireCondition(
        new Date(row.expires_at).getTime() - Date.now() > 15 * 60 * 1000,
        "upload_expired",
        "The upload link expired. Select the file again to start a new upload.",
        410,
      );
    const asset = row.asset_id
      ? await one(tx, "select * from assets where id=$1 and workspace_id=$2", [
          row.asset_id,
          ctx.workspaceId,
        ])
      : undefined;
    return {
      ...publicUpload(row, asset),
      ...(row.status === "awaiting_upload"
        ? { signedUrl: row.signed_url }
        : {}),
    };
  });
}

export async function getAssetUpload(ctx: Context, uploadId: string) {
  authorize(ctx, "read");
  return scoped(ctx, async (tx) => {
    const row = await one(
      tx,
      "select * from asset_uploads where id=$1 and workspace_id=$2",
      [uploadId, ctx.workspaceId],
    );
    requireCondition(row, "not_found", "Upload not found.", 404);
    const asset = row.asset_id
      ? await one(tx, "select * from assets where id=$1 and workspace_id=$2", [
          row.asset_id,
          ctx.workspaceId,
        ])
      : undefined;
    return publicUpload(row, asset);
  });
}

export async function completeAssetUpload(ctx: Context, uploadId: string) {
  authorize(ctx, "draft");
  await scoped(ctx, async (tx) => {
    const row = await one(
      tx,
      "select * from asset_uploads where id=$1 and workspace_id=$2 for update",
      [uploadId, ctx.workspaceId],
    );
    requireCondition(row, "not_found", "Upload not found.", 404);
    if (row.status !== "awaiting_upload") return;
    requireCondition(
      new Date(row.expires_at) > new Date(),
      "upload_expired",
      "The upload expired. Select the file again.",
      410,
    );
    const { data, error } = await storageAdmin()
      .storage.from("mediaflock")
      .info(row.storage_path);
    requireCondition(
      data && !error,
      "upload_missing",
      "Private storage has not received this file yet. Retry the upload.",
      409,
    );
    // Untrusted Storage metadata is an early rejection only. Actual bytes and
    // picture metadata are checked by the worker before an asset can be used.
    const metadataError =
      typeof data.size !== "number" ||
      data.size <= 0 ||
      data.size > MAX_ORIGINAL_BYTES ||
      data.size !== Number(row.declared_bytes)
        ? "The stored file size does not match the selected original."
        : data.contentType !== row.declared_mime_type
          ? "The stored file type does not match the selected media type."
          : null;
    if (metadataError) {
      await tx.query(
        "update asset_uploads set status='failed',reserved_bytes=52428800,signed_url=null,error=$1 where id=$2 and workspace_id=$3",
        [metadataError, uploadId, ctx.workspaceId],
      );
      return;
    }
    await tx.query(
      "update asset_uploads set status='queued',signed_url=null where id=$1 and workspace_id=$2",
      [uploadId, ctx.workspaceId],
    );
    await audit(
      tx,
      ctx,
      "asset.validation_requested",
      "asset_upload",
      uploadId,
    );
  });
  return getAssetUpload(ctx, uploadId);
}

export async function registerVerifiedUpload(
  ctx: Context,
  job: Record<string, any>,
  metadata: Awaited<ReturnType<typeof probeBytes>>,
  originalBytes: Buffer,
) {
  const row = await scoped(ctx, async (tx) => {
    await checkGlobalMediaCapacity(tx);
    const upload = await one(
      tx,
      "update asset_uploads set lease_expires_at=now()+interval '5 minutes' where id=$1 and workspace_id=$2 and status='validating' and lease_token=$3 returning *",
      [job.id, ctx.workspaceId, job.lease_token],
    );
    requireCondition(
      upload,
      "upload_lease_lost",
      "Upload validation was recovered by another worker.",
      409,
    );
    return upload;
  });
  requireCondition(
    metadata.bytes === Number(row.declared_bytes) &&
      metadata.checksum === row.expected_checksum &&
      originalBytes.length === metadata.bytes &&
      originalBytes.length <= MAX_ORIGINAL_BYTES &&
      checksum(originalBytes) === metadata.checksum,
    "checksum_mismatch",
    "Stored bytes do not match the selected original.",
    409,
  );
  requireCondition(
    metadata.mimeType === row.declared_mime_type,
    "mime_mismatch",
    "The actual file type does not match the selected media type.",
    409,
  );
  // The browser's grant names staging only. Even a later staging replay cannot
  // alter this final object. A recovered lease reuses a matching final object.
  const storage = boundedMediaStorage();
  const existingFinal = await storage.info(row.final_storage_path);
  if (!existingFinal.data) {
    const uploaded = await storage.upload(
      row.final_storage_path,
      originalBytes,
      {
        contentType: metadata.mimeType,
        upsert: false,
      },
    );
    if (uploaded.error) {
      const recoveredFinal = await storage.info(row.final_storage_path);
      requireCondition(
        recoveredFinal.data,
        "storage_failed",
        "Private storage could not save the verified original.",
        503,
      );
    }
  }
  const final = await readPrivateObject(row.final_storage_path);
  requireCondition(
    final.bytes.length === metadata.bytes &&
      checksum(final.bytes) === metadata.checksum &&
      final.mimeType === metadata.mimeType,
    "checksum_mismatch",
    "The saved original does not match the verified file.",
    409,
  );
  return scoped(ctx, async (tx) => {
    const current = await one(
      tx,
      "select * from asset_uploads where id=$1 and workspace_id=$2 and status='validating' and lease_token=$3 for update",
      [row.id, ctx.workspaceId, job.lease_token],
    );
    requireCondition(
      current &&
        current.final_storage_path === row.final_storage_path &&
        current.storage_path === row.storage_path &&
        current.expected_checksum === metadata.checksum &&
        current.declared_mime_type === metadata.mimeType &&
        Number(current.declared_bytes) === metadata.bytes,
      "upload_lease_lost",
      "Upload validation was recovered by another worker.",
      409,
    );
    const asset = await one(
      tx,
      `insert into assets(id,workspace_id,filename,storage_path,mime_type,bytes,checksum,width,height,duration,tags,notes,provenance)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'uploaded') returning *`,
      [
        row.id,
        ctx.workspaceId,
        row.filename,
        row.final_storage_path,
        metadata.mimeType,
        metadata.bytes,
        metadata.checksum,
        metadata.width,
        metadata.height,
        metadata.duration,
        row.tags,
        row.notes,
      ],
    );
    await tx.query(
      "update asset_uploads set status='ready',asset_id=$1,reserved_bytes=0,staged_bytes=$3,signed_url=null,lease_token=null,lease_expires_at=null,completed_at=now(),error=null where id=$1 and workspace_id=$2",
      [row.id, ctx.workspaceId, metadata.bytes],
    );
    await audit(tx, ctx, "asset.uploaded", "asset", row.id, {
      checksum: metadata.checksum,
      bytes: metadata.bytes,
    });
    return asset;
  });
}

async function readPrivateObject(storagePath: string) {
  const { data, error } = await boundedMediaStorage().createSignedUrl(
    storagePath,
    60,
  );
  requireCondition(
    data && !error,
    "storage_failed",
    "The file is unavailable in private storage.",
    503,
  );
  const response = await fetch(data.signedUrl, {
    signal: AbortSignal.timeout(120000),
  });
  requireCondition(
    response.ok && response.body,
    "storage_failed",
    "Private storage could not return the file.",
    503,
  );
  const contentLength = response.headers.get("content-length");
  requireCondition(
    !contentLength ||
      (/^[0-9]+$/.test(contentLength) &&
        Number(contentLength) <= MAX_ORIGINAL_BYTES),
    "file_size",
    "Upload must be 50 MiB or smaller.",
  );
  const reader = response.body.getReader(),
    chunks: Buffer[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      requireCondition(
        size <= MAX_ORIGINAL_BYTES,
        "file_size",
        "Upload must be 50 MiB or smaller.",
      );
      chunks.push(Buffer.from(chunk.value));
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  return {
    bytes: Buffer.concat(chunks, size),
    mimeType: response.headers
      .get("content-type")
      ?.split(";")[0]
      .trim()
      .toLowerCase(),
  };
}

export async function validateAssetUpload(job: Record<string, any>) {
  const ctx = workerContext(job.workspace_id);
  const stored = await readPrivateObject(job.storage_path);
  requireCondition(
    stored.mimeType === job.declared_mime_type,
    "mime_mismatch",
    "The stored file type does not match the selected media type.",
    409,
  );
  const metadata = await probeBytes(stored.bytes);
  return registerVerifiedUpload(ctx, job, metadata, stored.bytes);
}

// Multipart uploads remain supported on the local web service and test clients.
export async function uploadVerifiedOriginal(
  ctx: Context,
  filename: string,
  bytes: Buffer,
  tags: string[],
  notes: string,
) {
  authorize(ctx, "draft");
  const metadata = await probeBytes(bytes);
  const input = uploadInput.parse({
    requestId: randomUUID(),
    filename,
    bytes: metadata.bytes,
    mimeType: metadata.mimeType,
    checksum: metadata.checksum,
    tags,
    notes,
  });
  const row = (await scoped(ctx, (tx) => reserve(tx, ctx, input, false)))!;
  const { error } = await storageAdmin()
    .storage.from("mediaflock")
    .upload(row.storage_path, bytes, {
      contentType: metadata.mimeType,
      upsert: false,
    });
  requireCondition(
    !error,
    "storage_failed",
    "Private storage upload failed. Try again shortly.",
    503,
  );
  return registerVerifiedUpload(ctx, row, metadata, bytes);
}

export async function assetDownloadUrl(
  ctx: Context,
  assetId: string,
  derivative = false,
) {
  authorize(ctx, "read");
  const row = await scoped(ctx, (tx) =>
    one(
      tx,
      derivative
        ? "select d.*,a.filename from asset_derivatives d join assets a on a.id=d.asset_id where d.id=$1 and d.workspace_id=$2 and d.status='ready'"
        : "select * from assets where id=$1 and workspace_id=$2",
      [assetId, ctx.workspaceId],
    ),
  );
  requireCondition(row, "not_found", "Asset not found.", 404);
  const { data, error } = await storageAdmin()
    .storage.from("mediaflock")
    .createSignedUrl(row.storage_path, 60);
  requireCondition(
    data && !error,
    "storage_failed",
    "The original is unavailable in private storage.",
    503,
  );
  return data.signedUrl;
}
