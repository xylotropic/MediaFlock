import {
  frameAudioBoundary,
  frameTimeUs,
  sourceSampleTimeSeconds,
  type RenderPlan,
} from "./project";

/** Locate a half-open clip directly, including nonmonotonic source order. */
export function playbackPicture(plan: RenderPlan, frame: number) {
  if (!Number.isSafeInteger(frame) || frame < 0 || frame >= plan.videoFrames)
    throw new Error("The preview picture is outside the timeline.");
  let low = 0,
    high = plan.clips.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (plan.clips[mid].recordOutFrame <= frame) low = mid + 1;
    else high = mid;
  }
  const clip = plan.clips[low];
  if (!clip || clip.recordInFrame > frame)
    throw new Error("The preview timeline has a gap.");
  const source = plan.sources.find((source) => source.id === clip.sourceId);
  if (!source) throw new Error("The preview source is missing.");
  const localFrame = frame - clip.recordInFrame;
  return {
    frame,
    clip,
    source,
    sourceUs: clip.sourceInUs + frameTimeUs(localFrame, plan.output.fps),
    sampleSeconds: sourceSampleTimeSeconds(
      clip.sourceInUs,
      localFrame,
      plan.output.fps,
    ),
    audioFrame: frameAudioBoundary(frame, plan.output.fps),
    sourceAudioFrame:
      clip.sourceInAudioFrame +
      frameAudioBoundary(frame, plan.output.fps) -
      clip.recordInAudioFrame,
  };
}

/** Invert the shared rounded audio boundary, so fractional frame rates do
 * not slip back to the previous picture at an exact planned cut. */
export function playbackFrameAtAudio(
  plan: RenderPlan,
  audioFrame: number,
): number {
  if (
    !Number.isSafeInteger(audioFrame) ||
    audioFrame < 0 ||
    audioFrame > plan.audioFrames
  )
    throw new Error("The preview audio position is outside the timeline.");
  const fps = plan.output.fps;
  const numerator =
    BigInt(audioFrame + 1) * BigInt(fps.numerator) -
    BigInt(Math.floor(fps.numerator / 2)) -
    1n;
  return Math.min(
    plan.videoFrames - 1,
    Number(numerator / (48_000n * BigInt(fps.denominator))),
  );
}

/** At a buffering boundary the next half-open picture is not prepared yet.
 * Present the last available picture so preceding capacity can be released;
 * once decoding advances the frontier, use the normal exact cut inversion. */
export function playbackPreparedFrameAtAudio(
  plan: RenderPlan,
  audioFrame: number,
  frontier: number,
): number {
  if (
    !Number.isSafeInteger(frontier) ||
    frontier < 0 ||
    frontier > plan.audioFrames ||
    audioFrame > frontier
  )
    throw new Error("The audible position is beyond the prepared pictures.");
  const position =
    audioFrame === frontier && frontier < plan.audioFrames
      ? Math.max(0, audioFrame - 1)
      : audioFrame;
  return playbackFrameAtAudio(plan, position);
}
