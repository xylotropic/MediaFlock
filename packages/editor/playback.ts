import {
  compileRenderPlan,
  frameTimeUs,
  projectSchema,
  type EditorProject,
} from "./project";
import type { BrowserEditorFiles } from "./files";
import type { EditorScopeLease } from "./scope";
import type {
  PlaybackTransportState,
  PlaybackWorkerRequest,
  PlaybackWorkerResponse,
} from "./playback-protocol";
import { frameAudioBoundary } from "./project";

export interface PlaybackSnapshot {
  phase: "loading" | "paused" | "playing" | "buffering" | "ended" | "error";
  frame: number;
  positionUs: number;
  clipId: string;
  sourceUs: number;
  error: string;
  pictures: number;
  pictureBytes: number;
  consumed: number;
  queuedEnd: number;
  frontier: number;
  clockReady: boolean;
}

/** Owns one sealed plan and login lease. No source or decoder cache crosses
 * this lifetime. The worklet's consumed cursor is the only audio clock. */
export class EditorPlayback {
  readonly plan;
  private snapshot: PlaybackSnapshot = Object.freeze({
    phase: "loading",
    frame: 0,
    positionUs: 0,
    clipId: "",
    sourceUs: 0,
    error: "",
    pictures: 0,
    pictureBytes: 0,
    consumed: 0,
    queuedEnd: 0,
    frontier: 0,
    clockReady: false,
  });
  private readonly listeners = new Set<() => void>();
  private worker: Worker | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private context: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private initializingAudio: Promise<void> | null = null;
  private epoch = "";
  private audioEpoch = "";
  private files: Promise<[string, File][]> | null = null;
  private readonly sourceSnapshotId = crypto.randomUUID();
  private sourceSnapshotsSent = false;
  private loading: Promise<void> = Promise.resolve();
  private audioSetup: { epoch: string; promise: Promise<void> } | null = null;
  private loadAck: {
    epoch: string;
    resolve: () => void;
    reject: (error: Error) => void;
  } | null = null;
  private closed = false;
  private wanted = false;
  private intent = 0;
  private gateRequested = false;
  private haveClock = false;
  private transport: PlaybackTransportState | null = null;
  private animation = 0;
  private commandAcks = new Map<
    string,
    {
      resolve: () => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private retirement = new Map<string, ReturnType<typeof setTimeout>>();
  private loadTimer: ReturnType<typeof setTimeout> | null = null;
  constructor(
    private readonly project: EditorProject,
    private readonly lease: EditorScopeLease,
    private readonly localFiles: Pick<BrowserEditorFiles, "readSource">,
    private readonly workerFactory: () => Worker,
  ) {
    this.project = projectSchema.parse(project);
    this.plan = compileRenderPlan(this.project);
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private publish(partial: Partial<PlaybackSnapshot>) {
    if (this.closed) return;
    this.snapshot = Object.freeze({ ...this.snapshot, ...partial });
    for (const listener of this.listeners) listener();
  }
  private assert() {
    this.lease.assertActive();
    if (this.closed)
      throw new DOMException("Playback was closed.", "AbortError");
    if (this.snapshot.phase === "error")
      throw new Error("Reopen preview to start a new playback session.");
  }
  private send(message: PlaybackWorkerRequest, transfer: Transferable[] = []) {
    this.assert();
    this.worker!.postMessage(message, transfer);
  }
  attach(canvas: HTMLCanvasElement, firstFrame = 0) {
    this.assert();
    if (this.worker) throw new Error("The timeline is already attached.");
    this.canvas = canvas;
    this.worker = this.workerFactory();
    this.worker.onmessage = (event: MessageEvent<PlaybackWorkerResponse>) =>
      this.receive(event.data);
    this.worker.onerror = () =>
      this.fail(
        new Error("The timeline worker stopped. Reopen preview to try again."),
      );
    const offscreen = canvas.transferControlToOffscreen();
    this.send({ type: "canvas", canvas: offscreen }, [offscreen]);
    this.lease.signal.addEventListener("abort", this.close, { once: true });
    document.addEventListener("visibilitychange", this.visibility);
    this.loading = this.seek(firstFrame);
    void this.loading.catch((e) => this.fail(e));
    this.pump();
  }
  private visibility = () => {
    if (document.hidden) this.pause();
  };
  private receive(message: PlaybackWorkerResponse) {
    if (message.type === "retired") {
      const timer = this.retirement.get(message.epoch);
      if (timer) clearTimeout(timer);
      this.retirement.delete(message.epoch);
      return;
    }
    if (
      this.closed ||
      this.lease.signal.aborted ||
      message.epoch !== this.epoch
    )
      return;
    if (message.type === "error") this.fail(new Error(message.message));
    else if (message.type === "loaded") {
      if (this.loadAck?.epoch === message.epoch) {
        this.loadAck.resolve();
        this.loadAck = null;
      }
    } else if (message.type === "presented") {
      this.send({ type: "presented-ack", epoch: this.epoch });
      if (this.loadTimer) {
        clearTimeout(this.loadTimer);
        this.loadTimer = null;
      }
      if (this.canvas) this.canvas.style.visibility = "visible";
      if (message.ended) this.wanted = false;
      this.publish({
        frame: message.frame,
        clipId: message.clipId,
        sourceUs: message.sourceUs,
        positionUs: message.ended
          ? this.plan.durationUs
          : frameTimeUs(message.frame, this.plan.output.fps),
        phase: message.ended
          ? "ended"
          : this.wanted
            ? this.snapshot.phase
            : "paused",
        pictures: message.pictures,
        pictureBytes: message.pictureBytes,
      });
    }
  }
  private async command(
    type: "reset" | "retire" | "pause",
    epoch: string,
    extra: Record<string, unknown> = {},
  ) {
    const node = this.node;
    if (!node) return;
    const key = `${type}:${epoch}`;
    this.assert();
    if (this.commandAcks.has(key))
      throw new Error("A playback command is already pending.");
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.commandAcks.delete(key);
        reject(
          new Error("The audio transport did not acknowledge retirement."),
        );
      }, 2000);
      this.commandAcks.set(key, { resolve, reject, timer });
      node.port.postMessage({ type, epoch, ...extra });
    });
  }
  seek(frame: number): Promise<void> {
    this.assert();
    if (
      !Number.isSafeInteger(frame) ||
      frame < 0 ||
      frame >= this.plan.videoFrames
    )
      return Promise.reject(new Error("Choose a picture within the timeline."));
    this.wanted = false;
    this.intent++;
    this.haveClock = false;
    this.gateRequested = false;
    const old = this.epoch,
      epoch = crypto.randomUUID();
    this.epoch = epoch;
    this.transport = null;
    this.loadAck?.resolve();
    this.loadAck = null;
    if (this.canvas) this.canvas.style.visibility = "hidden";
    if (this.loadTimer) clearTimeout(this.loadTimer);
    this.publish({
      phase: "loading",
      frame,
      positionUs: frameTimeUs(frame, this.plan.output.fps),
      clipId: "",
      sourceUs: 0,
      error: "",
      consumed: frameAudioBoundary(frame, this.plan.output.fps),
      queuedEnd: frameAudioBoundary(frame, this.plan.output.fps),
      frontier: frameAudioBoundary(frame, this.plan.output.fps),
      clockReady: false,
      pictures: 0,
      pictureBytes: 0,
    });
    // Close consumption before waiting for any reader or decode teardown.
    const retired =
      old && this.node ? this.command("retire", old) : Promise.resolve();
    this.audioEpoch = "";
    if (old) {
      this.send({ type: "retire", epoch: old });
      this.retirement.set(
        old,
        setTimeout(
          () =>
            this.fail(
              new Error(
                "The old timeline decoder did not stop. Reopen preview to continue.",
              ),
            ),
          2000,
        ),
      );
    }
    if (!this.files) {
      const used = new Set(this.plan.clips.map((c) => c.sourceId));
      this.files = (async () => {
        const files: [string, File][] = [];
        for (const source of this.plan.sources.filter((s) => used.has(s.id))) {
          this.assert();
          const file = await this.localFiles.readSource(source);
          this.assert();
          files.push([source.id, file]);
        }
        return files;
      })();
    }
    const loading = (async () => {
      const files = await this.files!;
      await retired;
      this.assert();
      if (epoch !== this.epoch) return;
      const ready = new Promise<void>((resolve, reject) => {
        this.loadAck = { epoch, resolve, reject };
      });
      this.send({
        type: "load",
        epoch,
        scope: this.lease.scope,
        project: this.project,
        sourceSnapshotId: this.sourceSnapshotId,
        ...(this.sourceSnapshotsSent ? {} : { files }),
        frame,
      });
      this.sourceSnapshotsSent = true;
      this.loadTimer = setTimeout(
        () =>
          this.fail(
            new Error(
              "The local video did not become ready within 15 seconds. Reopen preview to try again.",
            ),
          ),
        15000,
      );
      await ready;
    })();
    this.loading = loading;
    return loading;
  }
  seekClip(id: string) {
    const clip = this.plan.clips.find((c) => c.id === id);
    if (clip) void this.seek(clip.recordInFrame).catch((e) => this.fail(e));
  }
  step(delta: -1 | 1) {
    void this.seek(
      Math.max(
        0,
        Math.min(this.plan.videoFrames - 1, this.snapshot.frame + delta),
      ),
    ).catch((e) => this.fail(e));
  }
  pause() {
    if (this.closed) return;
    this.wanted = false;
    this.intent++;
    this.gateRequested = false;
    this.node?.port.postMessage({ type: "pause", epoch: this.epoch });
    if (this.worker && this.epoch)
      this.send({ type: "running", epoch: this.epoch, running: false });
    if (
      this.snapshot.phase !== "error" &&
      this.snapshot.phase !== "loading" &&
      this.snapshot.phase !== "ended"
    )
      this.publish({ phase: "paused" });
  }
  async play() {
    try {
      this.assert();
      if (document.hidden) return;
      if (this.snapshot.phase === "ended") await this.seek(0);
      const intent = ++this.intent,
        epoch = this.epoch;
      this.wanted = true;
      this.publish({ phase: "buffering" });
      if (!this.context) {
        this.context = new AudioContext({ sampleRate: 48000 });
        if (this.context.sampleRate !== 48000)
          throw new Error(
            "This browser did not provide the required 48 kHz playback context.",
          );
        this.context.onstatechange = () => {
          if (!this.closed && this.context?.state !== "running" && this.wanted)
            this.pause();
        };
      }
      // resume is invoked in the user gesture. Its completion does not grant
      // a stale intent permission to reopen the media gate.
      const resumed = this.context.resume();
      if (!this.initializingAudio)
        this.initializingAudio = (async () => {
          await this.context!.audioWorklet.addModule("/worklets/editor-pcm.js");
          this.assert();
          this.node = new AudioWorkletNode(
            this.context!,
            "mediaflock-editor-pcm-v1",
            { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] },
          );
          this.node.onprocessorerror = () =>
            this.fail(new Error("The timeline audio processor stopped."));
          this.node.port.onmessage = (event) => this.receiveAudio(event.data);
          this.node.connect(this.context!.destination);
        })();
      await this.initializingAudio;
      await resumed;
      await this.loading;
      this.assert();
      if (intent !== this.intent || !this.wanted || epoch !== this.epoch)
        return;
      if (this.audioEpoch !== epoch && this.audioSetup?.epoch !== epoch) {
        const previous = this.audioSetup?.promise;
        const setup = (async () => {
          await previous;
          this.assert();
          if (epoch !== this.epoch) return;
          const channel = new MessageChannel();
          this.node!.port.postMessage(
            { type: "bind-producer", port: channel.port1 },
            [channel.port1],
          );
          await this.command("reset", epoch, {
            start: frameAudioBoundary(
              this.snapshot.frame,
              this.plan.output.fps,
            ),
            end: this.plan.audioFrames,
          });
          this.node!.port.postMessage({
            type: "deadline",
            epoch,
            contextFrame: 0,
          });
          if (
            epoch !== this.epoch ||
            this.closed ||
            this.lease.signal.aborted
          ) {
            channel.port2.close();
            return;
          }
          this.audioEpoch = epoch;
          this.send({ type: "audio", epoch, port: channel.port2 }, [
            channel.port2,
          ]);
        })();
        this.audioSetup = { epoch, promise: setup };
      }
      await this.audioSetup?.promise;
      if (intent === this.intent && this.wanted && epoch === this.epoch)
        this.send({ type: "running", epoch, running: true });
    } catch (error) {
      if (!this.closed && !this.lease.signal.aborted) this.fail(error);
    }
  }
  private receiveAudio(message: Record<string, unknown>) {
    if (message.type === "state")
      this.node?.port.postMessage({ type: "report-ack" });
    if (typeof message.type === "string" && message.type.endsWith("-ack")) {
      const key = `${message.type.slice(0, -4)}:${message.epoch}`;
      const pending = this.commandAcks.get(key);
      if (pending) {
        clearTimeout(pending.timer);
        this.commandAcks.delete(key);
        pending.resolve();
      }
    }
    if (this.closed || this.lease.signal.aborted) return;
    if (message.type === "error")
      return this.fail(new Error(String(message.message)));
    if (message.type !== "state" || message.epoch !== this.epoch) return;
    const state = message as unknown as PlaybackTransportState;
    this.transport = state;
    if (state.buffering) this.gateRequested = false;
    if (this.wanted)
      this.publish({
        phase: state.playing ? "playing" : "buffering",
        consumed: state.cursor,
        queuedEnd: state.queuedEnd,
        frontier: state.frontier,
        clockReady: this.haveClock,
      });
    else if (this.snapshot.consumed !== state.cursor)
      this.publish({
        consumed: state.cursor,
        queuedEnd: state.queuedEnd,
        frontier: state.frontier,
        clockReady: this.haveClock,
      });
    this.release();
  }
  private release() {
    const state = this.transport;
    if (
      !state ||
      !this.wanted ||
      !this.haveClock ||
      this.gateRequested ||
      this.audioEpoch !== this.epoch ||
      this.context?.state !== "running"
    )
      return;
    const needed = Math.min(4800, this.plan.audioFrames - state.cursor);
    if (
      needed > 0 &&
      state.frontier - state.cursor >= needed &&
      state.queuedEnd - state.cursor >= needed
    ) {
      this.gateRequested = true;
      this.node!.port.postMessage({ type: "play", epoch: this.epoch });
    }
  }
  private pump = () => {
    if (this.closed || this.lease.signal.aborted) return;
    const context = this.context;
    this.haveClock = false;
    if (context?.state === "running" && this.node && this.epoch) {
      const timestamp = context.getOutputTimestamp();
      if (timestamp.contextTime && timestamp.performanceTime) {
        const age = performance.now() - timestamp.performanceTime;
        if (age >= -10 && age < 200) {
          this.haveClock = true;
          this.node.port.postMessage({
            type: "deadline",
            epoch: this.epoch,
            contextFrame: Math.floor(context.currentTime * 48000) + 9600,
          });
          this.send({
            type: "clock",
            epoch: this.epoch,
            contextTime: timestamp.contextTime,
            performanceAbsolute:
              performance.timeOrigin + timestamp.performanceTime,
            latency: Math.max(
              context.baseLatency + context.outputLatency,
              context.currentTime - timestamp.contextTime,
            ),
          });
          this.release();
        } else this.haveClock = false;
      }
    }
    this.animation = requestAnimationFrame(this.pump);
  };
  private fail(error: unknown) {
    if (
      this.closed ||
      this.lease.signal.aborted ||
      this.snapshot.phase === "error"
    )
      return;
    this.wanted = false;
    this.intent++;
    this.node?.port.postMessage({ type: "retire", epoch: this.epoch });
    this.worker?.terminate();
    this.worker = null;
    if (this.canvas) this.canvas.style.visibility = "hidden";
    this.publish({
      phase: "error",
      error:
        error instanceof Error ? error.message : "Timeline playback failed.",
    });
    this.closeResources();
  }
  private closeResources() {
    this.loadAck?.reject(new Error("Playback was closed."));
    this.loadAck = null;
    cancelAnimationFrame(this.animation);
    if (this.loadTimer) clearTimeout(this.loadTimer);
    for (const timer of this.retirement.values()) clearTimeout(timer);
    this.retirement.clear();
    for (const pending of this.commandAcks.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Playback was closed."));
    }
    this.commandAcks.clear();
    this.node?.disconnect();
    this.node?.port.close();
    this.node = null;
    if (this.context) {
      this.context.onstatechange = null;
      void this.context.close().catch(() => undefined);
    }
    this.context = null;
    this.worker?.terminate();
    this.worker = null;
    document.removeEventListener("visibilitychange", this.visibility);
    this.lease.signal.removeEventListener("abort", this.close);
  }
  close = () => {
    if (this.closed) return;
    this.closed = true;
    this.wanted = false;
    this.intent++;
    if (this.canvas) this.canvas.style.visibility = "hidden";
    this.closeResources();
    this.listeners.clear();
  };
}
