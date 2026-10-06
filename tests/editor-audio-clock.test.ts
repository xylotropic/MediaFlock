import { describe, expect, it, vi } from "vitest";
import type { InputAudioTrack } from "mediabunny";
const fixtures = vi.hoisted(
  () => new WeakMap<object, { timestamp: number; duration: number }[]>(),
);
vi.mock("mediabunny", () => ({
  EncodedPacketSink: class {
    constructor(private track: object) {}
    async *packets(
      _start: unknown,
      _end: unknown,
      options: { metadataOnly: boolean },
    ) {
      if (!options.metadataOnly)
        throw new Error("Admission must not read payload bytes.");
      for (const packet of fixtures.get(this.track) ?? []) yield packet;
    }
  },
}));
import { admitLocalAacClock } from "../packages/editor/audio-clock";
import { audioMp4Fixture } from "./fixtures/editor-mp4";
function track(
  packets: { timestamp: number; duration: number }[],
  overrides = {},
) {
  const value = {
    id: 2,
    getSampleRate: async () => 44100,
    getNumberOfChannels: async () => 1,
    getDecoderConfig: async () => ({
      codec: "mp4a.40.2",
      description: new Uint8Array([0x12, 0x08]),
    }),
    getTimeResolution: async () => 44100,
    ...overrides,
  };
  fixtures.set(value, packets);
  return value as unknown as InputAudioTrack;
}
const file = audioMp4Fixture;
const regular = (n: number, rate = 44100) =>
  Array.from({ length: n }, (_, i) => ({
    timestamp: ((i - 1) * 1024) / rate,
    duration: 1024 / rate,
  }));
describe("AAC packet-clock admission", () => {
  it("admits negative priming, an exact clock, and the final partial packet", async () => {
    const packets = regular(8);
    packets[7].duration = 608 / 44100;
    await expect(
      admitLocalAacClock(track(packets), file({ end: 6752 })),
    ).resolves.toMatchObject({
      firstNativeFrame: -1024,
      endNativeFrame: 6752,
      packetCount: 8,
    });
  });
  it("rejects the stretched-packet fixture before dense decoding can hide its gaps", async () => {
    const packets = regular(8);
    packets[3].duration = 2048 / 44100;
    for (let n = 4; n < 8; n++) packets[n].timestamp += 1024 / 44100;
    await expect(admitLocalAacClock(track(packets), file())).rejects.toThrow(
      /audio timing/,
    );
  });
  it("rejects discontinuous timestamps and a stretched final packet", async () => {
    const shifted = regular(8);
    shifted[5].timestamp += 3 / 44100;
    await expect(admitLocalAacClock(track(shifted), file())).rejects.toThrow(
      /timing/,
    );
    const final = regular(8);
    final[7].duration = 2048 / 44100;
    await expect(admitLocalAacClock(track(final), file())).rejects.toThrow(
      /timing/,
    );
  });
  it("rejects coarse fractional-sample timestamps and accumulated drift", async () => {
    const quantized = regular(20).map((p) => ({
      timestamp: Math.round(p.timestamp * 1000) / 1000,
      duration: Math.round(p.duration * 1000) / 1000,
    }));
    await expect(
      admitLocalAacClock(
        track(quantized, { getTimeResolution: async () => 1000 }),
        file(),
      ),
    ).rejects.toThrow(/timing/);
    const drift = regular(20).map((p, n) => ({
      ...p,
      timestamp: p.timestamp + n * 0.0002,
    }));
    await expect(
      admitLocalAacClock(
        track(drift, { getTimeResolution: async () => 1000 }),
        file(),
      ),
    ).rejects.toThrow(/timing/);
  });
  it("rejects unsupported frame profiles, missing descriptions and empty streams", async () => {
    await expect(
      admitLocalAacClock(
        track(regular(8), {
          getDecoderConfig: async () => ({
            codec: "mp4a.40.2",
            description: new Uint8Array([0x12, 0x0c]),
          }),
        }),
        file(),
      ),
    ).rejects.toThrow(/frame profile/);
    await expect(
      admitLocalAacClock(
        track(regular(8), {
          getDecoderConfig: async () => ({ codec: "mp4a.40.2" }),
        }),
        file(),
      ),
    ).rejects.toThrow(/AAC-LC/);
    await expect(admitLocalAacClock(track([]), file())).rejects.toThrow(
      /timing/,
    );
  });
  it("does not let cached admission override cancellation or a changed format", async () => {
    const f = file(),
      t = track(regular(8));
    await admitLocalAacClock(t, f);
    const abort = new AbortController();
    abort.abort();
    await expect(admitLocalAacClock(t, f, abort.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
    await expect(
      admitLocalAacClock(
        track(regular(8), { getSampleRate: async () => 96000 }),
        f,
      ),
    ).rejects.toThrow(/AAC-LC/);
  });
  it("checks the full AAC description, including explicit frequency, channels and absent SBR", async () => {
    const config = (description: number[]) => ({
      getDecoderConfig: async () => ({
        codec: "mp4a.40.2",
        description: new Uint8Array(description),
      }),
    });
    await expect(
      admitLocalAacClock(
        track(regular(8), config([0x12, 0x08, 0x56, 0xe5, 0])),
        file(),
      ),
    ).resolves.toMatchObject({ rate: 44100, channels: 1 });
    for (const description of [
      [0x11, 0x88],
      [0x12, 0x10],
      [0x12, 0x09],
      [0x12, 0x0a],
      [0x12, 0x08, 0x56, 0xe5, 0x80],
    ])
      await expect(
        admitLocalAacClock(track(regular(8), config(description)), file()),
      ).rejects.toThrow(/profile/);
  });
  it("binds cached admission to the selected track and configuration", async () => {
    const f = file();
    await admitLocalAacClock(track(regular(8)), f);
    await expect(
      admitLocalAacClock(track(regular(8), { id: 3 }), f),
    ).rejects.toThrow(/timing/);
    await expect(
      admitLocalAacClock(
        track(regular(8), {
          getDecoderConfig: async () => ({
            codec: "mp4a.40.2",
            description: new Uint8Array([0x12, 0x10]),
          }),
        }),
        f,
      ),
    ).rejects.toThrow(/profile/);
  });
  it("rejects an edit that truncates the packet presentation", async () => {
    await expect(
      admitLocalAacClock(
        track(regular(8)),
        file({ edits: [{ duration: 3000, start: 1024, rate: 0x10000 }] }),
      ),
    ).rejects.toThrow(/timing/);
  });
});
