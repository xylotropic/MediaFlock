import type { EditorScope } from "./scope";
import type { EditorProject } from "./project";
import type { RenderProgress, RenderResult } from "./render";
export type ExportWorkerRequest =
  | {
      type: "start";
      jobId: string;
      scope: EditorScope;
      project: EditorProject;
      files: Array<[string, File]>;
      directory: FileSystemDirectoryHandle;
    }
  | { type: "cancel"; jobId: string };
export type ExportWorkerResponse =
  | { type: "progress"; jobId: string; value: RenderProgress }
  | { type: "complete"; jobId: string; result: RenderResult }
  | { type: "error"; jobId: string; name: string; message: string };
