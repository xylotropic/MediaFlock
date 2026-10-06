import type { RenderCaption } from "./project";
/** A forward-only cursor preserves cue order and half-open boundaries without
 * rescanning every caption for every output picture. */
export class RenderCaptionCursor {
  private readonly events: { frame: number; index: number; enter: boolean }[];
  readonly boundaries: number[];
  private readonly active = new Map<number, RenderCaption>();
  private position = 0;
  private lastFrame = -1;
  constructor(private readonly captions: readonly RenderCaption[]) {
    this.events = captions
      .flatMap((c, index) => [
        { frame: c.inFrame, index, enter: true },
        { frame: c.outFrame, index, enter: false },
      ])
      .sort(
        (a, b) =>
          a.frame - b.frame ||
          Number(a.enter) - Number(b.enter) ||
          a.index - b.index,
      );
    this.boundaries = [...new Set(this.events.map((e) => e.frame))];
  }
  at(frame: number): RenderCaption[] {
    if (!Number.isSafeInteger(frame) || frame < 0 || frame < this.lastFrame)
      throw new Error("Caption pictures must advance in timeline order.");
    this.lastFrame = frame;
    while (
      this.position < this.events.length &&
      this.events[this.position].frame <= frame
    ) {
      const event = this.events[this.position++];
      if (event.enter) this.active.set(event.index, this.captions[event.index]);
      else this.active.delete(event.index);
    }
    if (this.active.size > 8)
      throw new Error(
        "More than eight captions overlap. Shorten or separate those cues before exporting.",
      );
    return [...this.active]
      .sort(([a], [b]) => a - b)
      .map(([, caption]) => caption);
  }
}
