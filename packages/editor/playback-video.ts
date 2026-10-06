import {
  BlobSource,
  Input,
  MP4,
  VideoSampleSink,
  type VideoSample,
} from "mediabunny";
import { drawComposition } from "./composition";
import { RenderCaptionCursor } from "./captions";
import { playbackPicture } from "./playback-plan";
import type { RenderPlan } from "./project";
import {
  admitMp4Presentation,
  assertMp4PresentationEnd,
} from "./container-clock";

export interface PlaybackPicture {
  frame: number;
  bitmap: ImageBitmap;
  clipId: string;
  sourceUs: number;
}

/** One forward decoder per cut, with one retained sample and lookahead.
 * SDK decoder queues and caches have their own additional memory cost. */
export async function* playbackPictures(
  plan: RenderPlan,
  files: ReadonlyMap<string, File>,
  firstFrame: number,
  signal: AbortSignal,
): AsyncGenerator<PlaybackPicture> {
  playbackPicture(plan, firstFrame);
  const canvas = new OffscreenCanvas(plan.output.width, plan.output.height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Timeline composition is unavailable.");
  const captions = new RenderCaptionCursor(plan.captions);
  for (const clip of plan.clips) {
    if (clip.recordOutFrame <= firstFrame) continue;
    signal.throwIfAborted();
    const start = Math.max(firstFrame, clip.recordInFrame);
    const first = playbackPicture(plan, start);
    const file = files.get(clip.sourceId);
    if (!file || file.size !== first.source.bytes)
      throw new Error("A local timeline source is missing or incomplete.");
    const input = new Input({
      formats: [MP4],
      source: new BlobSource(file, { maxCacheSize: 8 * 1024 ** 2 }),
    });
    const abort = () => input.dispose();
    signal.addEventListener("abort", abort, { once: true });
    let iterator: ReturnType<VideoSampleSink["samples"]> | undefined;
    let current: VideoSample | null = null,
      next: VideoSample | null = null;
    try {
      const track = await input.getPrimaryVideoTrack();
      signal.throwIfAborted();
      if (!track) throw new Error("A timeline video track is unavailable.");
      const presentation = (await admitMp4Presentation(file, signal)).find(
        (p) => p.id === track.id && p.kind === "vide",
      );
      if (!presentation)
        throw new Error("The timeline presentation track is unavailable.");
      assertMp4PresentationEnd(presentation, await track.computeDuration());
      iterator = new VideoSampleSink(track).samples(first.sampleSeconds);
      next = (await iterator.next()).value ?? null;
      for (let frame = start; frame < clip.recordOutFrame; frame++) {
        const picture = playbackPicture(plan, frame);
        signal.throwIfAborted();
        while (next && next.timestamp <= picture.sampleSeconds) {
          current?.close();
          current = next;
          next = null;
          next = (await iterator.next()).value ?? null;
          signal.throwIfAborted();
        }
        drawComposition(
          context,
          null,
          picture.source.width,
          picture.source.height,
          plan.output.width,
          plan.output.height,
          plan.output.fit,
          clip.effects,
          captions.at(frame),
          current
            ? (ctx, x, y, w, h) => current!.draw(ctx, x, y, w, h)
            : undefined,
        );
        const bitmap = canvas.transferToImageBitmap();
        if (signal.aborted) {
          bitmap.close();
          signal.throwIfAborted();
        }
        yield { frame, bitmap, clipId: clip.id, sourceUs: picture.sourceUs };
        signal.throwIfAborted();
      }
    } catch (error) {
      signal.throwIfAborted();
      throw error;
    } finally {
      signal.removeEventListener("abort", abort);
      current?.close();
      next?.close();
      input.dispose();
      await iterator?.return();
    }
  }
}
