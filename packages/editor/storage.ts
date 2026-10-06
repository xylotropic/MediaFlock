import { compileRenderPlan, type EditorProject } from "./project";
import type { EditorScopeLease } from "./scope";
import {
  EDITOR_AUDIO_BITRATE,
  EDITOR_VIDEO_BITRATE,
  EDITOR_CONTAINER_OVERHEAD_BYTES,
  PCM_CHANNELS,
  PCM_RATE,
  PCM_SAMPLE_BYTES,
} from "./render-format";

export const EDITOR_STORAGE_LOCK = "mediaflock-editor-storage-v1";
export const EDITOR_STORAGE_SPARE_BYTES = 256 * 1024 ** 2;
export const EDITOR_STORAGE_OVERHEAD_BYTES = 64 * 1024 ** 2;

function validBytes(bytes: number): number {
  if (!Number.isSafeInteger(bytes) || bytes < 0)
    throw new Error(
      "The local storage requirement is outside its supported range.",
    );
  return bytes;
}
export function importStorageBytes(bytes: number): number {
  return validBytes(2 * validBytes(bytes) + EDITOR_STORAGE_OVERHEAD_BYTES);
}
export function exportStorageBudget(project: EditorProject): {
  requiredBytes: number;
  outputBytes: number;
} {
  const plan = compileRenderPlan(project);
  const used = new Set(plan.clips.map((clip) => clip.sourceId));
  // Audio preparation decodes whole used originals, including muted clips.
  const pcm = plan.sources
    .filter((source) => used.has(source.id) && source.hasAudio)
    .reduce(
      (bytes, source) =>
        bytes +
        Math.round((source.durationUs * PCM_RATE) / 1_000_000) *
          PCM_CHANNELS *
          PCM_SAMPLE_BYTES,
      0,
    );
  const duration =
    (plan.videoFrames * plan.output.fps.denominator) /
    plan.output.fps.numerator;
  // Bitrates are targets, not hard bounds. Allow encoder/container headroom
  // and duplicated staged writes; actual quota failures still remain possible.
  const video =
    EDITOR_CONTAINER_OVERHEAD_BYTES +
    Math.ceil(
      ((duration * (EDITOR_VIDEO_BITRATE + EDITOR_AUDIO_BITRATE)) / 8) * 1.25,
    );
  return {
    requiredBytes: validBytes(
      2 * pcm + 2 * video + EDITOR_STORAGE_OVERHEAD_BYTES,
    ),
    outputBytes: validBytes(video),
  };
}
export function exportStorageBytes(project: EditorProject): number {
  return exportStorageBudget(project).requiredBytes;
}
export function checkEditorStorageEstimate(
  estimate: StorageEstimate,
  requiredBytes: number,
): void {
  validBytes(requiredBytes);
  const { quota, usage } = estimate;
  if (
    quota === undefined ||
    usage === undefined ||
    !Number.isFinite(quota) ||
    !Number.isFinite(usage) ||
    quota < 0 ||
    usage < 0 ||
    usage > quota
  )
    throw new Error(
      "Chrome could not check local storage. Try again before importing or exporting a video.",
    );
  const required = validBytes(requiredBytes + EDITOR_STORAGE_SPARE_BYTES);
  if (quota - usage < required)
    throw new Error(
      `This operation needs about ${(required / 1024 ** 3).toFixed(2)} GB of free browser storage. Chrome reports ${(Math.max(0, quota - usage) / 1024 ** 3).toFixed(2)} GB available. Free space or use a shorter project.`,
    );
}

/** Admission is origin-wide: all editor scopes share the browser quota. Hold
 * this lock until owned writes, validation and cleanup have all settled. A
 * page crash releases the lock without leaving a stale reservation record. */
export async function withEditorStorage<T>(
  lease: EditorScopeLease,
  signal: AbortSignal | undefined,
  requiredBytes: number,
  work: () => Promise<T>,
  resourceLock?: string,
): Promise<T> {
  validBytes(requiredBytes);
  const combined = AbortSignal.any([lease.signal, ...(signal ? [signal] : [])]);
  combined.throwIfAborted();
  return navigator.locks.request(
    EDITOR_STORAGE_LOCK,
    { mode: "exclusive", signal: combined },
    async () => {
      const admitted = async () => {
        combined.throwIfAborted();
        const estimate = await navigator.storage.estimate();
        combined.throwIfAborted();
        checkEditorStorageEstimate(estimate, requiredBytes);
        return work();
      };
      return resourceLock
        ? navigator.locks.request(
            resourceLock,
            { mode: "exclusive", signal: combined },
            admitted,
          )
        : admitted();
    },
  );
}
