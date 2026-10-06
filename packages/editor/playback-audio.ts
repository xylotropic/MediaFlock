import { BlobSource, Input, MP4 } from "mediabunny";
import { create, ConverterType } from "@alexanderolsen/libsamplerate-js";
import { sourceSchema, type LocalSource } from "./project";
import { PCM_RATE } from "./render-format";
import { PCM_BLOCK_FRAMES } from "./audio";
import { admitLocalAacClock } from "./audio-clock";
import { decodedStereoPcm } from "./decoded-audio";

export interface PlaybackPcmBlock {
  sourceFrame: number;
  data: Float32Array;
}

/** A seek starts on an integer boundary in both native and output clocks.
 * Filter history is warmed before the selected interval; equivalence with
 * whole-source preparation is qualified separately for supported inputs. */
export function playbackAudioWindow(
  rate: number,
  durationUs: number,
  from: number,
  to: number,
) {
  const sourceFrames = Math.round((durationUs * PCM_RATE) / 1_000_000);
  if (
    ![44100, PCM_RATE].includes(rate) ||
    ![durationUs, sourceFrames, from, to].every(Number.isSafeInteger) ||
    durationUs < 1 ||
    durationUs > 5_400_000_000 ||
    sourceFrames < 1 ||
    from < 0 ||
    to <= from ||
    to > sourceFrames + 1
  )
    throw new Error("The preview audio range is outside its source.");
  const period = rate === 44100 ? 147 : 1;
  const nativeStart =
    Math.floor(
      Math.max(0, Math.floor((from * rate) / PCM_RATE) - rate) / period,
    ) * period;
  const outputAnchor = (nativeStart * PCM_RATE) / rate;
  const nativeSourceFrames = Math.round((durationUs * rate) / 1_000_000);
  const nativeEnd = Math.min(
    nativeSourceFrames,
    Math.ceil((to * rate) / PCM_RATE) + 1024,
  );
  return { nativeStart, nativeEnd, outputAnchor };
}

/** Decode only an audible seek window, with bounded stateful resampling.
 * It creates no persistent files and never changes the original or its copy. */
export async function* playbackPcm(
  sourceInput: LocalSource,
  file: File,
  from: number,
  to: number,
  signal: AbortSignal,
): AsyncGenerator<PlaybackPcmBlock> {
  const source = sourceSchema.parse(sourceInput);
  if (file.size !== source.bytes)
    throw new Error("The preview source is incomplete.");
  signal.throwIfAborted();
  const sourceFrames = Math.round((source.durationUs * PCM_RATE) / 1_000_000);
  playbackAudioWindow(PCM_RATE, source.durationUs, from, to);
  if (!source.hasAudio) {
    for (let frame = from; frame < to; frame += PCM_BLOCK_FRAMES) {
      signal.throwIfAborted();
      yield {
        sourceFrame: frame,
        data: new Float32Array(Math.min(PCM_BLOCK_FRAMES, to - frame) * 2),
      };
      signal.throwIfAborted();
    }
    return;
  }
  const input = new Input({
    formats: [MP4],
    source: new BlobSource(file, { maxCacheSize: 8 * 1024 ** 2 }),
  });
  const abort = () => input.dispose();
  signal.addEventListener("abort", abort, { once: true });
  let converter: Awaited<ReturnType<typeof create>> | undefined;
  let samples: ReturnType<typeof decodedStereoPcm> | undefined;
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track) throw new Error("The preview source audio is unavailable.");
    const clock = await admitLocalAacClock(track, file, signal);
    const rate = await track.getSampleRate(),
      channels = await track.getNumberOfChannels();
    if (![1, 2].includes(channels))
      throw new Error("The preview audio channel format is unsupported.");
    const window = playbackAudioWindow(rate, source.durationUs, from, to);
    if (rate !== PCM_RATE)
      converter = await create(2, rate, PCM_RATE, {
        converterType: ConverterType.SRC_SINC_BEST_QUALITY,
      });
    signal.throwIfAborted();
    let nativeFrame = window.nativeStart,
      outputFrame = window.outputAnchor,
      emitted = from;
    async function* consume(
      stereo: Float32Array,
    ): AsyncGenerator<PlaybackPcmBlock> {
      signal.throwIfAborted();
      const output = converter ? converter.full(stereo) : stereo;
      const start = Math.max(from, outputFrame),
        end = Math.min(to, sourceFrames, outputFrame + output.length / 2);
      for (let frame = start; frame < end; frame += PCM_BLOCK_FRAMES) {
        signal.throwIfAborted();
        if (frame !== emitted)
          throw new Error("The preview audio window is discontinuous.");
        const count = Math.min(PCM_BLOCK_FRAMES, end - frame);
        const data = output.slice(
          (frame - outputFrame) * 2,
          (frame - outputFrame + count) * 2,
        );
        emitted += count;
        yield { sourceFrame: frame, data };
        signal.throwIfAborted();
      }
      outputFrame += output.length / 2;
    }
    async function* silence(count: number): AsyncGenerator<PlaybackPcmBlock> {
      while (count > 0) {
        signal.throwIfAborted();
        const n = Math.min(PCM_BLOCK_FRAMES, count);
        yield* consume(new Float32Array(n * 2));
        nativeFrame += n;
        count -= n;
      }
    }
    const decodedEnd = Math.min(window.nativeEnd, clock.endNativeFrame);
    if (nativeFrame < decodedEnd) {
      samples = decodedStereoPcm(track, clock, nativeFrame, decodedEnd, signal);
      for await (const stereo of samples) {
        yield* consume(stereo);
        nativeFrame += stereo.length / 2;
        if (emitted >= Math.min(to, sourceFrames)) break;
      }
    }
    if (
      emitted < Math.min(to, sourceFrames) &&
      nativeFrame < window.nativeEnd
    ) {
      if (nativeFrame < clock.endNativeFrame)
        throw new Error(
          "The preview decoder did not provide required interior filter context.",
        );
      yield* silence(window.nativeEnd - nativeFrame);
    }
    if (
      converter &&
      emitted < Math.min(to, sourceFrames) &&
      window.nativeEnd === Math.round((source.durationUs * rate) / 1_000_000)
    )
      yield* consume(new Float32Array(1024 * 2));
    if (emitted !== Math.min(to, sourceFrames))
      throw new Error(
        "The preview audio decoder did not reach the selected endpoint.",
      );
    if (emitted < to)
      yield {
        sourceFrame: emitted,
        data: new Float32Array((to - emitted) * 2),
      };
    signal.throwIfAborted();
  } catch (error) {
    // Disposing an in-flight decoder can report its own disposal error.
    // The caller's cancellation remains the authoritative outcome.
    signal.throwIfAborted();
    throw error;
  } finally {
    signal.removeEventListener("abort", abort);
    input.dispose();
    try {
      await samples?.return(undefined);
    } finally {
      converter?.destroy();
    }
  }
}
