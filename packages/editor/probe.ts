import { BlobSource, Input, MP4 } from "mediabunny";
import type { LocalSource } from "./project";
import type { EditorScopeLease } from "./scope";
import { admitLocalAacClock } from "./audio-clock";
import {
  admitMp4Presentation,
  assertMp4PresentationEnd,
} from "./container-clock";

export async function probeLocalSource(
  file: File,
  lease: EditorScopeLease,
  signal?: AbortSignal,
): Promise<
  Pick<LocalSource, "durationUs" | "width" | "height" | "hasAudio" | "rotation">
> {
  lease.assertActive();
  signal?.throwIfAborted();
  const presentations = await admitMp4Presentation(file, signal);
  lease.assertActive();
  const input = new Input({
    formats: [MP4],
    source: new BlobSource(file, { maxCacheSize: 8 * 1024 ** 2 }),
  });
  const abort = () => input.dispose();
  lease.signal.addEventListener("abort", abort, { once: true });
  signal?.addEventListener("abort", abort, { once: true });
  try {
    const video = await input.getPrimaryVideoTrack();
    if (!video) throw new Error("Choose a video with a picture track.");
    const presentation = presentations.find(
      (p) => p.id === video.id && p.kind === "vide",
    );
    if (!presentation)
      throw new Error("The video's presentation track is unavailable.");
    assertMp4PresentationEnd(presentation, await video.computeDuration());
    const audio = await input.getPrimaryAudioTrack();
    const codec = await video.getCodecParameterString();
    if (
      (await video.getCodec()) !== "avc" ||
      !codec ||
      !/^avc[13]\.(42|4d|58|64)/i.test(codec) ||
      (await video.hasHighDynamicRange())
    )
      throw new Error(
        "This editor currently accepts SDR H.264 MP4 videos. Convert a separate copy locally before importing other formats.",
      );
    if (!(await video.canDecode()) || (audio && !(await audio.canDecode())))
      throw new Error(
        "This browser cannot decode the video’s picture or sound.",
      );
    if (
      audio &&
      ((await audio.getCodec()) !== "aac" ||
        ![1, 2].includes(await audio.getNumberOfChannels()) ||
        ![44100, 48000].includes(await audio.getSampleRate()))
    )
      throw new Error(
        "This editor currently accepts mono or stereo AAC audio at 44.1 or 48 kHz. Convert a separate copy locally for other sound formats.",
      );
    const durationUs = Math.round((await input.computeDuration()) * 1_000_000);
    if (audio) await admitLocalAacClock(audio, file, signal);
    if (
      !Number.isSafeInteger(durationUs) ||
      durationUs < 1 ||
      durationUs > 5_400_000_000
    )
      throw new Error("Choose a video up to 90 minutes long.");
    const width = Math.round(await video.getDisplayWidth()),
      height = Math.round(await video.getDisplayHeight());
    if (width * height > 3840 * 2160)
      throw new Error("Choose a video at 4K resolution or below.");
    if (await video.getFlip())
      throw new Error(
        "This video has a flipped display transform. Export a separate, correctly oriented copy locally first.",
      );
    lease.assertActive();
    signal?.throwIfAborted();
    return {
      durationUs,
      width,
      height,
      hasAudio: !!audio,
      rotation: String(await video.getRotation()) as LocalSource["rotation"],
    };
  } finally {
    lease.signal.removeEventListener("abort", abort);
    signal?.removeEventListener("abort", abort);
    input.dispose();
  }
}
