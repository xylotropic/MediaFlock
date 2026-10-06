import {
  PlaybackPcmTransport,
  type PlaybackTransfer,
} from "./playback-transport";

declare const sampleRate: number;
declare const currentFrame: number;
declare const AudioWorkletProcessor: { new (): { port: MessagePort } };
declare function registerProcessor(
  name: string,
  processor: typeof TimelinePcmProcessor,
): void;

class TimelinePcmProcessor extends AudioWorkletProcessor {
  private peer: MessagePort | null = null;
  private failed = false;
  private reportOutstanding = false;
  private peerReportOutstanding = false;
  private lastReportFrame = -1;
  private transport = new PlaybackPcmTransport((block) => {
    const message = {
      type: "credit",
      epoch: block.epoch,
      credit: block.credit,
      buffer: block.buffer,
    };
    (this.peer ?? this.port).postMessage(message, [block.buffer]);
  });
  constructor() {
    super();
    if (sampleRate !== 48000)
      throw new Error("The timeline requires a 48 kHz audio context.");
    this.port.onmessage = (event) => this.receive(event.data, false);
    this.port.postMessage({ type: "ready", version: 1 });
  }
  private receive(message: Record<string, unknown>, fromPeer: boolean) {
    try {
      if (!message || typeof message !== "object")
        throw new Error("Invalid playback command.");
      if (message.type === "bind-producer" && !fromPeer) {
        if (this.transport.snapshot().epoch)
          throw new Error(
            "Retire the old playback generation before changing its producer.",
          );
        const port = message.port as MessagePort;
        if (!port || typeof port.postMessage !== "function")
          throw new Error("Invalid playback producer port.");
        this.peer?.close();
        this.peerReportOutstanding = false;
        this.peer = port;
        port.onmessage = (event) => this.receive(event.data, true);
        port.start();
      } else if (message.type === "reset" && !fromPeer) {
        this.transport.reset(
          message.epoch as string,
          message.start as number,
          message.end as number,
        );
        this.port.postMessage({ type: "reset-ack", epoch: message.epoch });
      } else if (message.type === "retire" && !fromPeer) {
        const epoch = this.transport.snapshot().epoch;
        if (message.epoch === epoch) this.transport.retire();
        this.port.postMessage({ type: "retire-ack", epoch: message.epoch });
      } else if (message.type === "block" && fromPeer) {
        this.transport.enqueue(message.block as PlaybackTransfer);
      } else if (message.type === "video-ready" && fromPeer) {
        this.transport.ready(
          message.epoch as string,
          message.frontier as number,
        );
      } else if (message.type === "play" && !fromPeer) {
        this.transport.play(message.epoch as string);
        this.port.postMessage({ type: "play-ack", epoch: message.epoch });
      } else if (message.type === "pause" && !fromPeer) {
        this.transport.pause(message.epoch as string);
        this.port.postMessage({
          type: "pause-ack",
          epoch: message.epoch,
          cursor: this.transport.snapshot().cursor,
        });
      } else if (message.type === "deadline" && !fromPeer) {
        this.transport.deadline(
          message.epoch as string,
          message.contextFrame as number,
        );
      } else if (message.type === "report-ack") {
        if (fromPeer) this.peerReportOutstanding = false;
        else this.reportOutstanding = false;
      } else throw new Error("Unknown playback command.");
    } catch (error) {
      this.fail(error);
    }
  }
  private fail(error: unknown) {
    if (this.failed) return;
    this.failed = true;
    this.transport.retire();
    this.port.postMessage({
      type: "error",
      message:
        error instanceof Error ? error.message : "The audio transport failed.",
    });
  }
  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    if (this.failed) return false;
    const left = outputs[0]?.[0],
      right = outputs[0]?.[1];
    if (!left || !right) return true;
    try {
      this.transport.process(left, right, currentFrame);
      if (
        currentFrame - this.lastReportFrame >= 800 ||
        this.lastReportFrame < 0
      ) {
        // One outstanding report per recipient bounds mailbox growth even
        // while the UI thread is blocked. Credits remain bounded by the pool.
        if (
          !this.reportOutstanding ||
          (this.peer && !this.peerReportOutstanding)
        ) {
          const state = {
            type: "state",
            ...this.transport.snapshot(),
            contextFrame: currentFrame + left.length,
          };
          if (!this.reportOutstanding) {
            this.port.postMessage(state);
            this.reportOutstanding = true;
          }
          if (this.peer && !this.peerReportOutstanding) {
            this.peer.postMessage(state);
            this.peerReportOutstanding = true;
          }
          this.lastReportFrame = currentFrame;
        }
      }
    } catch (error) {
      this.fail(error);
      return false;
    }
    return true;
  }
}
registerProcessor("mediaflock-editor-pcm-v1", TimelinePcmProcessor);
