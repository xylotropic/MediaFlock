import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import {
  compileRenderPlan,
  frameAudioBoundary,
  newEditorProject,
  type FrameRate,
} from "../packages/editor/project";
import {
  playbackFrameAtAudio,
  playbackPreparedFrameAtAudio,
  playbackPicture,
} from "../packages/editor/playback-plan";
import { playbackAudioWindow } from "../packages/editor/playback-audio";

function plan(fps: FrameRate = { numerator: 30, denominator: 1 }) {
  const p = newEditorProject(randomUUID(), "Playback boundary fixture"),
    id = randomUUID();
  p.output.fps = fps;
  p.sources.push({
    id,
    name: "fixture.mp4",
    bytes: 10,
    sha256: "a".repeat(64),
    durationUs: 6_000_000,
    width: 640,
    height: 360,
    hasAudio: true,
    rotation: "0",
  });
  for (const [inUs, outUs] of [
    [3_000_000, 5_000_000],
    [500_000, 2_500_000],
  ])
    p.clips.push({
      id: randomUUID(),
      sourceId: id,
      inUs,
      outUs,
      muted: false,
      effects: { brightness: 1, contrast: 1, saturation: 1, look: "original" },
    });
  return compileRenderPlan(p);
}
it("switches to the next reordered clip at its half-open record boundary", () => {
  const p = plan();
  expect(playbackPicture(p, 59).clip.id).toBe(p.clips[0].id);
  const cut = playbackPicture(p, 60);
  expect(cut.clip.id).toBe(p.clips[1].id);
  expect(cut.sourceUs).toBe(500_000);
  expect(cut.sourceAudioFrame).toBe(24_000);
  expect(playbackPicture(p, 119).sourceUs).toBe(2_466_667);
  expect(() => playbackPicture(p, 120)).toThrow(/outside/);
});
it.each([
  { numerator: 30, denominator: 1 },
  { numerator: 30000, denominator: 1001 },
  { numerator: 60000, denominator: 1001 },
])("inverts every exact rounded audio boundary for %j fps", (fps) => {
  const p = plan(fps);
  for (let n = 0; n < p.videoFrames; n++) {
    const audio = frameAudioBoundary(n, fps);
    expect(playbackFrameAtAudio(p, audio)).toBe(n);
    if (n > 0) expect(playbackFrameAtAudio(p, audio - 1)).toBe(n - 1);
  }
  expect(playbackFrameAtAudio(p, p.audioFrames)).toBe(p.videoFrames - 1);
});
it("keeps seek warmup on a shared native/48k integer phase", () => {
  for (const from of [0, 1, 5926, 24000, 144000, 277001, 259199999]) {
    const w = playbackAudioWindow(44100, 5_400_000_000, from, from + 1);
    expect(w.nativeStart % 147).toBe(0);
    expect(w.outputAnchor).toBe((w.nativeStart / 147) * 160);
    expect(Number.isInteger(w.outputAnchor)).toBe(true);
    expect(w.outputAnchor).toBeLessThanOrEqual(from);
    expect(w.nativeEnd).toBeLessThanOrEqual(238140000);
  }
});
it("uses the source duration for the native endpoint rather than a twice-rounded sample count", () => {
  const durationUs = 1_000_011;
  const w = playbackAudioWindow(44100, durationUs, 48000, 48001);
  expect(w.nativeEnd).toBe(Math.round((durationUs * 44100) / 1_000_000));
});

it("releases pictures at a stalled decoded frontier without requesting its unprepared next picture", () => {
  const p = plan(),
    frontier = frameAudioBoundary(13, p.output.fps);
  expect(playbackPreparedFrameAtAudio(p, frontier, frontier)).toBe(12);
  expect(playbackPreparedFrameAtAudio(p, frontier, frontier + 1600)).toBe(13);
  expect(playbackPreparedFrameAtAudio(p, p.audioFrames, p.audioFrames)).toBe(
    119,
  );
  expect(() => playbackPreparedFrameAtAudio(p, frontier + 1, frontier)).toThrow(
    /prepared/,
  );
});
