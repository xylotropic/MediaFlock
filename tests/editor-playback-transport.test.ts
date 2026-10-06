import { expect, it } from "vitest";
import {
  PlaybackPcmTransport,
  PLAYBACK_PCM_BUFFER_BYTES,
  playbackAudibleFrame,
  playbackObservedAudioFrame,
  type PlaybackTransfer,
} from "../packages/editor/playback-transport";

function block(
  epoch: string,
  start: number,
  frames: number,
  credit = 0,
): PlaybackTransfer {
  const buffer = new ArrayBuffer(PLAYBACK_PCM_BUFFER_BYTES),
    data = new Float32Array(buffer);
  for (let n = 0; n < frames; n++) {
    data[n * 2] = (start + n + 1) / 1000;
    data[n * 2 + 1] = -(start + n + 1) / 1000;
  }
  return { epoch, start, frames, credit, buffer };
}
function quantum(
  transport: PlaybackPcmTransport,
  context: number,
  frames: number,
) {
  const left = new Float32Array(frames),
    right = new Float32Array(frames);
  transport.process(left, right, context);
  return { left, right };
}
it("stops at the first unavailable sample within a quantum and resumes without skipping or repeating", () => {
  const returned: PlaybackTransfer[] = [],
    t = new PlaybackPcmTransport((b) => returned.push(b));
  t.reset("one", 0, 100);
  t.enqueue(block("one", 0, 13));
  t.ready("one", 100);
  t.play("one");
  const first = quantum(t, 0, 32);
  expect(t.snapshot().cursor).toBe(13);
  expect(t.snapshot().buffering).toBe(true);
  expect(first.left.slice(13)).toEqual(new Float32Array(19));
  expect(returned).toHaveLength(1);
  quantum(t, 32, 96);
  quantum(t, 128, 64);
  expect(t.snapshot().cursor).toBe(13);
  t.enqueue(block("one", 13, 87));
  quantum(t, 192, 32);
  expect(t.snapshot().cursor).toBe(13); // Refill does not grant resume.
  t.play("one");
  const next = quantum(t, 224, 96);
  expect(t.snapshot().cursor).toBe(100);
  expect(t.snapshot().ended).toBe(true);
  expect(next.left[0]).toBe(new Float32Array([0.014])[0]);
  expect(next.left[86]).toBe(new Float32Array([0.1])[0]);
  expect(next.left.slice(87)).toEqual(new Float32Array(9));
  expect(playbackAudibleFrame(t.snapshot().spans, 12)).toBe(12);
  expect(playbackAudibleFrame(t.snapshot().spans, 150)).toBe(13);
  expect(playbackAudibleFrame(t.snapshot().spans, 224)).toBe(13);
  expect(playbackAudibleFrame(t.snapshot().spans, 310)).toBe(99);
});
it("gates consumption on picture readiness even when PCM is already available", () => {
  const t = new PlaybackPcmTransport(() => {});
  t.reset("one", 0, 100);
  t.enqueue(block("one", 0, 100));
  t.ready("one", 17);
  t.play("one");
  quantum(t, 0, 64);
  expect(t.snapshot().cursor).toBe(17);
  expect(t.snapshot().buffering).toBe(true);
  t.ready("one", 100);
  quantum(t, 64, 64);
  expect(t.snapshot().cursor).toBe(17);
  t.play("one");
  quantum(t, 128, 128);
  expect(t.snapshot().cursor).toBe(100);
});
it("advances over genuine muted PCM, while buffering zeros do not advance", () => {
  const t = new PlaybackPcmTransport(() => {}),
    muted = block("one", 0, 32);
  new Float32Array(muted.buffer).fill(0);
  t.reset("one", 0, 64);
  t.enqueue(muted);
  t.ready("one", 64);
  t.play("one");
  quantum(t, 0, 64);
  expect(t.snapshot().cursor).toBe(32);
  expect(t.snapshot().buffering).toBe(true);
  expect(t.snapshot().spans).toEqual([
    { contextIn: 0, contextOut: 32, recordIn: 0, moving: true },
    { contextIn: 32, contextOut: 64, recordIn: 32, moving: false },
  ]);
});
it("returns old-generation buffers and never consumes stale queued PCM", () => {
  const returned: PlaybackTransfer[] = [],
    t = new PlaybackPcmTransport((b) => returned.push(b));
  t.reset("old", 0, 64);
  t.enqueue(block("old", 0, 64));
  t.play("old");
  t.ready("old", 64);
  t.reset("new", 10, 64);
  expect(returned).toHaveLength(1);
  expect(t.enqueue(block("old", 0, 64))).toBe(false);
  t.play("old");
  t.ready("old", 64);
  quantum(t, 0, 32);
  expect(t.snapshot().cursor).toBe(10);
  expect(t.snapshot().playing).toBe(false);
});
it("rejects duplicate credits, discontinuous blocks and unbounded transfer storage", () => {
  const t = new PlaybackPcmTransport(() => {});
  t.reset("one", 0, 100);
  t.enqueue(block("one", 0, 10));
  expect(() => t.enqueue(block("one", 10, 10))).toThrow(/Invalid/);
  expect(() => t.enqueue(block("one", 11, 10, 1))).toThrow(/discontinuous/);
  expect(() =>
    t.enqueue({ ...block("one", 10, 10, 1), buffer: new ArrayBuffer(1) }),
  ).toThrow(/Invalid/);
});
it("bounds mapping history and never invents an audible position outside it", () => {
  const t = new PlaybackPcmTransport(() => {});
  t.reset("one", 0, 1000);
  t.enqueue(block("one", 0, 1000));
  t.ready("one", 1000);
  for (let n = 0; n < 100; n++) {
    t.play("one");
    quantum(t, n * 2, 1);
    t.pause("one");
    quantum(t, n * 2 + 1, 1);
  }
  expect(t.snapshot().spans).toHaveLength(64);
  expect(playbackAudibleFrame(t.snapshot().spans, 0)).toBeNull();
  expect(playbackAudibleFrame(t.snapshot().spans, 200)).toBeNull();
  expect(t.snapshot().cursor).toBe(100);
});
it("expires presentation permission inside a quantum and requires an explicit release", () => {
  const t = new PlaybackPcmTransport(() => {});
  t.reset("one", 0, 100);
  t.enqueue(block("one", 0, 100));
  t.ready("one", 100);
  t.deadline("one", 17);
  t.play("one");
  quantum(t, 0, 64);
  expect(t.snapshot().cursor).toBe(17);
  expect(t.snapshot().buffering).toBe(true);
  t.deadline("old", 1000);
  t.deadline("one", 200);
  quantum(t, 64, 64);
  expect(t.snapshot().cursor).toBe(17);
  t.play("one");
  quantum(t, 128, 128);
  expect(t.snapshot().cursor).toBe(89);
  expect(t.snapshot().buffering).toBe(true);
  expect(t.snapshot().spans).toEqual([
    { contextIn: 0, contextOut: 17, recordIn: 0, moving: true },
    { contextIn: 17, contextOut: 128, recordIn: 17, moving: false },
    { contextIn: 128, contextOut: 200, recordIn: 17, moving: true },
    { contextIn: 200, contextOut: 256, recordIn: 89, moving: false },
  ]);
});

it("holds the last reported consumed endpoint when device time is just newer than its transport report", () => {
  const spans = [
    { contextIn: 896, contextOut: 4352, recordIn: 0, moving: false },
    { contextIn: 4352, contextOut: 25152, recordIn: 0, moving: true },
  ];
  // Real stalled-preview shape: report cadence trails the fresh device clock.
  expect(playbackAudibleFrame(spans, 25155)).toBeNull();
  expect(playbackObservedAudioFrame(spans, 25155)).toBe(20800);
  expect(playbackObservedAudioFrame(spans, 25555)).toBe(20800);
  expect(playbackObservedAudioFrame(spans, 100)).toBeNull();
  expect(playbackObservedAudioFrame(spans, Infinity)).toBeNull();
  const stalled = [
    ...spans,
    { contextIn: 25152, contextOut: 30000, recordIn: 20800, moving: false },
  ];
  expect(playbackObservedAudioFrame(stalled, 30003)).toBe(20800);
});
