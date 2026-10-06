import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  compileRenderPlan,
  newEditorProject,
  projectSchema,
  frameAudioBoundary,
  frameTimeUs,
  sourceSampleTimeSeconds,
  type EditorProject,
} from "../packages/editor/project";
function project(): EditorProject {
  const p = newEditorProject(randomUUID(), "Local editing fixture");
  p.sources.push({
    id: randomUUID(),
    name: "fixture.mp4",
    sha256: "a".repeat(64),
    bytes: 1000,
    durationUs: 5_400_000_000,
    width: 1920,
    height: 1080,
    hasAudio: true,
    rotation: "0",
  });
  return p;
}
function addClip(p: EditorProject, inUs: number, outUs: number) {
  p.clips.push({
    id: randomUUID(),
    sourceId: p.sources[0].id,
    inUs,
    outUs,
    muted: false,
    effects: { brightness: 1, contrast: 1, saturation: 1, look: "original" },
  });
}
describe("local editing project timing", () => {
  it("compiles exact 90-minute video and audio boundaries without media allocation", () => {
    const p = project();
    addClip(p, 0, 5_400_000_000);
    const plan = compileRenderPlan(p);
    expect(plan.videoFrames).toBe(162_000);
    expect(plan.audioFrames).toBe(259_200_000);
    expect(plan.durationUs).toBe(5_400_000_000);
    expect(plan.clips[0].tailSilenceFrames).toBe(0);
    expect(Object.isFrozen(plan.clips[0].effects)).toBe(true);
    p.clips[0].effects.brightness = 2;
    expect(plan.clips[0].effects.brightness).toBe(1);
  });
  it("uses absolute audio boundaries across 1000 fractional-rate cuts", () => {
    const p = project();
    p.output.fps = { numerator: 30000, denominator: 1001 };
    for (let i = 0; i < 1000; i++)
      addClip(p, i * 1_000_000, i * 1_000_000 + 300_300);
    const plan = compileRenderPlan(p);
    expect(plan.videoFrames).toBe(9000);
    expect(plan.audioFrames).toBe(14_414_400);
    expect(
      plan.clips.reduce(
        (n, c) => n + c.recordOutAudioFrame - c.recordInAudioFrame,
        0,
      ),
    ).toBe(plan.audioFrames);
    for (let i = 1; i < plan.clips.length; i++)
      expect(plan.clips[i].recordInAudioFrame).toBe(
        plan.clips[i - 1].recordOutAudioFrame,
      );
    expect(frameTimeUs(9000, p.output.fps)).toBe(300_300_000);
    expect(frameAudioBoundary(9000, p.output.fps)).toBe(14_414_400);
  });
  it("retains an output frame whose microsecond endpoint rounds downward", () => {
    const p = project();
    addClip(p, 500_000, 533_333);
    expect(compileRenderPlan(p).videoFrames).toBe(1);
    expect(compileRenderPlan(p).clips[0].trimmedUs).toBe(0);
    p.clips[0].outUs--;
    expect(() => compileRenderPlan(p)).toThrow(/shorter than one/);
  });
  it("selects the intended packet at rational frame boundaries throughout a long source", () => {
    const fps = { numerator: 30, denominator: 1 };
    for (const startFrame of [0, 810, 81_000, 161_190]) {
      const inUs = frameTimeUs(startFrame, fps);
      for (let n = 0; n < 810; n++) {
        const packet = Math.floor(sourceSampleTimeSeconds(inUs, n, fps) * 30);
        expect(packet).toBe(startFrame + n);
      }
    }
    expect(Math.floor(sourceSampleTimeSeconds(533_333, 0, fps) * 30)).toBe(16);
    expect(Math.floor(sourceSampleTimeSeconds(533_332, 0, fps) * 30)).toBe(15);
  });
  it("moves and trims source captions when clips are reordered", () => {
    const p = project();
    addClip(p, 3_000_000, 4_000_000);
    addClip(p, 500_000, 1_500_000);
    p.captions.push({
      id: randomUUID(),
      sourceId: p.sources[0].id,
      inUs: 1_000_000,
      outUs: 3_500_000,
      text: "A reviewed line",
    });
    const plan = compileRenderPlan(p);
    expect(plan.captions.map((c) => [c.inFrame, c.outFrame])).toEqual([
      [0, 15],
      [45, 60],
    ]);
    expect(plan.videoFrames).toBe(60);
    expect(plan.audioFrames).toBe(96_000);
  });
  it("reports output-frame quantization and rejects ranges outside immutable sources", () => {
    const p = project();
    addClip(p, 0, 1_010_000);
    expect(compileRenderPlan(p).clips[0].trimmedUs).toBe(10_000);
    p.clips[0].outUs = 5_400_000_001;
    expect(projectSchema.safeParse(p).success).toBe(false);
    p.clips[0].outUs = 100;
    expect(() => compileRenderPlan(p)).toThrow(/shorter than one/);
  });
  it("rejects duplicate IDs, remote references and arbitrary effect code", () => {
    const p = project();
    addClip(p, 0, 1_000_000);
    p.clips.push({ ...p.clips[0] });
    expect(projectSchema.safeParse(p).success).toBe(false);
    p.clips.pop();
    expect(
      projectSchema.safeParse({
        ...p,
        sources: [{ ...p.sources[0], url: "https://example.invalid/video" }],
      }).success,
    ).toBe(false);
    expect(
      projectSchema.safeParse({
        ...p,
        clips: [
          {
            ...p.clips[0],
            effects: { ...p.clips[0].effects, filter: "untrusted()" },
          },
        ],
      }).success,
    ).toBe(false);
  });
});
