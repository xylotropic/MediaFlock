import type { EditorProject } from "./project";
import type { EditorScope } from "./scope";
import type { PlaybackSpan } from "./playback-transport";

export interface PlaybackTransportState {
  type: "state";
  epoch: string;
  cursor: number;
  queuedEnd: number;
  frontier: number;
  playing: boolean;
  buffering: boolean;
  ended: boolean;
  credits: number;
  spans: PlaybackSpan[];
  contextFrame: number;
}
export type PlaybackWorkerRequest =
  | { type: "canvas"; canvas: OffscreenCanvas }
  | {
      type: "load";
      epoch: string;
      scope: EditorScope;
      project: EditorProject;
      sourceSnapshotId: string;
      files?: [string, File][];
      frame: number;
    }
  | { type: "retire"; epoch: string }
  | { type: "audio"; epoch: string; port: MessagePort }
  | { type: "running"; epoch: string; running: boolean }
  | {
      type: "clock";
      epoch: string;
      contextTime: number;
      performanceAbsolute: number;
      latency: number;
    }
  | { type: "presented-ack"; epoch: string };
export type PlaybackWorkerResponse =
  | { type: "loaded"; epoch: string }
  | { type: "retired"; epoch: string }
  | {
      type: "presented";
      epoch: string;
      frame: number;
      clipId: string;
      sourceUs: number;
      ended: boolean;
      pictures: number;
      pictureBytes: number;
    }
  | { type: "error"; epoch: string; message: string };
