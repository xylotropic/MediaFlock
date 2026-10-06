import { describe, expect, it } from "vitest";
import {
  admitMp4Presentation,
  assertMp4PresentationEnd,
} from "../packages/editor/container-clock";
import { audioMp4Fixture } from "./fixtures/editor-mp4";

describe("raw MP4 presentation admission", () => {
  it("preserves the declared priming and endpoint before demuxing", async () => {
    const tracks = await admitMp4Presentation(audioMp4Fixture());
    expect(tracks).toEqual([
      {
        id: 2,
        kind: "soun",
        timescale: 44100,
        mediaDuration: 8192,
        mediaStart: 1024,
        segmentDuration: 7168,
        movieTimescale: 44100,
      },
    ]);
    expect(Object.isFrozen(tracks)).toBe(true);
    expect(Object.isFrozen(tracks[0])).toBe(true);
  });
  it("rejects additional content edits even with unchanged packet cadence", async () => {
    await expect(
      admitMp4Presentation(
        audioMp4Fixture({
          edits: [
            { duration: 3584, start: 1024, rate: 0x10000 },
            { duration: 3584, start: 8192, rate: 0x10000 },
          ],
        }),
      ),
    ).rejects.toThrow(/container timing/);
  });
  it("rejects a single edit whose declared end was ignored by the packet reader", async () => {
    const [regular] = await admitMp4Presentation(audioMp4Fixture());
    expect(() => assertMp4PresentationEnd(regular, 7168 / 44100)).not.toThrow();
    const [trimmed] = await admitMp4Presentation(
      audioMp4Fixture({
        edits: [{ duration: 3000, start: 1024, rate: 0x10000 }],
      }),
    );
    expect(() => assertMp4PresentationEnd(trimmed, 7168 / 44100)).toThrow(
      /container timing/,
    );
  });
  it("rejects non-unit rates, empty edits, fragmented files and description changes", async () => {
    for (const file of [
      audioMp4Fixture({
        edits: [{ duration: 7168, start: 1024, rate: 0x20000 }],
      }),
      audioMp4Fixture({
        edits: [{ duration: 7168, start: -1, rate: 0x10000 }],
      }),
      audioMp4Fixture({ fragmented: true }),
      audioMp4Fixture({ descriptions: 2 }),
      audioMp4Fixture({ sampleDescription: 2 }),
    ])
      await expect(admitMp4Presentation(file)).rejects.toThrow(
        /container timing/,
      );
  });
  it("fails closed on corrupt bounds and does not let caching override cancellation", async () => {
    await expect(
      admitMp4Presentation(
        new File(
          [new Uint8Array([0, 0, 0, 4, 109, 111, 111, 118])],
          "broken.mp4",
        ),
      ),
    ).rejects.toThrow(/container timing/);
    const file = audioMp4Fixture();
    await admitMp4Presentation(file);
    const abort = new AbortController();
    abort.abort();
    await expect(
      admitMp4Presentation(file, abort.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
