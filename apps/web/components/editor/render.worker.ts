import { z } from "zod";
import { renderLocalProject } from "../../../../packages/editor/render";
import { projectSchema } from "../../../../packages/editor/project";
import { editorScopeSchema } from "../../../../packages/editor/scope";
import type {
  ExportWorkerRequest,
  ExportWorkerResponse,
} from "../../../../packages/editor/worker-protocol";
let active: { id: string; cancellation: AbortController } | null = null;
const send = (message: ExportWorkerResponse) => self.postMessage(message);
self.onmessage = async (event: MessageEvent<ExportWorkerRequest>) => {
  const message = event.data;
  if (message.type === "cancel") {
    if (active?.id === message.jobId) active.cancellation.abort();
    return;
  }
  if (message.type !== "start" || active) return;
  const cancellation = new AbortController();
  active = { id: message.jobId, cancellation };
  try {
    z.uuid().parse(message.jobId);
    editorScopeSchema.parse(message.scope);
    const project = projectSchema.parse(message.project);
    const result = await renderLocalProject(
      project,
      new Map(message.files),
      message.directory,
      cancellation.signal,
      (value) => send({ type: "progress", jobId: message.jobId, value }),
    );
    cancellation.signal.throwIfAborted();
    send({ type: "complete", jobId: message.jobId, result });
  } catch (e) {
    send({
      type: "error",
      jobId: message.jobId,
      name: e instanceof Error ? e.name : "Error",
      message:
        e instanceof Error ? e.message : "The export could not be completed.",
    });
  } finally {
    active = null;
  }
};
