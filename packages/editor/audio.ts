import { BlobSource, Input, MP4 } from "mediabunny";
import { create, ConverterType } from "@alexanderolsen/libsamplerate-js";
import type { LocalSource } from "./project";
import { admitLocalAacClock } from "./audio-clock";
import { decodedStereoPcm } from "./decoded-audio";
import {
  PCM_RATE,
  PCM_CHANNELS,
  PCM_SAMPLE_BYTES,
  PCM_BLOCK_FRAMES,
  checkedLocalWriteEnd,
} from "./render-format";
export { PCM_RATE, PCM_CHANNELS, PCM_BLOCK_FRAMES } from "./render-format";

export interface PreparedPcm {
  file: File | null;
  frames: number;
  bytes: number;
}
/** One sequential decode builds a source-aligned, file-backed PCM timeline.
 * AAC preroll is decoded, negative presentation samples are discarded, and
 * unexpected gaps fail. Declared audio-end silence is added before resampling. */
export async function preparePcm(
  source: LocalSource,
  file: File,
  target: FileSystemFileHandle,
  signal: AbortSignal,
  progress: (fraction: number) => void,
): Promise<PreparedPcm> {
  signal.throwIfAborted();
  const targetFrames = Math.round((source.durationUs * PCM_RATE) / 1_000_000);
  if (!source.hasAudio) return { file: null, frames: targetFrames, bytes: 0 };
  const input = new Input({
    formats: [MP4],
    source: new BlobSource(file, { maxCacheSize: 8 * 1024 ** 2 }),
  });
  const abort = () => input.dispose();
  signal.addEventListener("abort", abort, { once: true });
  let writable: FileSystemWritableFileStream | undefined,
    converter: Awaited<ReturnType<typeof create>> | undefined;
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track) throw new Error("The source audio track is unavailable.");
    const clock = await admitLocalAacClock(track, file, signal);
    const channels = await track.getNumberOfChannels(),
      rate = await track.getSampleRate();
    if (![1, 2].includes(channels) || ![44100, 48000].includes(rate))
      throw new Error(
        "The source audio format is outside this editor’s supported range.",
      );
    if (rate !== PCM_RATE)
      converter = await create(2, rate, PCM_RATE, {
        converterType: ConverterType.SRC_SINC_BEST_QUALITY,
      });
    signal.throwIfAborted();
    writable = await target.createWritable();
    const sourceFrames = Math.round((source.durationUs * rate) / 1_000_000);
    let inputFrame = 0,
      outputFrame = 0;
    const consume = async (stereo: Float32Array) => {
      signal.throwIfAborted();
      const output = converter ? converter.full(stereo) : stereo;
      const count = Math.min(output.length / 2, targetFrames - outputFrame);
      if (count > 0) {
        checkedLocalWriteEnd(
          outputFrame * PCM_CHANNELS * PCM_SAMPLE_BYTES,
          count * PCM_CHANNELS * PCM_SAMPLE_BYTES,
          targetFrames * PCM_CHANNELS * PCM_SAMPLE_BYTES,
        );
        const bytes = new Uint8Array(count * 8);
        bytes.set(new Uint8Array(output.buffer, output.byteOffset, count * 8));
        await writable!.write(bytes);
        outputFrame += count;
      }
      signal.throwIfAborted();
    };
    const silence = async (count: number) => {
      while (count > 0) {
        const n = Math.min(count, PCM_BLOCK_FRAMES);
        await consume(new Float32Array(n * 2));
        inputFrame += n;
        count -= n;
      }
    };
    const decodedEnd = Math.min(sourceFrames, clock.endNativeFrame);
    for await (const stereo of decodedStereoPcm(
      track,
      clock,
      0,
      decodedEnd,
      signal,
    )) {
      await consume(stereo);
      inputFrame += stereo.length / 2;
      progress(Math.min(1, inputFrame / sourceFrames));
    }
    // Reaching decodedEnd was verified by the iterator. Only the independent
    // container-declared track endpoint can authorize trailing silence.
    if (inputFrame < sourceFrames) await silence(sourceFrames - inputFrame);
    // The sinc filter needs zero extension beyond the source endpoint. Keep
    // only the declared presentation interval; this is not an audio shift.
    if (converter && outputFrame < targetFrames)
      await consume(new Float32Array(1024 * 2));
    if (outputFrame !== targetFrames)
      throw new Error(
        "The resampler did not produce the declared source endpoint.",
      );
    await writable.close();
    writable = undefined;
    signal.throwIfAborted();
    const pcm = await target.getFile();
    if (pcm.size !== targetFrames * 8)
      throw new Error("The prepared source audio is incomplete.");
    return { file: pcm, frames: targetFrames, bytes: pcm.size };
  } finally {
    signal.removeEventListener("abort", abort);
    input.dispose();
    converter?.destroy();
    if (writable) await writable.abort().catch(() => undefined);
  }
}
export async function readPcm(
  pcm: PreparedPcm,
  start: number,
  count: number,
  signal: AbortSignal,
): Promise<Float32Array> {
  signal.throwIfAborted();
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(count) ||
    start < 0 ||
    count < 1 ||
    count > PCM_BLOCK_FRAMES
  )
    throw new Error("The audio read exceeds its supported bounds.");
  const output = new Float32Array(count * 2);
  const available = Math.max(0, Math.min(count, pcm.frames - start));
  if (pcm.file && available) {
    const bytes = await pcm.file
      .slice(start * 8, (start + available) * 8)
      .arrayBuffer();
    if (bytes.byteLength !== available * 8)
      throw new Error("The prepared source audio read is incomplete.");
    output.set(new Float32Array(bytes));
  }
  signal.throwIfAborted();
  return output;
}
