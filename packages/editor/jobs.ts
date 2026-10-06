import "./browser-types";
import { z } from "zod";
import {
  compileRenderPlan,
  projectSchema,
  type EditorProject,
} from "./project";
import type { BrowserEditorFiles } from "./files";
import type { EditorScopeLease } from "./scope";

const jobPhaseSchema = z.enum([
  "queued",
  "preparing",
  "rendering",
  "finalizing",
  "validating",
  "complete",
  "cancelled",
  "failed",
  "interrupted",
]);
export const editorJobSchema = z
  .object({
    version: z.literal(1),
    id: z.uuid(),
    namespace: z.string(),
    project: projectSchema,
    phase: jobPhaseSchema,
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
    result: z
      .object({
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
        bytes: z.number().int().positive(),
        videoFrames: z.number().int().positive(),
        audioFrames: z.number().int().positive(),
      })
      .strict()
      .nullable(),
    error: z.string().max(2000).nullable(),
  })
  .strict()
  .superRefine((job, ctx) => {
    if ((job.phase === "complete") !== (job.result !== null))
      ctx.addIssue({
        code: "custom",
        message: "Only completed exports may have a finished file receipt.",
      });
    if (job.result) {
      try {
        const plan = compileRenderPlan(job.project);
        if (
          job.result.videoFrames !== plan.videoFrames ||
          job.result.audioFrames !== plan.audioFrames
        )
          ctx.addIssue({
            code: "custom",
            message:
              "The finished export receipt does not match its sealed edit.",
          });
      } catch {
        ctx.addIssue({
          code: "custom",
          message:
            "The finished export does not have a valid editing snapshot.",
        });
      }
    }
  });
export type EditorJob = z.infer<typeof editorJobSchema>;
const terminal = new Set<EditorJob["phase"]>([
  "complete",
  "cancelled",
  "failed",
  "interrupted",
]);
const transitions: Record<
  EditorJob["phase"],
  ReadonlySet<EditorJob["phase"]>
> = {
  queued: new Set(["preparing", "cancelled", "failed", "interrupted"]),
  preparing: new Set(["rendering", "cancelled", "failed", "interrupted"]),
  rendering: new Set(["finalizing", "cancelled", "failed", "interrupted"]),
  finalizing: new Set(["validating", "cancelled", "failed", "interrupted"]),
  validating: new Set(["complete", "cancelled", "failed", "interrupted"]),
  complete: new Set(),
  cancelled: new Set(),
  failed: new Set(),
  interrupted: new Set(),
};
export function transitionEditorJob(
  input: EditorJob,
  phase: EditorJob["phase"],
  receipt: EditorJob["result"] = null,
  error: string | null = null,
): EditorJob {
  const job = editorJobSchema.parse(input);
  if (!transitions[job.phase].has(phase))
    throw new Error("The export state transition is no longer valid.");
  return editorJobSchema.parse({
    ...job,
    phase,
    result: receipt,
    error,
    updatedAt: Date.now(),
  });
}
/** Every job has a unique owned directory. A manifest closes after its staged
 * media; partial files stay unavailable without a complete manifest receipt. */
export class BrowserEditorJobStore {
  cleanupWarning: string | null = null;
  constructor(
    private readonly lease: EditorScopeLease,
    private readonly files: BrowserEditorFiles,
  ) {}
  lockName(id: string) {
    z.uuid().parse(id);
    return `mediaflock-export:${this.lease.namespace}:${id}`;
  }
  async create(
    project: EditorProject,
    id = crypto.randomUUID(),
  ): Promise<EditorJob> {
    this.lease.assertActive();
    if ((await this.files.jobDirectories()).length >= 200)
      throw new Error("This workspace has reached its local export limit.");
    z.uuid().parse(id);
    const time = Date.now();
    const job = editorJobSchema.parse({
      version: 1,
      id,
      namespace: this.lease.namespace,
      project,
      phase: "queued",
      createdAt: time,
      updatedAt: time,
      result: null,
      error: null,
    });
    await this.files.jobDirectory(id, true);
    await this.write(job);
    return job;
  }
  async write(input: EditorJob): Promise<void> {
    const job = editorJobSchema.parse(input);
    this.lease.assertActive();
    if (job.namespace !== this.lease.namespace)
      throw new Error("This export belongs to another workspace.");
    const directory = await this.files.jobDirectory(job.id),
      handle = await directory.getFileHandle("job.json", { create: true });
    this.lease.assertActive();
    const text = JSON.stringify(job);
    if (new TextEncoder().encode(text).byteLength > 64 * 1024 ** 2)
      throw new Error("The export manifest exceeds its storage limit.");
    const writable = await handle.createWritable();
    try {
      this.lease.assertActive();
      await writable.write(text);
      this.lease.assertActive();
      await writable.close();
    } catch (e) {
      await writable.abort().catch(() => undefined);
      throw e;
    }
    this.lease.assertActive();
  }
  async read(id: string): Promise<EditorJob> {
    const directory = await this.files.jobDirectory(id),
      file = await (await directory.getFileHandle("job.json")).getFile();
    if (file.size > 64 * 1024 ** 2)
      throw new Error("The saved export manifest exceeds its storage limit.");
    const job = editorJobSchema.parse(JSON.parse(await file.text()));
    this.lease.assertActive();
    if (job.namespace !== this.lease.namespace || job.id !== id)
      throw new Error(
        "The saved export manifest belongs to another workspace.",
      );
    return job;
  }
  /** Caller must hold this job's WebLock; the worker must already be stopped.
   * Read back the durable manifest rather than trusting a pending transition.
   * Preserve unknown entries, originals, manifests and every sealed video. */
  async cleanupLocked(id: string): Promise<void> {
    const job = await this.read(id);
    if (!terminal.has(job.phase)) return;
    const directory = await this.files.jobDirectory(id);
    const used = new Set(job.project.clips.map((clip) => clip.sourceId));
    const names = job.project.sources
      .filter((source) => used.has(source.id))
      .map((source) => `pcm-${source.id}`);
    if (["cancelled", "failed", "interrupted"].includes(job.phase))
      names.push("video.mp4");
    for (const name of names) {
      this.lease.assertActive();
      try {
        // Never remove a directory whose name happens to match a scratch file.
        await directory.getFileHandle(name);
        this.lease.assertActive();
        await directory.removeEntry(name);
      } catch (e) {
        if (e instanceof DOMException && e.name === "NotFoundError") continue;
        throw e;
      }
    }
    this.lease.assertActive();
  }
  async tryCleanupLocked(id: string): Promise<void> {
    try {
      await this.cleanupLocked(id);
    } catch {
      this.lease.assertActive();
      this.cleanupWarning =
        "Some temporary export files could not be removed. Reopen the editor to retry cleanup. Your saved edits and completed videos remain available.";
    }
  }
  async list(): Promise<EditorJob[]> {
    this.cleanupWarning = null;
    const entries = await this.files.jobDirectories(),
      jobs: EditorJob[] = [];
    for (const entry of entries) {
      this.lease.assertActive();
      // A crash before the first manifest leaves only an unregistered staging
      // directory. Preserve it; it is never offered as a finished export.
      try {
        await entry.directory.getFileHandle("job.json");
      } catch (e) {
        if (e instanceof DOMException && e.name === "NotFoundError") continue;
        throw e;
      }
      let job: EditorJob;
      try {
        job = await this.read(entry.id);
      } catch {
        this.lease.assertActive();
        this.cleanupWarning =
          "A saved export could not be read. Its files were preserved; other checked exports remain available. Reopen the editor to retry.";
        continue;
      }
      try {
        await navigator.locks.request(
          this.lockName(job.id),
          { ifAvailable: true },
          async (lock) => {
            if (!lock) return;
            // Recheck after acquiring the lock: another window may have sealed
            // this export while its earlier manifest was being read.
            job = await this.read(job.id);
            if (!terminal.has(job.phase)) {
              job = transitionEditorJob(
                job,
                "interrupted",
                null,
                "The previous export stopped before completion. Start a new export to resume this project.",
              );
              await this.write(job);
            }
            await this.tryCleanupLocked(job.id);
          },
        );
      } catch {
        this.lease.assertActive();
        this.cleanupWarning =
          "A saved export could not be recovered. Its remaining files were preserved; other checked exports remain available. Reopen the editor to retry.";
        continue;
      }
      jobs.push(job);
    }
    return jobs.sort((a, b) => b.createdAt - a.createdAt);
  }
}
