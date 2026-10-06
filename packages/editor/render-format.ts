/** Shared by the renderer and its disk-space preflight. */
export const EDITOR_VIDEO_BITRATE = 8_000_000;
export const EDITOR_AUDIO_BITRATE = 192_000;
export const PCM_RATE = 48_000;
export const PCM_CHANNELS = 2;
export const PCM_SAMPLE_BYTES = 4;
export const PCM_BLOCK_FRAMES = 16_384;
export const EDITOR_CONTAINER_OVERHEAD_BYTES = 32 * 1024 ** 2;

/** Check extension by end offset, since MP4 headers are rewritten in place. */
export function checkedLocalWriteEnd(
  position: number,
  bytes: number,
  limit: number,
): number {
  const end = position + bytes;
  if (
    ![position, bytes, limit, end].every(Number.isSafeInteger) ||
    position < 0 ||
    bytes < 0 ||
    limit < 0 ||
    end > limit
  )
    throw new Error("The local export exceeded its checked file-size limit.");
  return end;
}
