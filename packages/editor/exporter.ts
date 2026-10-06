import { z } from "zod";
import type { EditorController } from "./controller";
import {
  BrowserEditorJobStore,
  transitionEditorJob,
  type EditorJob,
} from "./jobs";
import { compileRenderPlan } from "./project";
import { hashLocalBlob, type BrowserEditorFiles } from "./files";
import type { RenderProgress, RenderResult } from "./render";
import type {
  ExportWorkerRequest,
  ExportWorkerResponse,
} from "./worker-protocol";
import { exportStorageBytes, withEditorStorage } from "./storage";

export interface ExportSnapshot {
  active: boolean;
  canCancel: boolean;
  cancelling: boolean;
  jobId: string | null;
  progress: RenderProgress | null;
  jobs: EditorJob[];
  error: string | null;
  waiting: boolean;
  cleanupWarning: string | null;
}
export type ExportWorkerFactory = () => Worker;
export class EditorExporter {
  private snapshot: ExportSnapshot = Object.freeze({
    active: false,
    canCancel: false,
    cancelling: false,
    jobId: null,
    progress: null,
    jobs: [],
    error: null,
    waiting: false,
    cleanupWarning: null,
  });
  private readonly subscribers = new Set<() => void>();
  private readonly store: BrowserEditorJobStore;
  private cancellation: AbortController | null = null;
  constructor(
    private readonly controller: EditorController,
    private readonly files: BrowserEditorFiles,
    private readonly workerFactory: ExportWorkerFactory,
    jobStore?: BrowserEditorJobStore,
  ) {
    this.store = jobStore ?? new BrowserEditorJobStore(controller.lease, files);
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  };
  private publish(partial: Partial<ExportSnapshot>) {
    this.snapshot = Object.freeze({ ...this.snapshot, ...partial });
    this.subscribers.forEach((listener) => listener());
  }
  async start() {
    try {
      const jobs = await this.store.list();
      this.controller.lease.assertActive();
      this.publish({
        jobs,
        error: null,
        cleanupWarning: this.store.cleanupWarning,
      });
    } catch (e) {
      if (!this.controller.lease.signal.aborted)
        this.publish({
          error:
            e instanceof Error
              ? e.message
              : "Saved exports could not be opened.",
        });
    }
  }
  cancel() {
    if (this.snapshot.canCancel) {
      this.publish({ canCancel: false, cancelling: true });
      this.cancellation?.abort();
    }
  }
  private runWorker(
    request: Extract<ExportWorkerRequest, { type: "start" }>,
    signal: AbortSignal,
    onProgress: (value: RenderProgress) => void,
    onStopped: () => void,
  ): Promise<RenderResult> {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const worker = this.workerFactory();
      let finished = false,
        timer: ReturnType<typeof setTimeout> | null = null;
      const finish = (
        error: Error | null,
        result?: RenderResult,
        acknowledged = false,
      ) => {
        if (finished) return;
        finished = true;
        if (timer) clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        worker.terminate();
        if (acknowledged) onStopped();
        if (error) reject(error);
        else resolve(result!);
      };
      const abort = () => {
        worker.postMessage({
          type: "cancel",
          jobId: request.jobId,
        } satisfies ExportWorkerRequest);
        timer = setTimeout(
          () => finish(new DOMException("Export cancelled.", "AbortError")),
          2000,
        );
      };
      worker.onmessage = (event: MessageEvent<ExportWorkerResponse>) => {
        const message = event.data;
        if (message.jobId !== request.jobId || finished) return;
        if (message.type === "progress") {
          if (!signal.aborted) onProgress(message.value);
        } else if (message.type === "complete")
          finish(
            signal.aborted
              ? new DOMException("Export cancelled.", "AbortError")
              : null,
            message.result,
            true,
          );
        else if (message.type === "error")
          finish(
            signal.aborted || message.name === "AbortError"
              ? new DOMException("Export cancelled.", "AbortError")
              : new Error(message.message),
            undefined,
            true,
          );
      };
      worker.onerror = () =>
        finish(
          new Error(
            "The local export worker stopped unexpectedly. Your source videos and saved edits remain available.",
          ),
        );
      signal.addEventListener("abort", abort, { once: true });
      try {
        worker.postMessage(request);
      } catch (e) {
        finish(
          e instanceof Error
            ? e
            : new Error("The export worker could not be started."),
        );
      }
    });
  }
  async export(): Promise<void> {
    this.controller.lease.assertActive();
    if (this.snapshot.active)
      throw new Error("Wait for the current export to finish.");
    const project = this.controller.getSnapshot().journal?.project;
    if (!project) throw new Error("Open an editing project first.");
    const plan = compileRenderPlan(project),
      jobId = crypto.randomUUID();
    this.cancellation = new AbortController();
    const signal = AbortSignal.any([
      this.cancellation.signal,
      this.controller.lease.signal,
    ]);
    this.publish({
      active: true,
      canCancel: true,
      cancelling: false,
      jobId,
      progress: { phase: "preparing", completed: 0, total: 1 },
      error: null,
      waiting: true,
    });
    try {
      await withEditorStorage(
        this.controller.lease,
        signal,
        exportStorageBytes(project),
        async () => {
          this.publish({ waiting: false });
          let job = await this.store.create(project, jobId),
            queue = Promise.resolve();
          let safeToClean = true,
            expectedComplete: EditorJob | null = null;
          const savePhase = (phase: EditorJob["phase"]) => {
            queue = queue.then(async () => {
              signal.throwIfAborted();
              if (job.phase === phase) return;
              job = transitionEditorJob(job, phase);
              await this.store.write(job);
            });
            void queue.catch(() => undefined);
          };
          try {
            savePhase("preparing");
            await queue;
            const used = new Set(plan.clips.map((c) => c.sourceId)),
              inputFiles: Array<[string, File]> = [];
            for (const source of plan.sources.filter((s) => used.has(s.id))) {
              inputFiles.push([
                source.id,
                await this.files.verifySource(source, signal),
              ]);
            }
            signal.throwIfAborted();
            const directory = await this.files.jobDirectory(job.id);
            safeToClean = false;
            const result = await this.runWorker(
              {
                type: "start",
                jobId,
                scope: this.controller.lease.scope,
                project,
                files: inputFiles,
                directory,
              },
              signal,
              (value) => {
                this.publish({ progress: value });
                savePhase(value.phase);
              },
              () => {
                safeToClean = true;
              },
            );
            await queue;
            signal.throwIfAborted();
            if (
              result.projectId !== project.id ||
              result.editSequence !== project.editSequence ||
              result.videoFrames !== plan.videoFrames ||
              result.audioFrames !== plan.audioFrames
            )
              throw new Error(
                "The finished export does not match its saved edit.",
              );
            const sha256 = await hashLocalBlob(
              result.file,
              this.controller.lease,
              signal,
            );
            signal.throwIfAborted();
            // Completion and cancellation share one decision point. Once
            // sealing begins, Cancel is disabled until the manifest closes.
            this.publish({ canCancel: false });
            job = transitionEditorJob(job, "complete", {
              sha256,
              bytes: result.file.size,
              videoFrames: result.videoFrames,
              audioFrames: result.audioFrames,
            });
            expectedComplete = job;
            await this.store.write(job);
            const persisted = await this.store.read(job.id);
            if (JSON.stringify(persisted) !== JSON.stringify(expectedComplete))
              throw new Error(
                "The saved export receipt could not be confirmed. Its files have been preserved.",
              );
            job = persisted;
            this.controller.lease.assertActive();
            this.publish({ jobs: [job, ...this.snapshot.jobs] });
          } catch (e) {
            await queue.catch(() => undefined);
            if (!this.controller.lease.signal.aborted) {
              let persisted: EditorJob;
              try {
                persisted = await this.store.read(job.id);
              } catch {
                safeToClean = false;
                throw e;
              }
              if (persisted.phase === "complete") {
                // A commit can close successfully and then lose its
                // acknowledgement. Never downgrade that sealed result.
                if (
                  expectedComplete &&
                  JSON.stringify(persisted) === JSON.stringify(expectedComplete)
                ) {
                  job = persisted;
                  this.publish({ jobs: [job, ...this.snapshot.jobs] });
                  return;
                }
                safeToClean = false;
                throw e;
              }
              if (expectedComplete) {
                // Sealing has started: preserve an unconfirmed output,
                // rather than turn ambiguous completion into deletion.
                safeToClean = false;
                throw e;
              }
              job = persisted;
              if (!["cancelled", "failed", "interrupted"].includes(job.phase)) {
                job = transitionEditorJob(
                  job,
                  signal.aborted ? "cancelled" : "failed",
                  null,
                  e instanceof Error
                    ? e.message
                    : "The export stopped before completion.",
                );
                await this.store.write(job);
              }
              this.publish({ jobs: [job, ...this.snapshot.jobs] });
            }
            throw e;
          } finally {
            if (!this.controller.lease.signal.aborted) {
              if (safeToClean) await this.store.tryCleanupLocked(job.id);
              else
                this.store.cleanupWarning =
                  "Temporary export files were preserved because shutdown or saving could not be confirmed. Reopen the editor to recover this job safely.";
              this.publish({ cleanupWarning: this.store.cleanupWarning });
            }
          }
        },
        this.store.lockName(jobId),
      );
    } catch (e) {
      if (!this.controller.lease.signal.aborted && !signal.aborted)
        this.publish({
          error:
            e instanceof Error
              ? e.message
              : "The export could not be completed.",
        });
      throw e;
    } finally {
      this.cancellation = null;
      if (!this.controller.lease.signal.aborted)
        this.publish({
          active: false,
          canCancel: false,
          cancelling: false,
          jobId: null,
          progress: null,
          waiting: false,
        });
    }
  }
  async finishedFile(id: string): Promise<File> {
    z.uuid().parse(id);
    const job = await this.store.read(id);
    if (job.phase !== "complete" || !job.result)
      throw new Error("This export has not completed its checks.");
    const directory = await this.files.jobDirectory(id),
      file = await (await directory.getFileHandle("video.mp4")).getFile();
    if (
      file.size !== job.result.bytes ||
      (await hashLocalBlob(file, this.controller.lease)) !== job.result.sha256
    )
      throw new Error(
        "The saved export failed its integrity check. Render a new export from the saved project.",
      );
    this.controller.lease.assertActive();
    return file;
  }
}
