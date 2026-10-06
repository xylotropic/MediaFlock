export const PLAYBACK_PCM_POOL_SIZE = 8;
export const PLAYBACK_PCM_BLOCK_FRAMES = 16_384;
export const PLAYBACK_PCM_BUFFER_BYTES = PLAYBACK_PCM_BLOCK_FRAMES * 2 * 4;
export interface PlaybackTransfer {
  epoch: string;
  credit: number;
  start: number;
  frames: number;
  buffer: ArrayBuffer;
}
export interface PlaybackSpan {
  contextIn: number;
  contextOut: number;
  recordIn: number;
  moving: boolean;
}
type Queued = PlaybackTransfer & { data: Float32Array; offset: number };

/** The rendering-thread transport advances only over contiguous media and
 * the decoded-video frontier. Buffering output is not timeline silence. */
export class PlaybackPcmTransport {
  private epoch = "";
  private end = 0;
  private cursor = 0;
  private queuedEnd = 0;
  private frontier = 0;
  private gate = false;
  private buffering = false;
  private contextDeadline = Infinity;
  private queue: Queued[] = [];
  private credits = new Set<number>();
  private spans: PlaybackSpan[] = [];
  constructor(private readonly release: (block: PlaybackTransfer) => void) {}
  reset(epoch: string, start: number, end: number): void {
    if (
      typeof epoch !== "string" ||
      !epoch ||
      epoch.length > 256 ||
      ![start, end].every(Number.isSafeInteger) ||
      start < 0 ||
      end <= start ||
      end > 259_200_000
    )
      throw new Error("Invalid playback generation.");
    this.retire();
    this.epoch = epoch;
    this.cursor = this.queuedEnd = this.frontier = start;
    this.end = end;
    this.contextDeadline = Infinity;
  }
  retire(): void {
    this.gate = false;
    this.buffering = false;
    this.epoch = "";
    for (const block of this.queue) this.release(block);
    this.queue = [];
    this.credits.clear();
    this.spans = [];
  }
  enqueue(block: PlaybackTransfer): boolean {
    if (block.epoch !== this.epoch || !this.epoch) {
      this.release(block);
      return false;
    }
    if (
      !Number.isSafeInteger(block.credit) ||
      block.credit < 0 ||
      block.credit >= PLAYBACK_PCM_POOL_SIZE ||
      this.credits.has(block.credit) ||
      this.queue.length >= PLAYBACK_PCM_POOL_SIZE ||
      !Number.isSafeInteger(block.start) ||
      block.start !== this.queuedEnd ||
      !Number.isSafeInteger(block.frames) ||
      block.frames < 1 ||
      block.frames > PLAYBACK_PCM_BLOCK_FRAMES ||
      block.start + block.frames > this.end ||
      !(block.buffer instanceof ArrayBuffer) ||
      block.buffer.byteLength !== PLAYBACK_PCM_BUFFER_BYTES
    )
      throw new Error("Invalid or discontinuous playback PCM.");
    this.credits.add(block.credit);
    this.queue.push({
      ...block,
      data: new Float32Array(block.buffer),
      offset: 0,
    });
    this.queuedEnd += block.frames;
    return true;
  }
  ready(epoch: string, frontier: number): void {
    if (epoch !== this.epoch) return;
    if (
      !Number.isSafeInteger(frontier) ||
      frontier < this.frontier ||
      frontier > this.end
    )
      throw new Error("Invalid playback picture frontier.");
    this.frontier = frontier;
  }
  play(epoch: string): void {
    if (epoch !== this.epoch || !epoch) return;
    this.gate = true;
    this.buffering = false;
  }
  pause(epoch: string): void {
    if (epoch === this.epoch) {
      this.gate = false;
      this.buffering = false;
    }
  }
  /** A short UI heartbeat lease also bounds advancement during presentation
   * stalls. Extending it never releases an already latched underrun. */
  deadline(epoch: string, contextFrame: number): void {
    if (epoch !== this.epoch) return;
    if (!Number.isSafeInteger(contextFrame) || contextFrame < 0)
      throw new Error("Invalid presentation deadline.");
    this.contextDeadline = contextFrame;
  }
  private map(
    contextIn: number,
    frames: number,
    recordIn: number,
    moving: boolean,
  ) {
    if (!frames) return;
    const previous = this.spans.at(-1);
    if (
      previous &&
      previous.moving === moving &&
      previous.contextOut === contextIn &&
      previous.recordIn +
        (moving ? previous.contextOut - previous.contextIn : 0) ===
        recordIn
    )
      previous.contextOut += frames;
    else {
      this.spans.push({
        contextIn,
        contextOut: contextIn + frames,
        recordIn,
        moving,
      });
      if (this.spans.length > 64) this.spans.shift();
    }
  }
  process(left: Float32Array, right: Float32Array, contextFrame: number): void {
    if (
      left.length !== right.length ||
      !Number.isSafeInteger(contextFrame) ||
      contextFrame < 0
    )
      throw new Error("Invalid playback rendering quantum.");
    left.fill(0);
    right.fill(0);
    let out = 0;
    while (this.gate && out < left.length && this.cursor < this.end) {
      const block = this.queue[0];
      const count = Math.min(
        left.length - out,
        this.end - this.cursor,
        this.frontier - this.cursor,
        Math.max(0, this.contextDeadline - contextFrame - out),
        block ? block.frames - block.offset : 0,
      );
      if (!block || count <= 0) {
        this.gate = false;
        this.buffering = true;
        break;
      }
      const before = this.cursor;
      for (let n = 0; n < count; n++) {
        left[out + n] = block.data[(block.offset + n) * 2];
        right[out + n] = block.data[(block.offset + n) * 2 + 1];
      }
      this.cursor += count;
      block.offset += count;
      this.map(contextFrame + out, count, before, true);
      out += count;
      if (block.offset === block.frames) {
        this.queue.shift();
        this.credits.delete(block.credit);
        this.release(block);
      }
    }
    if (this.cursor === this.end) this.gate = false;
    this.map(contextFrame + out, left.length - out, this.cursor, false);
  }
  snapshot() {
    return {
      epoch: this.epoch,
      cursor: this.cursor,
      queuedEnd: this.queuedEnd,
      frontier: this.frontier,
      playing: this.gate,
      buffering: this.buffering,
      ended: !!this.epoch && this.cursor === this.end,
      credits: this.credits.size,
      spans: this.spans.map((span) => ({ ...span })),
    };
  }
}

/** Map device output time through movement and buffering intervals. Unknown
 * history stays unknown; it must not be extrapolated across a stalled span. */
export function playbackAudibleFrame(
  spans: readonly PlaybackSpan[],
  contextFrame: number,
): number | null {
  if (!Number.isFinite(contextFrame) || contextFrame < 0) return null;
  const span = spans.find(
    (span) => span.contextIn <= contextFrame && span.contextOut > contextFrame,
  );
  return span
    ? span.recordIn +
        (span.moving ? Math.floor(contextFrame - span.contextIn) : 0)
    : null;
}

/** Device time may be newer than the latest bounded worklet report. Hold
 * that report's actual endpoint instead of inventing later consumption or
 * waiting forever for a report whose presentation cannot release capacity. */
export function playbackObservedAudioFrame(
  spans: readonly PlaybackSpan[],
  contextFrame: number,
): number | null {
  if (!Number.isFinite(contextFrame) || contextFrame < 0) return null;
  const known = playbackAudibleFrame(spans, contextFrame);
  if (known !== null) return known;
  const last = spans.at(-1);
  if (!last || contextFrame < last.contextOut) return null;
  return last.recordIn + (last.moving ? last.contextOut - last.contextIn : 0);
}
