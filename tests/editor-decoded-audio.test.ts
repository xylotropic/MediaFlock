import { describe, expect, it, vi } from "vitest";
import type { InputAudioTrack } from "mediabunny";
const streams = vi.hoisted(() => new WeakMap<object, unknown[]>());
vi.mock("mediabunny", () => ({
  AudioSampleSink: class {
    constructor(private track: object) {}
    async *samples() {
      for (const sample of streams.get(this.track) ?? []) yield sample;
    }
  },
}));
import { decodedStereoPcm } from "../packages/editor/decoded-audio";
const clock = {
  rate: 48000,
  channels: 1,
  firstNativeFrame: 0,
  endNativeFrame: 8,
  packetCount: 1,
};
function sample(start: number, count: number) {
  return {
    timestamp: start / 48000,
    sampleRate: 48000,
    numberOfChannels: 1,
    numberOfFrames: count,
    copyTo: (out: Float32Array, options: { frameOffset: number }) =>
      out.forEach((_, n) => {
        out[n] = start + options.frameOffset + n;
      }),
    close: vi.fn(),
  };
}
function track(values: unknown[]) {
  const value = {};
  streams.set(value, values);
  return value as InputAudioTrack;
}
async function read(values: unknown[], from = 0, to = 8) {
  const out: number[] = [];
  for await (const part of decodedStereoPcm(
    track(values),
    clock,
    from,
    to,
    new AbortController().signal,
  ))
    out.push(...part);
  return out;
}
describe("decoded audio coverage", () => {
  it("trims initial preroll and final padded frames while preserving channel order", async () => {
    const a = sample(-4, 8),
      b = sample(4, 8);
    expect(await read([a, b])).toEqual([
      0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7,
    ]);
    expect(a.close).toHaveBeenCalledOnce();
    expect(b.close).toHaveBeenCalledOnce();
  });
  it("rejects early EOF, no interior samples and missing postroll", async () => {
    for (const values of [[], [sample(0, 4)], [sample(0, 7)]])
      await expect(read(values)).rejects.toThrow(
        /required source audio endpoint/,
      );
  });
  it("rejects decoded gaps, repeated samples, format changes and fractional native clocks", async () => {
    for (const values of [
      [sample(0, 4), sample(5, 4)],
      [sample(0, 4), sample(3, 5)],
      [{ ...sample(0, 8), sampleRate: 44100 }],
      [{ ...sample(0, 8), timestamp: 0.25 / 48000 }],
    ])
      await expect(read(values)).rejects.toThrow(/discontinuous/);
  });
  it("closes its current sample after cancellation at a yield boundary", async () => {
    const a = sample(0, 8),
      abort = new AbortController(),
      iterator = decodedStereoPcm(track([a]), clock, 0, 8, abort.signal);
    await iterator.next();
    abort.abort();
    await expect(iterator.next()).rejects.toMatchObject({ name: "AbortError" });
    expect(a.close).toHaveBeenCalledOnce();
  });
});
