import { AudioSampleSink, type InputAudioTrack } from "mediabunny";
import type { AdmittedAacClock } from "./audio-clock";
import { PCM_BLOCK_FRAMES } from "./render-format";

/** Return only verified decoded coverage. A missing interior sample fails;
 * callers may add separately declared silence after the admitted audio end. */
export async function* decodedStereoPcm(
  track: InputAudioTrack,
  clock: Readonly<AdmittedAacClock>,
  from: number,
  to: number,
  signal: AbortSignal,
): AsyncGenerator<Float32Array> {
  if (
    ![from, to].every(Number.isSafeInteger) ||
    from < 0 ||
    to < from ||
    to > clock.endNativeFrame
  )
    throw new Error(
      "The decoded audio interval is outside its admitted track.",
    );
  if (to === from) return;
  let next = from,
    accepted = false;
  const samples = new AudioSampleSink(track).samples(
    from / clock.rate,
    to / clock.rate,
  );
  try {
    for await (const sample of samples) {
      try {
        signal.throwIfAborted();
        const value = sample.timestamp * clock.rate,
          start = Math.round(value);
        if (
          sample.sampleRate !== clock.rate ||
          sample.numberOfChannels !== clock.channels ||
          !Number.isSafeInteger(start) ||
          !Number.isSafeInteger(sample.numberOfFrames) ||
          sample.numberOfFrames < 1 ||
          Math.abs(value - start) >
            Math.max(1e-6, Math.abs(value) * Number.EPSILON * 8) ||
          start > next ||
          (accepted && start !== next)
        )
          throw new Error(
            "The decoder returned missing or discontinuous source audio.",
          );
        let skipped = Math.max(0, next - start);
        while (skipped < sample.numberOfFrames && next < to) {
          const count = Math.min(
            PCM_BLOCK_FRAMES,
            sample.numberOfFrames - skipped,
            to - next,
          );
          const native = new Float32Array(count * clock.channels);
          sample.copyTo(native, {
            format: "f32",
            planeIndex: 0,
            frameOffset: skipped,
            frameCount: count,
          });
          const stereo =
            clock.channels === 2 ? native : new Float32Array(count * 2);
          if (clock.channels === 1)
            for (let n = 0; n < count; n++)
              stereo[2 * n] = stereo[2 * n + 1] = native[n];
          accepted = true;
          next += count;
          skipped += count;
          yield stereo;
          signal.throwIfAborted();
        }
      } finally {
        sample.close();
      }
      if (next >= to) break;
    }
    signal.throwIfAborted();
    if (next !== to)
      throw new Error(
        "The decoder stopped before the required source audio endpoint.",
      );
  } finally {
    await samples.return();
  }
}
