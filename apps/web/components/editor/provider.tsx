"use client";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { EditorController } from "../../../../packages/editor/controller";
import { BrowserEditorProjectStore } from "../../../../packages/editor/store";
import { BrowserEditorFiles } from "../../../../packages/editor/files";
import {
  EditorScopeLease,
  type EditorScope,
} from "../../../../packages/editor/scope";
import { EditorImporter } from "../../../../packages/editor/importer";
import { EditorExporter } from "../../../../packages/editor/exporter";

export interface EditorRuntime {
  controller: EditorController;
  files: BrowserEditorFiles;
  importer: EditorImporter;
  exporter: EditorExporter;
}
const Context = createContext<{ runtime: EditorRuntime | null; error: string }>(
  { runtime: null, error: "" },
);
export function useEditorRuntime() {
  return useContext(Context);
}
export function EditorProvider({
  scope,
  children,
}: {
  scope: EditorScope;
  children: ReactNode;
}) {
  const [state, setState] = useState<{
    runtime: EditorRuntime | null;
    error: string;
  }>({ runtime: null, error: "" });
  const { backend, environment, userId, workspaceId } = scope;
  useEffect(() => {
    const lease = new EditorScopeLease({
      backend,
      environment,
      userId,
      workspaceId,
    });
    const controller = new EditorController(
      lease,
      new BrowserEditorProjectStore(lease),
    );
    const files = new BrowserEditorFiles(lease);
    const runtime = {
      controller,
      files,
      importer: new EditorImporter(controller, files),
      exporter: new EditorExporter(
        controller,
        files,
        () =>
          new Worker(new URL("./render.worker.ts", import.meta.url), {
            type: "module",
          }),
      ),
    };
    void controller
      .start()
      .then(() => runtime.exporter.start())
      .then(
        () => {
          if (!lease.signal.aborted) setState({ runtime, error: "" });
        },
        (e) => {
          if (!lease.signal.aborted)
            setState({
              runtime: null,
              error:
                e instanceof Error
                  ? e.message
                  : "Local editing could not be opened.",
            });
        },
      );
    return () => controller.close();
  }, [backend, environment, userId, workspaceId]);
  return <Context.Provider value={state}>{children}</Context.Provider>;
}
