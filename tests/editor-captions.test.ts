import { expect, it } from "vitest";
import { RenderCaptionCursor } from "../packages/editor/captions";
import type { RenderCaption } from "../packages/editor/project";
function cue(id: string, start: number, end: number): RenderCaption {
  return { id, clipId: "fixture", inFrame: start, outFrame: end, text: id };
}
it("keeps caption order and half-open boundaries when frames advance or jump", () => {
  const cursor = new RenderCaptionCursor([
    cue("first", 0, 30),
    cue("overlap", 10, 40),
    cue("next", 30, 60),
  ]);
  expect(cursor.at(0).map((c) => c.text)).toEqual(["first"]);
  expect(cursor.at(10).map((c) => c.text)).toEqual(["first", "overlap"]);
  expect(cursor.at(30).map((c) => c.text)).toEqual(["overlap", "next"]);
  expect(cursor.at(50).map((c) => c.text)).toEqual(["next"]);
  expect(cursor.at(60)).toEqual([]);
  expect(() => cursor.at(59)).toThrow(/advance/);
});
it("handles thousands of successive cues and rejects excessive simultaneous captions", () => {
  const cursor = new RenderCaptionCursor(
    Array.from({ length: 3000 }, (_, n) =>
      cue(String(n), n * 30, (n + 1) * 30),
    ),
  );
  for (let n = 0; n < 3000; n++) {
    expect(cursor.at(n * 30).map((c) => c.text)).toEqual([String(n)]);
    expect(cursor.at(n * 30 + 29).map((c) => c.text)).toEqual([String(n)]);
  }
  expect(cursor.at(90_000)).toEqual([]);
  const overlapping = new RenderCaptionCursor(
    Array.from({ length: 9 }, (_, n) => cue(String(n), 0, 30)),
  );
  expect(() => overlapping.at(0)).toThrow(/eight captions overlap/);
});
