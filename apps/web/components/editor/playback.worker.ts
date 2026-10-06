import { z } from "zod";
import {
  compileRenderPlan,
  frameAudioBoundary,
  projectSchema,
  type RenderPlan,
} from "../../../../packages/editor/project";
import { editorScopeSchema } from "../../../../packages/editor/scope";
import {
  playbackPictures,
  type PlaybackPicture,
} from "../../../../packages/editor/playback-video";
import { playbackPcm } from "../../../../packages/editor/playback-audio";
import { playbackPreparedFrameAtAudio } from "../../../../packages/editor/playback-plan";
import {
  playbackObservedAudioFrame,
  PLAYBACK_PCM_BLOCK_FRAMES,
  PLAYBACK_PCM_BUFFER_BYTES,
  PLAYBACK_PCM_POOL_SIZE,
} from "../../../../packages/editor/playback-transport";
import type {
  PlaybackTransportState,
  PlaybackWorkerRequest,
  PlaybackWorkerResponse,
} from "../../../../packages/editor/playback-protocol";

const PICTURE_BYTES_LIMIT = 128 * 1024 ** 2;
const CLOCK_LEASE_MS = 200;
const now = () => performance.timeOrigin + performance.now();
const send = (message: PlaybackWorkerResponse) => self.postMessage(message);
let canvas: OffscreenCanvas | null = null;
let active: Generation | null = null;
let desiredEpoch = "";
let serial = Promise.resolve();
let sourceSnapshots: { identity: string; files: Map<string, File> } | null =
  null;

function scopedSnapshots(
  request: Extract<PlaybackWorkerRequest, { type: "load" }>,
) {
  const scope = editorScopeSchema.parse(request.scope),
    project = projectSchema.parse(request.project);
  z.uuid().parse(request.sourceSnapshotId);
  const identity = JSON.stringify([
    request.sourceSnapshotId,
    scope,
    project.id,
    project.editSequence,
    project.sources,
  ]);
  if (sourceSnapshots) {
    if (sourceSnapshots.identity !== identity || request.files !== undefined)
      throw new Error(
        "The immutable playback source snapshot changed. Reopen preview.",
      );
    return sourceSnapshots.files;
  }
  if (!request.files || request.files.length > 32)
    throw new Error("The scoped playback source snapshots are unavailable.");
  const files = new Map(request.files);
  if (files.size !== request.files.length)
    throw new Error("Duplicate playback source snapshots.");
  for (const id of new Set(project.clips.map((c) => c.sourceId))) {
    const source = project.sources.find((s) => s.id === id)!;
    if (
      !(files.get(id) instanceof File) ||
      files.get(id)!.size !== source.bytes
    )
      throw new Error("A scoped local timeline source is unavailable.");
  }
  sourceSnapshots = { identity, files };
  return files;
}

class Generation {
  readonly abort = new AbortController();
  private readonly plan: RenderPlan;
  private readonly files: Map<string, File>;
  private readonly pictures: PlaybackPicture[] = [];
  private readonly maxPictures: number;
  private readonly pictureBytes: number;
  private readonly waiters = new Set<() => void>();
  private tasks: Promise<void>[] = [];
  private peer: MessagePort | null = null;
  private free: { credit: number; buffer: ArrayBuffer }[] = [];
  private transport: PlaybackTransportState | null = null;
  private clock: Extract<PlaybackWorkerRequest, { type: "clock" }> | null =
    null;
  private running = false;
  private presented = -1;
  private reported = false;
  private reportedFrame = -1;
  private reportedEnded = false;
  private pictureFrontier: number;
  private interval: ReturnType<typeof setInterval>;
  constructor(
    readonly request: Extract<PlaybackWorkerRequest, { type: "load" }>,
    files: Map<string, File>,
  ) {
    z.uuid().parse(request.epoch);
    editorScopeSchema.parse(request.scope);
    this.plan = compileRenderPlan(projectSchema.parse(request.project));
    if (
      !Number.isSafeInteger(request.frame) ||
      request.frame < 0 ||
      request.frame >= this.plan.videoFrames
    )
      throw new Error("The requested timeline picture is invalid.");
    if (this.plan.output.width * this.plan.output.height > 1920 * 1080)
      throw new Error("Timeline playback supports outputs up to 1080p.");
    this.files = files;
    for (const id of new Set(this.plan.clips.map((c) => c.sourceId))) {
      const source = this.plan.sources.find((s) => s.id === id)!;
      if (
        !(this.files.get(id) instanceof File) ||
        this.files.get(id)!.size !== source.bytes
      )
        throw new Error("A scoped local timeline source is unavailable.");
    }
    this.pictureBytes = this.plan.output.width * this.plan.output.height * 4;
    this.maxPictures = Math.min(
      180,
      Math.floor(PICTURE_BYTES_LIMIT / this.pictureBytes) - 3,
    );
    if (this.maxPictures < 3)
      throw new Error(
        "The timeline picture format exceeds the playback budget.",
      );
    this.pictureFrontier = frameAudioBoundary(
      request.frame,
      this.plan.output.fps,
    );
    this.interval = setInterval(() => {
      try {
        this.present();
      } catch (e) {
        this.fail(e);
      }
    }, 10);
  }
  private wake() {
    for (const wake of this.waiters) wake();
    this.waiters.clear();
  }
  private async wait() {
    this.abort.signal.throwIfAborted();
    await new Promise<void>((resolve) => this.waiters.add(resolve));
    this.abort.signal.throwIfAborted();
  }
  private launch(task: Promise<void>) {
    this.tasks.push(
      task.catch((e) => {
        if (!this.abort.signal.aborted) this.fail(e);
      }),
    );
  }
  start() {
    this.launch(this.producePictures());
    send({ type: "loaded", epoch: this.request.epoch });
  }
  receive(message: PlaybackWorkerRequest) {
    if (this.abort.signal.aborted) {
      if (message.type === "audio") message.port.close();
      return;
    }
    if (message.type === "running") {
      this.running = message.running;
      this.wake();
    } else if (message.type === "presented-ack") this.reported = false;
    else if (message.type === "clock") {
      if (
        ![
          message.contextTime,
          message.performanceAbsolute,
          message.latency,
        ].every(Number.isFinite) ||
        message.contextTime <= 0 ||
        message.latency < 0 ||
        Math.abs(now() - message.performanceAbsolute) > 1000
      )
        return;
      const required =
        Math.ceil(
          ((message.latency + 0.15) * this.plan.output.fps.numerator) /
            this.plan.output.fps.denominator,
        ) + 2;
      if (required > this.maxPictures)
        throw new Error(
          "This audio device needs more picture buffering than the local playback budget allows.",
        );
      this.clock = message;
    } else if (message.type === "audio") {
      if (this.peer)
        throw new Error("The current timeline already has an audio producer.");
      this.peer = message.port;
      this.free = Array.from(
        { length: PLAYBACK_PCM_POOL_SIZE },
        (_, credit) => ({
          credit,
          buffer: new ArrayBuffer(PLAYBACK_PCM_BUFFER_BYTES),
        }),
      );
      this.peer.onmessage = (event) => {
        if (this.abort.signal.aborted) return;
        const data = event.data;
        if (data.type === "state") {
          this.peer!.postMessage({ type: "report-ack" });
          if (data.epoch === this.request.epoch) {
            this.transport = data;
          }
        } else if (
          data.type === "credit" &&
          data.epoch === this.request.epoch
        ) {
          if (
            !Number.isSafeInteger(data.credit) ||
            data.credit < 0 ||
            data.credit >= PLAYBACK_PCM_POOL_SIZE ||
            !(data.buffer instanceof ArrayBuffer) ||
            data.buffer.byteLength !== PLAYBACK_PCM_BUFFER_BYTES ||
            this.free.some((c) => c.credit === data.credit)
          )
            return this.fail(
              new Error("The playback buffer ownership changed."),
            );
          this.free.push({ credit: data.credit, buffer: data.buffer });
          this.wake();
        }
      };
      this.peer.start();
      this.frontier();
      this.launch(this.produceAudio());
    }
  }
  private frontier() {
    this.peer?.postMessage({
      type: "video-ready",
      epoch: this.request.epoch,
      frontier: this.pictureFrontier,
    });
  }
  private async producePictures() {
    const iterator = playbackPictures(
      this.plan,
      this.files,
      this.request.frame,
      this.abort.signal,
    );
    try {
      for await (const picture of iterator) {
        // Every yielded bitmap belongs to this generation, including while
        // waiting for presentation to release capacity.
        let retained = false;
        try {
          while (
            this.pictures.length >= this.maxPictures ||
            (!this.running && this.presented >= 0)
          )
            await this.wait();
          this.abort.signal.throwIfAborted();
          this.pictures.push(picture);
          retained = true;
          this.pictureFrontier = frameAudioBoundary(
            picture.frame + 1,
            this.plan.output.fps,
          );
          this.frontier();
          if (this.presented < 0) this.draw(picture, false);
        } finally {
          if (!retained) picture.bitmap.close();
        }
      }
    } finally {
      await iterator.return(undefined);
    }
  }
  private async produceAudio() {
    let slot: { credit: number; buffer: ArrayBuffer } | undefined,
      used = 0;
    let record = frameAudioBoundary(this.request.frame, this.plan.output.fps),
      start = record;
    const flush = () => {
      if (!slot || !used) return;
      this.abort.signal.throwIfAborted();
      this.peer!.postMessage(
        {
          type: "block",
          block: {
            epoch: this.request.epoch,
            credit: slot.credit,
            start,
            frames: used,
            buffer: slot.buffer,
          },
        },
        [slot.buffer],
      );
      slot = undefined;
      used = 0;
      start = record;
    };
    const append = async (data: Float32Array) => {
      let offset = 0;
      while (offset < data.length / 2) {
        this.abort.signal.throwIfAborted();
        if (!slot) {
          while (!this.free.length) await this.wait();
          slot = this.free.shift()!;
        }
        const count = Math.min(
          PLAYBACK_PCM_BLOCK_FRAMES - used,
          data.length / 2 - offset,
        );
        new Float32Array(slot.buffer).set(
          data.subarray(offset * 2, (offset + count) * 2),
          used * 2,
        );
        offset += count;
        used += count;
        record += count;
        if (used === PLAYBACK_PCM_BLOCK_FRAMES) flush();
      }
    };
    for (const clip of this.plan.clips) {
      if (clip.recordOutAudioFrame <= record) continue;
      if (record < clip.recordInAudioFrame)
        throw new Error("The playback audio timeline has a gap.");
      const source = this.plan.sources.find((s) => s.id === clip.sourceId)!;
      const from = clip.sourceInAudioFrame + record - clip.recordInAudioFrame;
      const to =
        clip.sourceInAudioFrame +
        clip.recordOutAudioFrame -
        clip.recordInAudioFrame;
      if (clip.muted || !source.hasAudio) {
        while (record < clip.recordOutAudioFrame)
          await append(
            new Float32Array(
              Math.min(
                PLAYBACK_PCM_BLOCK_FRAMES,
                clip.recordOutAudioFrame - record,
              ) * 2,
            ),
          );
      } else {
        for await (const block of playbackPcm(
          source,
          this.files.get(source.id)!,
          from,
          to,
          this.abort.signal,
        )) {
          if (
            block.sourceFrame !==
            clip.sourceInAudioFrame + record - clip.recordInAudioFrame
          )
            throw new Error("The source audio window is discontinuous.");
          await append(block.data);
        }
      }
      if (record !== clip.recordOutAudioFrame)
        throw new Error("A timeline cut has the wrong audio endpoint.");
      // A short first cut must be playable before decoding the following cut.
      flush();
    }
    flush();
    if (record !== this.plan.audioFrames)
      throw new Error("The audio timeline is incomplete.");
  }
  private draw(picture: PlaybackPicture, ended: boolean) {
    this.abort.signal.throwIfAborted();
    const context = canvas?.getContext("2d");
    if (!context) throw new Error("The timeline canvas is unavailable.");
    if (picture.frame !== this.presented)
      context.drawImage(picture.bitmap, 0, 0);
    this.presented = picture.frame;
    if (!this.reported) {
      send({
        type: "presented",
        epoch: this.request.epoch,
        frame: picture.frame,
        clipId: picture.clipId,
        sourceUs: picture.sourceUs,
        ended,
        pictures: this.pictures.length,
        pictureBytes: (this.pictures.length + 3) * this.pictureBytes,
      });
      this.reported = true;
      this.reportedFrame = picture.frame;
      this.reportedEnded = ended;
    }
  }
  private present() {
    if (!this.transport || !this.clock || this.abort.signal.aborted) return;
    const age = now() - this.clock.performanceAbsolute;
    if (age < -10 || age > CLOCK_LEASE_MS) return;
    const contextFrame = Math.floor(
      (this.clock.contextTime + Math.max(0, age) / 1000) * 48000,
    );
    const record = playbackObservedAudioFrame(
      this.transport.spans,
      contextFrame,
    );
    if (record === null) return;
    const frame = playbackPreparedFrameAtAudio(
      this.plan,
      record,
      this.pictureFrontier,
    );
    const picture = this.pictures.find((p) => p.frame === frame);
    // A new epoch can receive its frozen transport state before its first
    // decoded picture. Its readiness frontier still forbids consumption.
    if (
      !picture &&
      this.presented < 0 &&
      record === frameAudioBoundary(this.request.frame, this.plan.output.fps)
    )
      return;
    if (!picture)
      throw new Error(
        "The audible timeline picture is outside the prepared interval.",
      );
    const ended = record === this.plan.audioFrames;
    if (
      frame !== this.presented ||
      (!this.reported &&
        (frame !== this.reportedFrame || ended !== this.reportedEnded))
    )
      this.draw(picture, ended);
    let released = false;
    while (this.pictures.length > 1 && this.pictures[1].frame <= frame) {
      this.pictures.shift()!.bitmap.close();
      released = true;
    }
    if (released) this.wake();
  }
  private fail(error: unknown) {
    send({
      type: "error",
      epoch: this.request.epoch,
      message:
        error instanceof Error ? error.message : "Timeline playback failed.",
    });
    this.stop();
  }
  stop() {
    if (!this.abort.signal.aborted) {
      this.abort.abort();
      clearInterval(this.interval);
      this.wake();
      this.peer?.close();
      this.peer = null;
      for (const picture of this.pictures) picture.bitmap.close();
      this.pictures.length = 0;
      this.free.length = 0;
    }
  }
  async stopped() {
    this.stop();
    await Promise.allSettled(this.tasks);
  }
}

self.onmessage = (event: MessageEvent<PlaybackWorkerRequest>) => {
  const message = event.data;
  if (message.type === "canvas") {
    if (!canvas) canvas = message.canvas;
    return;
  }
  if (message.type === "load") {
    desiredEpoch = message.epoch;
    const previous = active;
    active = null;
    previous?.stop();
    canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    // Capture the first immutable snapshots even when its picture request is
    // coalesced away. Later seeks reuse those exact File identities, so AAC
    // admission cannot unexpectedly rescan a 90-minute packet table.
    let files: Map<string, File>;
    try {
      files = scopedSnapshots(message);
    } catch (error) {
      send({
        type: "error",
        epoch: message.epoch,
        message:
          error instanceof Error ? error.message : "Source snapshots failed.",
      });
      return;
    }
    serial = serial.then(async () => {
      await previous?.stopped();
      if (desiredEpoch !== message.epoch) return;
      try {
        if (!canvas) throw new Error("The timeline canvas was not attached.");
        canvas.width = message.project.output.width;
        canvas.height = message.project.output.height;
        active = new Generation(message, files);
        active.start();
      } catch (error) {
        send({
          type: "error",
          epoch: message.epoch,
          message:
            error instanceof Error
              ? error.message
              : "The timeline could not open.",
        });
      }
    });
  } else if (message.type === "retire") {
    if (desiredEpoch === message.epoch) desiredEpoch = "";
    const previous = active?.request.epoch === message.epoch ? active : null;
    if (previous) {
      previous.stop();
      active = null;
    }
    serial = serial.then(async () => {
      await previous?.stopped();
      send({ type: "retired", epoch: message.epoch });
    });
  } else if (message.epoch === active?.request.epoch) {
    try {
      active.receive(message);
    } catch (error) {
      active.stop();
      send({
        type: "error",
        epoch: message.epoch,
        message: error instanceof Error ? error.message : "Playback failed.",
      });
    }
  } else if (message.type === "audio") message.port.close();
};
