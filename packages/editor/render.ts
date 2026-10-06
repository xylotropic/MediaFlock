import { registerAacEncoder } from "@mediabunny/aac-encoder";
import {
  AudioSample,
  AudioSampleSource,
  BlobSource,
  CanvasSource,
  EncodedPacketSink,
  Input,
  MP4,
  Mp4OutputFormat,
  Output,
  StreamTarget,
  VideoSampleSink,
  canEncodeVideo,
} from "mediabunny";
import {
  compileRenderPlan,
  frameAudioBoundary,
  sourceSampleTimeSeconds,
  type EditorProject,
} from "./project";
import { drawComposition, captionLayout } from "./composition";
import { RenderCaptionCursor } from "./captions";
import {
  admitMp4Presentation,
  assertMp4PresentationEnd,
} from "./container-clock";
import {
  EDITOR_VIDEO_BITRATE,
  EDITOR_AUDIO_BITRATE,
  checkedLocalWriteEnd,
} from "./render-format";
import { exportStorageBudget } from "./storage";
import {
  PCM_BLOCK_FRAMES,
  preparePcm,
  readPcm,
  type PreparedPcm,
} from "./audio";

export interface RenderProgress {
  phase: "preparing" | "rendering" | "finalizing" | "validating";
  completed: number;
  total: number;
  sourceId?: string;
}
export interface RenderResult {
  file: File;
  videoFrames: number;
  audioFrames: number;
  projectId: string;
  editSequence: number;
  maxWriteBytes: number;
}
/** This runs in a dedicated worker. It writes a classic MP4 to a caller-owned
 * staging directory and returns only after file closure and endpoint checks. */
export async function renderLocalProject(
  project: EditorProject,
  files: Map<string, File>,
  directory: FileSystemDirectoryHandle,
  signal: AbortSignal,
  progress: (value: RenderProgress) => void,
): Promise<RenderResult> {
  const plan = compileRenderPlan(project),
    fps = plan.output.fps;
  const { outputBytes } = exportStorageBudget(project);
  signal.throwIfAborted();
  if (plan.output.width * plan.output.height > 1920 * 1080)
    throw new Error(
      "Exports support up to 1080p landscape or vertical resolution.",
    );
  if (
    !(await canEncodeVideo("avc", {
      width: plan.output.width,
      height: plan.output.height,
      frameRate: fps.numerator / fps.denominator,
    }))
  )
    throw new Error("This browser cannot encode this H.264 output format.");
  registerAacEncoder();
  const measuring = new OffscreenCanvas(1, 1).getContext("2d");
  if (!measuring)
    throw new Error("This browser cannot compose video captions.");
  const preflight = new RenderCaptionCursor(plan.captions);
  for (const boundary of preflight.boundaries) {
    signal.throwIfAborted();
    const active = preflight.at(boundary);
    if (active.length)
      captionLayout(measuring, plan.output.width, plan.output.height, active);
  }
  const captionCursor = new RenderCaptionCursor(plan.captions);
  const usedIds = new Set(plan.clips.map((c) => c.sourceId)),
    prepared = new Map<string, PreparedPcm>();
  const sources = plan.sources.filter((s) => usedIds.has(s.id));
  for (let n = 0; n < sources.length; n++) {
    signal.throwIfAborted();
    const source = sources[n],
      file = files.get(source.id);
    if (!file || file.size !== source.bytes)
      throw new Error("A local source file is missing or incomplete.");
    const target = await directory.getFileHandle(`pcm-${source.id}`, {
      create: true,
    });
    prepared.set(
      source.id,
      await preparePcm(source, file, target, signal, (fraction) =>
        progress({
          phase: "preparing",
          completed: n + fraction,
          total: sources.length,
          sourceId: source.id,
        }),
      ),
    );
  }
  signal.throwIfAborted();
  const canvas = new OffscreenCanvas(plan.output.width, plan.output.height),
    ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser cannot create an export canvas.");
  const handle = await directory.getFileHandle("video.mp4", { create: true });
  const writable = await handle.createWritable();
  let closed = false,
    maxWriteBytes = 0;
  let activeInput: Input | null = null;
  let activeSourceId: string | null = null,
    activeSink: VideoSampleSink | null = null;
  let output: Output | undefined;
  const abort = () => activeInput?.dispose();
  signal.addEventListener("abort", abort, { once: true });
  try {
    const stream = new WritableStream({
      write: async (chunk: {
        type: "write";
        position: number;
        data: Uint8Array<ArrayBuffer>;
      }) => {
        signal.throwIfAborted();
        maxWriteBytes = Math.max(maxWriteBytes, chunk.data.byteLength);
        if (chunk.data.byteLength > 4 * 1024 ** 2)
          throw new Error("The export writer exceeded its memory bound.");
        checkedLocalWriteEnd(
          chunk.position,
          chunk.data.byteLength,
          outputBytes,
        );
        await writable.write(chunk);
      },
      close: async () => {
        await writable.close();
        closed = true;
      },
      abort: async () => {
        await writable.abort().catch(() => undefined);
      },
    });
    output = new Output({
      format: new Mp4OutputFormat({ fastStart: "reserve" }),
      target: new StreamTarget(stream, {
        chunked: true,
        chunkSize: 4 * 1024 ** 2,
      }),
    });
    const video = new CanvasSource(canvas, {
      codec: "avc",
      bitrate: EDITOR_VIDEO_BITRATE,
      keyFrameInterval: 2,
    });
    const audio = new AudioSampleSource({
      codec: "aac",
      bitrate: EDITOR_AUDIO_BITRATE,
    });
    output.addVideoTrack(video, {
      frameRate: fps.numerator / fps.denominator,
      maximumPacketCount: plan.videoFrames + 8,
    });
    output.addAudioTrack(audio, {
      maximumPacketCount: Math.ceil(plan.audioFrames / 1024) + 16,
    });
    await output.start();
    let rendered = 0;
    for (const clip of plan.clips) {
      signal.throwIfAborted();
      const source = sources.find((s) => s.id === clip.sourceId)!,
        file = files.get(clip.sourceId)!;
      if (activeSourceId !== clip.sourceId) {
        activeInput?.dispose();
        activeInput = new Input({
          formats: [MP4],
          source: new BlobSource(file, { maxCacheSize: 8 * 1024 ** 2 }),
        });
        const track = await activeInput.getPrimaryVideoTrack();
        if (!track) throw new Error("A source picture track is missing.");
        const presentation = (await admitMp4Presentation(file, signal)).find(
          (p) => p.id === track.id && p.kind === "vide",
        );
        if (!presentation)
          throw new Error("The source presentation track is unavailable.");
        assertMp4PresentationEnd(presentation, await track.computeDuration());
        activeSink = new VideoSampleSink(track);
        activeSourceId = clip.sourceId;
      }
      const sink = activeSink!,
        pcm = prepared.get(clip.sourceId)!;
      function* timestamps() {
        for (let n = 0; n < clip.recordOutFrame - clip.recordInFrame; n++)
          yield sourceSampleTimeSeconds(clip.sourceInUs, n, fps);
      }
      let localFrame = 0;
      for await (const sample of sink.samplesAtTimestamps(timestamps())) {
        try {
          signal.throwIfAborted();
          const recordFrame = clip.recordInFrame + localFrame;
          drawComposition(
            ctx,
            null,
            source.width,
            source.height,
            plan.output.width,
            plan.output.height,
            plan.output.fit,
            clip.effects,
            captionCursor.at(recordFrame),
            sample
              ? (context, x, y, w, h) => sample.draw(context, x, y, w, h)
              : undefined,
          );
          await video.add(
            (recordFrame * fps.denominator) / fps.numerator,
            fps.denominator / fps.numerator,
          );
          const audioIn = frameAudioBoundary(recordFrame, fps),
            audioOut = frameAudioBoundary(recordFrame + 1, fps);
          for (
            let position = audioIn;
            position < audioOut;
            position += PCM_BLOCK_FRAMES
          ) {
            const count = Math.min(PCM_BLOCK_FRAMES, audioOut - position);
            const data = clip.muted
              ? new Float32Array(count * 2)
              : await readPcm(
                  pcm,
                  clip.sourceInAudioFrame + position - clip.recordInAudioFrame,
                  count,
                  signal,
                );
            const block = new AudioSample({
              data,
              format: "f32",
              sampleRate: 48000,
              numberOfChannels: 2,
              timestamp: position / 48000,
            });
            try {
              await audio.add(block);
            } finally {
              block.close();
            }
          }
          localFrame++;
          rendered++;
          if (rendered % 15 === 0 || rendered === plan.videoFrames)
            progress({
              phase: "rendering",
              completed: rendered,
              total: plan.videoFrames,
            });
        } finally {
          sample?.close();
        }
      }
      if (localFrame !== clip.recordOutFrame - clip.recordInFrame)
        throw new Error(
          "The picture decoder did not complete the selected clip.",
        );
    }
    signal.throwIfAborted();
    progress({ phase: "finalizing", completed: 0, total: 1 });
    await output.finalize();
    signal.throwIfAborted();
    if (!closed) throw new Error("The export file has not been closed.");
    const file = await handle.getFile();
    if (file.size > outputBytes)
      throw new Error(
        "The finished export exceeded its checked file-size limit.",
      );
    progress({ phase: "validating", completed: 0, total: 1 });
    const check = new Input({
      formats: [MP4],
      source: new BlobSource(file, { maxCacheSize: 8 * 1024 ** 2 }),
    });
    try {
      const picture = await check.getPrimaryVideoTrack(),
        sound = await check.getPrimaryAudioTrack();
      if (!picture || !sound)
        throw new Error("The export is missing picture or sound.");
      let videoFrames = 0,
        audioEnd = 0;
      for await (const packet of new EncodedPacketSink(picture).packets(
        undefined,
        undefined,
        { metadataOnly: true },
      )) {
        signal.throwIfAborted();
        if (!Number.isFinite(packet.timestamp))
          throw new Error("The export contains an invalid picture timestamp.");
        videoFrames++;
      }
      for await (const packet of new EncodedPacketSink(sound).packets(
        undefined,
        undefined,
        { metadataOnly: true },
      )) {
        signal.throwIfAborted();
        audioEnd = Math.max(
          audioEnd,
          Math.round((packet.timestamp + packet.duration) * 48000),
        );
      }
      if (videoFrames !== plan.videoFrames || audioEnd !== plan.audioFrames)
        throw new Error(
          "The export failed its picture or sound endpoint check.",
        );
      return {
        file,
        videoFrames,
        audioFrames: audioEnd,
        projectId: plan.projectId,
        editSequence: plan.editSequence,
        maxWriteBytes,
      };
    } finally {
      check.dispose();
    }
  } finally {
    signal.removeEventListener("abort", abort);
    activeInput?.dispose();
    if (!closed) {
      await output?.cancel().catch(() => undefined);
      await writable.abort().catch(() => undefined);
    }
  }
}
