import { mkdtemp, writeFile, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { mediaRecipe, type MediaRecipe } from "../schemas";
import { scoped, one, audit, type Context, workerContext } from "../db";
import { authorize, storageAdmin } from "../domain/auth";
import { requireCondition, DomainError } from "../domain/errors";
import {
  uploadVerifiedOriginal,
  checkMediaQuota,
  checkGlobalMediaCapacity,
  boundedMediaStorage,
} from "./uploads";
export const checksum = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
export { runMediaProcess as runProcess } from "./parser";
import { runMediaProcess as runProcess } from "./parser";
export function identifyMime(bytes: Buffer) {
  if (
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "image/png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    return "image/jpeg";
  if (
    bytes.subarray(0, 4).toString() === "RIFF" &&
    bytes.subarray(8, 12).toString() === "WEBP"
  )
    return "image/webp";
  if (bytes.subarray(4, 8).toString() === "ftyp") {
    const brand = bytes.subarray(8, 12).toString();
    if (brand === "qt  ") return "video/quicktime";
    if (/^(isom|iso[2-9]|mp4[12]|avc1|av01|M4V |MSNV|dash)$/.test(brand))
      return "video/mp4";
  }
  throw new DomainError(
    "invalid_media",
    "Upload a PNG, JPEG, WebP or MP4/QuickTime file.",
  );
}
export async function probeBytes(bytes: Buffer) {
  requireCondition(
    bytes.length > 0 && bytes.length <= 52428800,
    "file_size",
    "Upload a file smaller than 50 MiB.",
  );
  const mimeType = identifyMime(bytes);
  const dir = await mkdtemp(join(tmpdir(), "mediaflock-upload-"));
  try {
    const path = join(dir, "source");
    await writeFile(path, bytes);
    const raw = JSON.parse(
      await runProcess(
        "ffprobe",
        [
          "-v",
          "error",
          "-protocol_whitelist",
          "file,pipe",
          "-show_format",
          "-show_streams",
          "-of",
          "json",
          path,
        ],
        20000,
      ),
    );
    const container = String(raw.format?.format_name || "");
    requireCondition(
      mimeType === "image/png"
        ? ["png_pipe", "apng"].includes(container)
        : mimeType === "image/jpeg"
          ? container === "jpeg_pipe"
          : mimeType === "image/webp"
            ? container === "webp_pipe"
            : container.split(",").includes("mov"),
      "mime_mismatch",
      "The file contents do not match the media type.",
    );
    const video = raw.streams?.find((x: any) => x.codec_type === "video");
    requireCondition(video, "invalid_media", "No valid picture stream found.");
    requireCondition(
      video.width <= 8192 && video.height <= 8192,
      "dimensions",
      "Media dimensions exceed the 8192-pixel limit.",
    );
    const duration = Number(raw.format?.duration) || null;
    requireCondition(
      duration === null || duration <= 3600,
      "duration",
      "Video must be one hour or shorter.",
    );
    return {
      mimeType,
      width: Number(video.width),
      height: Number(video.height),
      duration,
      bytes: bytes.length,
      checksum: checksum(bytes),
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
export async function uploadAsset(
  ctx: Context,
  filename: string,
  bytes: Buffer,
  tags: string[] = [],
  notes = "",
) {
  return uploadVerifiedOriginal(ctx, filename, bytes, tags, notes);
}
export async function listAssets(ctx: Context) {
  authorize(ctx, "read");
  return scoped(
    ctx,
    async (tx) =>
      (
        await tx.query(
          "select a.*,(select jsonb_agg(d order by d.created_at desc) from asset_derivatives d where d.asset_id=a.id) as derivatives from assets a where workspace_id=$1 order by created_at desc",
          [ctx.workspaceId],
        )
      ).rows,
  );
}
export async function assetBytes(ctx: Context, id: string, derivative = false) {
  authorize(ctx, "read");
  const item = await scoped(ctx, async (tx) =>
    one(
      tx,
      derivative
        ? "select d.*,a.mime_type from asset_derivatives d join assets a on a.id=d.asset_id where d.id=$1 and d.workspace_id=$2 and d.status='ready'"
        : "select * from assets where id=$1 and workspace_id=$2",
      [id, ctx.workspaceId],
    ),
  );
  requireCondition(item, "not_found", "Asset not found.", 404);
  const { data, error } = await storageAdmin()
    .storage.from("mediaflock")
    .download(item.storage_path);
  requireCondition(
    data && !error,
    "storage_failed",
    "Asset is unavailable in private storage.",
    503,
  );
  const bytes = Buffer.from(await data.arrayBuffer());
  requireCondition(
    checksum(bytes) === item.checksum,
    "checksum_mismatch",
    "Stored bytes do not match the original checksum.",
    409,
  );
  return {
    bytes,
    mimeType: derivative
      ? item.metadata?.mimeType || "video/mp4"
      : item.mime_type,
    filename: item.filename || "derivative",
    checksum: item.checksum,
  };
}
export async function requestDerivative(
  ctx: Context,
  id: string,
  input: unknown,
) {
  authorize(ctx, "draft");
  const recipe = mediaRecipe.parse(input);
  return scoped(ctx, async (tx) => {
    await checkMediaQuota(tx, ctx);
    const asset = await one(
      tx,
      "select * from assets where id=$1 and workspace_id=$2",
      [id, ctx.workspaceId],
    );
    requireCondition(asset, "not_found", "Asset not found.", 404);
    if (recipe.trimEnd !== undefined)
      requireCondition(
        asset.duration && recipe.trimEnd <= Number(asset.duration),
        "invalid_trim",
        "Trim end exceeds the source duration.",
      );
    if (recipe.thumbnailAt !== undefined)
      requireCondition(
        asset.duration && recipe.thumbnailAt < Number(asset.duration),
        "invalid_thumbnail",
        "Thumbnail time exceeds the source duration.",
      );
    requireCondition(
      !(asset.mime_type.startsWith("image/") && recipe.output === "mp4"),
      "invalid_conversion",
      "Choose PNG or JPEG for still images.",
    );
    const row = await one(
      tx,
      "insert into asset_derivatives(workspace_id,asset_id,recipe,status) values($1,$2,$3,'queued') returning *",
      [ctx.workspaceId, id, recipe],
    );
    await audit(
      tx,
      ctx,
      "media.processing_requested",
      "asset_derivative",
      row!.id,
      { recipe },
    );
    return row;
  });
}
export function ffmpegArgs(
  source: string,
  output: string,
  r: MediaRecipe,
  subtitlePath?: string,
) {
  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-nostdin",
    "-protocol_whitelist",
    "file,pipe",
    "-threads",
    "2",
    "-filter_threads",
    "2",
  ];
  if (r.thumbnailAt !== undefined) args.push("-ss", String(r.thumbnailAt));
  else if (r.trimStart) args.push("-ss", String(r.trimStart));
  args.push("-i", source);
  if (r.trimEnd !== undefined)
    args.push("-t", String(r.trimEnd - (r.trimStart || 0)));
  let vf: string;
  if (r.fit === "letterbox")
    vf = `scale=${r.width}:${r.height}:force_original_aspect_ratio=decrease,pad=${r.width}:${r.height}:(ow-iw)/2:(oh-ih)/2:black`;
  else if (r.fit === "crop")
    vf = `scale=${r.width}:${r.height}:force_original_aspect_ratio=increase,crop=${r.width}:${r.height}:(iw-ow)*${r.cropX}:(ih-oh)*${r.cropY}`;
  else vf = `scale=${r.width}:${r.height}`;
  if (subtitlePath)
    vf += `,subtitles=filename='${subtitlePath.replace(/['\\:]/g, "\\$&")}'`;
  args.push("-vf", vf);
  if (r.output === "mp4")
    args.push(
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "23",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-movflags",
      "+faststart",
      "-fs",
      "52428800",
    );
  else args.push("-frames:v", "1");
  args.push("-y", output);
  return args;
}
export async function processDerivative(job: Record<string, any>) {
  const ctx = workerContext(job.workspace_id);
  const recipe = mediaRecipe.parse(job.recipe);
  const { bytes, checksum: sourceHash } = await assetBytes(ctx, job.asset_id);
  const dir = await mkdtemp(join(tmpdir(), "mediaflock-process-"));
  try {
    const source = join(dir, "original"),
      output = join(dir, "result." + recipe.output);
    await writeFile(source, bytes, { mode: 0o600 });
    let subtitlePath: string | undefined;
    if (recipe.subtitles) {
      subtitlePath = join(dir, "captions.srt");
      requireCondition(
        /^\s*\d+\s*\n\d{2}:\d{2}:\d{2}[,.]\d{3} -->/m.test(recipe.subtitles),
        "invalid_subtitles",
        "Provide valid SRT subtitles.",
      );
      await writeFile(subtitlePath, recipe.subtitles, { mode: 0o600 });
    }
    await runProcess(
      "ffmpeg",
      ffmpegArgs(source, output, recipe, subtitlePath),
      120000,
    );
    requireCondition(
      (await stat(output)).size <= 52428800,
      "output_size",
      "Derivative exceeded 50 MiB.",
    );
    const result = await readFile(output),
      meta = await probeBytes(result);
    if (recipe.output === "mp4")
      await runProcess(
        "ffmpeg",
        [
          "-v",
          "error",
          "-xerror",
          "-protocol_whitelist",
          "file,pipe",
          "-i",
          output,
          "-f",
          "null",
          "-",
        ],
        120000,
      );
    requireCondition(
      checksum(await readFile(source)) === sourceHash,
      "source_changed",
      "Source preservation check failed.",
    );
    const path = `${ctx.workspaceId}/derivatives/${job.id}/${job.lease_token}/result.${recipe.output}`;
    await scoped(ctx, async (tx) => {
      await checkGlobalMediaCapacity(tx);
      const lease = await one(
        tx,
        "update asset_derivatives set lease_expires_at=now()+interval '5 minutes' where id=$1 and workspace_id=$2 and status='processing' and lease_token=$3 returning id",
        [job.id, ctx.workspaceId, job.lease_token],
      );
      requireCondition(
        lease,
        "media_lease_lost",
        "Media processing was recovered by another worker.",
        409,
      );
    });
    const { error } = await boundedMediaStorage().upload(path, result, {
      contentType: meta.mimeType,
      upsert: false,
    });
    requireCondition(!error, "storage_failed", "Derivative storage failed.");
    await scoped(ctx, async (tx) => {
      await tx.query(
        "update asset_derivatives set status='ready',storage_path=$1,checksum=$2,metadata=$3,error=null,lease_token=null,lease_expires_at=null where id=$4 and workspace_id=$5 and lease_token=$6",
        [path, meta.checksum, meta, job.id, ctx.workspaceId, job.lease_token],
      );
      await audit(tx, ctx, "media.processed", "asset_derivative", job.id, {
        originalChecksum: sourceHash,
        checksum: meta.checksum,
        bytes: meta.bytes,
      });
    });
    return meta;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
