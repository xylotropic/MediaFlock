import type { EditorController } from "./controller";
import { BrowserEditorFiles, type ImportProgress } from "./files";
import { sourceSchema } from "./project";
export interface ImportSnapshot {
  active: boolean;
  name: string;
  phase:
    | "inspecting"
    | "waiting"
    | "copying"
    | "verifying"
    | "saved"
    | "cancelled"
    | "error";
  completed: number;
  total: number;
  error: string | null;
}
export class EditorImporter {
  private snapshot: ImportSnapshot = Object.freeze({
    active: false,
    name: "",
    phase: "saved",
    completed: 0,
    total: 0,
    error: null,
  });
  private readonly subscribers = new Set<() => void>();
  private cancellation: AbortController | null = null;
  constructor(
    private readonly controller: EditorController,
    private readonly files: BrowserEditorFiles,
  ) {}
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  };
  private publish(value: Partial<ImportSnapshot>) {
    this.snapshot = Object.freeze({ ...this.snapshot, ...value });
    this.subscribers.forEach((listener) => listener());
  }
  cancel() {
    this.cancellation?.abort();
  }
  async restore(file: File, sourceId: string): Promise<void> {
    this.controller.lease.assertActive();
    if (this.snapshot.active)
      throw new Error("Wait for the current video import to finish.");
    const source = this.controller
      .getSnapshot()
      .journal?.project.sources.find((s) => s.id === sourceId);
    if (!source) throw new Error("Open the source's editing project first.");
    this.cancellation = new AbortController();
    const signal = AbortSignal.any([
      this.cancellation.signal,
      this.controller.lease.signal,
    ]);
    this.publish({
      active: true,
      name: source.name,
      phase: "verifying",
      completed: 0,
      total: file.size,
      error: null,
    });
    try {
      await this.files.restoreOriginal(file, source, signal, (p) =>
        this.publish(p),
      );
      this.controller.lease.assertActive();
      this.publish({
        active: false,
        phase: "saved",
        completed: file.size,
        total: file.size,
      });
    } catch (e) {
      if (!this.controller.lease.signal.aborted)
        this.publish({
          active: false,
          phase: signal.aborted ? "cancelled" : "error",
          error: signal.aborted
            ? null
            : e instanceof Error
              ? e.message
              : "The original could not be restored.",
        });
      throw e;
    } finally {
      this.cancellation = null;
    }
  }
  async import(file: File): Promise<void> {
    this.controller.lease.assertActive();
    if (this.snapshot.active)
      throw new Error("Wait for the current video import to finish.");
    const project = this.controller.getSnapshot().journal?.project;
    if (!project) throw new Error("Create or open an editing project first.");
    if (project.sources.length >= 32)
      throw new Error("This project has reached its 32-source limit.");
    this.cancellation = new AbortController();
    const signal = AbortSignal.any([
      this.cancellation.signal,
      this.controller.lease.signal,
    ]);
    this.publish({
      active: true,
      name: file.name,
      phase: "inspecting",
      completed: 0,
      total: file.size,
      error: null,
    });
    try {
      const { probeLocalSource } = await import("./probe");
      signal.throwIfAborted();
      const metadata = await probeLocalSource(
        file,
        this.controller.lease,
        signal,
      );
      const id = crypto.randomUUID();
      await this.files.copyOriginal(
        file,
        id,
        signal,
        (p: ImportProgress) => this.publish(p),
        async (integrity) => {
          signal.throwIfAborted();
          const source = sourceSchema.parse({
            id,
            name: file.name,
            ...metadata,
            ...integrity,
          });
          await this.controller.dispatchForProject(project.id, {
            kind: "add-source",
            source,
          });
        },
      );
      this.controller.lease.assertActive();
      this.publish({
        active: false,
        phase: "saved",
        completed: file.size,
        total: file.size,
      });
    } catch (e) {
      if (!this.controller.lease.signal.aborted)
        this.publish({
          active: false,
          phase: signal.aborted ? "cancelled" : "error",
          error: signal.aborted
            ? null
            : e instanceof Error
              ? e.message
              : "The video could not be imported.",
        });
      throw e;
    } finally {
      this.cancellation = null;
    }
  }
}
