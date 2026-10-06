import { z } from "zod";

const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const id = z.uuid();
const time = integer.max(5_400_000_000);
export const frameRateSchema = z
  .object({
    numerator: integer.min(1).max(60_000),
    denominator: integer.min(1).max(1_001),
  })
  .strict()
  .refine(
    (f) =>
      f.numerator / f.denominator >= 1 && f.numerator / f.denominator <= 60,
    "Frame rate must be between 1 and 60.",
  );
export const sourceSchema = z
  .object({
    id,
    name: z.string().min(1).max(512),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    bytes: integer.min(1).max(20 * 1024 ** 3),
    durationUs: time.min(1),
    width: integer.min(1).max(7680),
    height: integer.min(1).max(7680),
    hasAudio: z.boolean(),
    rotation: z.enum(["0", "90", "180", "270"]).default("0"),
  })
  .strict();
export const effectsSchema = z
  .object({
    brightness: z.number().min(0.25).max(2).default(1),
    contrast: z.number().min(0.25).max(2).default(1),
    saturation: z.number().min(0).max(2).default(1),
    look: z.enum(["original", "monochrome", "sepia"]).default("original"),
  })
  .strict();
export const clipSchema = z
  .object({
    id,
    sourceId: id,
    inUs: time,
    outUs: time.min(1),
    muted: z.boolean().default(false),
    effects: effectsSchema.default({
      brightness: 1,
      contrast: 1,
      saturation: 1,
      look: "original",
    }),
  })
  .strict()
  .refine((c) => c.outUs > c.inUs, "A clip needs a positive half-open range.");
export const captionSchema = z
  .object({
    id,
    sourceId: id,
    inUs: time,
    outUs: time.min(1),
    text: z.string().min(1).max(2000),
  })
  .strict()
  .refine(
    (c) => c.outUs > c.inUs,
    "A caption needs a positive half-open range.",
  );
export const projectSchema = z
  .object({
    schemaVersion: z.literal(1),
    id,
    name: z.string().min(1).max(200),
    editSequence: integer,
    sources: z.array(sourceSchema).max(32),
    clips: z.array(clipSchema).max(1000),
    captions: z.array(captionSchema).max(10_000),
    output: z
      .object({
        width: z.union([z.literal(720), z.literal(1080), z.literal(1920)]),
        height: z.union([z.literal(720), z.literal(1080), z.literal(1920)]),
        fps: frameRateSchema,
        fit: z.enum(["contain", "cover"]),
        captions: z.boolean(),
      })
      .strict(),
  })
  .strict()
  .superRefine((p, ctx) => {
    const sources = new Map(p.sources.map((s) => [s.id, s]));
    for (const [name, rows] of [
      ["sources", p.sources],
      ["clips", p.clips],
      ["captions", p.captions],
    ] as const) {
      if (new Set(rows.map((x) => x.id)).size !== rows.length)
        ctx.addIssue({
          code: "custom",
          path: [name],
          message: "IDs must be unique.",
        });
    }
    for (const [name, rows] of [
      ["clips", p.clips],
      ["captions", p.captions],
    ] as const)
      rows.forEach((row, index) => {
        const source = sources.get(row.sourceId);
        if (!source || row.outUs > source.durationUs)
          ctx.addIssue({
            code: "custom",
            path: [name, index],
            message: "The selected range must belong to an available source.",
          });
      });
  });
export type FrameRate = z.infer<typeof frameRateSchema>;
export type LocalSource = z.infer<typeof sourceSchema>;
export type EditorClip = z.infer<typeof clipSchema>;
export type SourceCaption = z.infer<typeof captionSchema>;
export type EditorProject = z.infer<typeof projectSchema>;
export const MAX_RENDER_CAPTIONS = 30_000;

function roundedRatio(n: bigint, d: bigint): number {
  const result = (n * 2n + d) / (d * 2n);
  if (result > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("The timeline boundary exceeds the supported range.");
  return Number(result);
}
/** Absolute boundaries avoid accumulating rounded frame/sample durations. */
export function frameTimeUs(frame: number, fps: FrameRate): number {
  integer.parse(frame);
  frameRateSchema.parse(fps);
  return roundedRatio(
    BigInt(frame) * BigInt(fps.denominator) * 1_000_000n,
    BigInt(fps.numerator),
  );
}
export function frameAudioBoundary(frame: number, fps: FrameRate): number {
  integer.parse(frame);
  frameRateSchema.parse(fps);
  return roundedRatio(
    BigInt(frame) * BigInt(fps.denominator) * 48_000n,
    BigInt(fps.numerator),
  );
}
/** Input packet selection uses continuous media time. Project boundaries are
 * stored at one-microsecond precision, so sample at the upper half of that
 * precision cell instead of rounding each scheduled frame down to a prior
 * packet. The tolerance is half a storage unit, not an extra video frame. */
export function sourceSampleTimeSeconds(
  inUs: number,
  frame: number,
  fps: FrameRate,
): number {
  time.parse(inUs);
  const offset = frameTimeUs(frame, fps);
  if (inUs + offset > 5_400_000_000)
    throw new Error("The picture sample exceeds the supported source range.");
  return (
    inUs / 1_000_000 +
    (frame * fps.denominator) / fps.numerator +
    0.5 / 1_000_000
  );
}
function timeAudioBoundary(us: number): number {
  return roundedRatio(BigInt(us) * 48_000n, 1_000_000n);
}
function ceilingFrame(us: number, fps: FrameRate): number {
  const n = BigInt(us) * BigInt(fps.numerator),
    d = 1_000_000n * BigInt(fps.denominator);
  return Number((n + d - 1n) / d);
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}
export interface RenderClip {
  id: string;
  sourceId: string;
  sourceInUs: number;
  sourceOutUs: number;
  requestedOutUs: number;
  trimmedUs: number;
  recordInFrame: number;
  recordOutFrame: number;
  recordInAudioFrame: number;
  recordOutAudioFrame: number;
  sourceInAudioFrame: number;
  sourceOutAudioFrame: number;
  tailSilenceFrames: number;
  muted: boolean;
  effects: EditorClip["effects"];
}
export interface RenderCaption {
  id: string;
  clipId: string;
  inFrame: number;
  outFrame: number;
  text: string;
}
export interface RenderPlan {
  version: 1;
  projectId: string;
  editSequence: number;
  output: EditorProject["output"];
  sources: LocalSource[];
  clips: RenderClip[];
  captions: RenderCaption[];
  videoFrames: number;
  audioFrames: number;
  durationUs: number;
}
/** Compile a sealed snapshot. All media ranges are half-open. Short fractional
 * tails are explicitly reported, never hidden in repeated duration rounding. */
export function compileRenderPlan(input: EditorProject): RenderPlan {
  const project = projectSchema.parse(input),
    fps = project.output.fps;
  const sources = new Map(project.sources.map((s) => [s.id, s]));
  let recordFrame = 0;
  const captions: RenderCaption[] = [];
  const clips = project.clips.map((clip) => {
    const source = sources.get(clip.sourceId)!;
    let frames = Number(
      (BigInt(clip.outUs - clip.inUs) * BigInt(fps.numerator)) /
        (1_000_000n * BigInt(fps.denominator)),
    );
    // A frame boundary such as 1/30 s is represented as 33,333 microseconds.
    // Honor that rounded boundary without admitting a whole fractional frame.
    if (frameTimeUs(frames + 1, fps) <= clip.outUs - clip.inUs) frames++;
    if (!frames) throw new Error("The clip is shorter than one output frame.");
    const sourceOutUs = clip.inUs + frameTimeUs(frames, fps);
    const start = recordFrame,
      end = start + frames;
    const audioIn = frameAudioBoundary(start, fps),
      audioOut = frameAudioBoundary(end, fps);
    const sourceAudioIn = timeAudioBoundary(clip.inUs),
      sourceAudioAvailable = timeAudioBoundary(source.durationUs);
    const sourceAudioOut = Math.min(
      sourceAudioIn + audioOut - audioIn,
      sourceAudioAvailable,
    );
    const tailSilenceFrames =
      source.hasAudio && !clip.muted
        ? sourceAudioIn + audioOut - audioIn - sourceAudioOut
        : 0;
    if (tailSilenceFrames > 1)
      throw new Error("The clip audio selection exceeds its source.");
    if (project.output.captions)
      for (const cue of project.captions) {
        if (
          cue.sourceId !== clip.sourceId ||
          cue.outUs <= clip.inUs ||
          cue.inUs >= sourceOutUs
        )
          continue;
        const inFrame =
          start +
          Math.min(
            frames,
            ceilingFrame(Math.max(cue.inUs, clip.inUs) - clip.inUs, fps),
          );
        const outFrame =
          start +
          Math.min(
            frames,
            ceilingFrame(Math.min(cue.outUs, sourceOutUs) - clip.inUs, fps),
          );
        if (outFrame > inFrame) {
          if (captions.length >= MAX_RENDER_CAPTIONS)
            throw new Error("Repeated clips exceed the export caption limit.");
          captions.push({
            id: `${clip.id}:${cue.id}`,
            clipId: clip.id,
            inFrame,
            outFrame,
            text: cue.text,
          });
        }
      }
    recordFrame = end;
    return {
      id: clip.id,
      sourceId: clip.sourceId,
      sourceInUs: clip.inUs,
      sourceOutUs,
      requestedOutUs: clip.outUs,
      trimmedUs: clip.outUs - sourceOutUs,
      recordInFrame: start,
      recordOutFrame: end,
      recordInAudioFrame: audioIn,
      recordOutAudioFrame: audioOut,
      sourceInAudioFrame: sourceAudioIn,
      sourceOutAudioFrame: sourceAudioOut,
      tailSilenceFrames,
      muted: clip.muted,
      effects: clip.effects,
    };
  });
  if (!recordFrame || frameTimeUs(recordFrame, fps) > 5_400_000_000)
    throw new Error(
      "The export must contain between one frame and 90 minutes.",
    );
  return freeze({
    version: 1,
    projectId: project.id,
    editSequence: project.editSequence,
    output: project.output,
    sources: project.sources,
    clips,
    captions: captions.sort((a, b) => a.inFrame - b.inFrame),
    videoFrames: recordFrame,
    audioFrames: frameAudioBoundary(recordFrame, fps),
    durationUs: frameTimeUs(recordFrame, fps),
  });
}
export function newEditorProject(id: string, name: string): EditorProject {
  return projectSchema.parse({
    schemaVersion: 1,
    id,
    name,
    editSequence: 0,
    sources: [],
    clips: [],
    captions: [],
    output: {
      width: 1080,
      height: 1920,
      fps: { numerator: 30, denominator: 1 },
      fit: "cover",
      captions: true,
    },
  });
}
