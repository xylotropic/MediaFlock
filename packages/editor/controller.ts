import {
  applyEditorCommand,
  redoEditorCommand,
  startEditorJournal,
  undoEditorCommand,
  journalSchema,
  type EditCommand,
  type EditorJournal,
} from "./journal";
import { newEditorProject } from "./project";
import {
  EditorConflictError,
  type EditorProjectStore,
  type ProjectSummary,
} from "./store";
import type { EditorScopeLease } from "./scope";

export interface EditorSnapshot {
  status: "opening" | "ready" | "saving" | "error" | "closed";
  journal: EditorJournal | null;
  projects: ProjectSummary[];
  error: string | null;
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.freeze(value);
    Object.values(value).forEach(freeze);
  }
  return value;
}

/** The controller lives above screen navigation. It serializes mutations and
 * publishes only acknowledged saves; failed writes retain the prior edit. */
export class EditorController {
  private snapshot: EditorSnapshot = freeze({
    status: "opening",
    journal: null,
    projects: [],
    error: null,
  });
  private readonly subscribers = new Set<() => void>();
  private queue: Promise<unknown> = Promise.resolve();
  private conflict = false;
  private started = false;
  constructor(
    readonly lease: EditorScopeLease,
    private readonly store: EditorProjectStore,
  ) {}
  getSnapshot = (): EditorSnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  };
  private publish(partial: Partial<EditorSnapshot>): void {
    this.snapshot = freeze({ ...this.snapshot, ...partial });
    this.subscribers.forEach((listener) => listener());
  }
  private run<T>(operation: () => Promise<T>): Promise<T> {
    const work = this.queue.then(async () => {
      this.lease.assertActive();
      this.publish({ status: "saving", error: null });
      try {
        const result = await operation();
        this.lease.assertActive();
        this.publish({ status: "ready" });
        return result;
      } catch (e) {
        if (!this.lease.signal.aborted) {
          if (e instanceof EditorConflictError) this.conflict = true;
          this.publish({
            status: "error",
            error:
              e instanceof Error
                ? e.message
                : "The local edit could not be saved.",
          });
        }
        throw e;
      }
    });
    this.queue = work.catch(() => undefined);
    return work;
  }
  start(): Promise<void> {
    if (this.started) return this.queue.then(() => undefined);
    this.started = true;
    return this.run(async () => {
      const projects = await this.store.list();
      this.lease.assertActive();
      const journal = projects.length
        ? await this.store.load(projects[0].id)
        : null;
      this.lease.assertActive();
      this.publish({ projects, journal });
    });
  }
  create(name: string): Promise<void> {
    return this.run(async () => {
      if (this.snapshot.projects.length >= 200)
        throw new Error("This workspace has reached its local project limit.");
      const journal = startEditorJournal(
        newEditorProject(crypto.randomUUID(), name),
      );
      await this.store.save(journal, null);
      this.lease.assertActive();
      const projects = await this.store.list();
      this.lease.assertActive();
      this.conflict = false;
      this.publish({ journal, projects });
    });
  }
  async restoreBackup(input: unknown): Promise<void> {
    // Import into a new project; an uploaded backup cannot overwrite a newer
    // saved edit. Source IDs are retained for exact-original recovery.
    const copy = journalSchema.parse(input);
    copy.project.id = crypto.randomUUID();
    copy.project.name = `${copy.project.name.slice(0, 189)} (restored)`;
    copy.project.editSequence = 0;
    return this.run(async () => {
      if (this.snapshot.projects.length >= 200)
        throw new Error("This workspace has reached its local project limit.");
      await this.store.save(copy, null);
      this.lease.assertActive();
      const projects = await this.store.list();
      this.lease.assertActive();
      this.conflict = false;
      this.publish({ journal: copy, projects });
    });
  }
  open(id: string): Promise<void> {
    return this.run(async () => {
      const journal = await this.store.load(id);
      this.lease.assertActive();
      if (!journal)
        throw new Error("The saved editing project is no longer available.");
      this.conflict = false;
      this.publish({ journal });
    });
  }
  private edit(
    change: (journal: EditorJournal) => EditorJournal,
  ): Promise<void> {
    return this.run(async () => {
      if (this.conflict) throw new EditorConflictError();
      const prior = this.snapshot.journal;
      if (!prior) throw new Error("Create or open an editing project first.");
      const journal = change(prior);
      if (journal.project.editSequence === prior.project.editSequence) return;
      await this.store.save(journal, prior.project.editSequence);
      this.lease.assertActive();
      const projects = this.snapshot.projects.map((p) =>
        p.id === journal.project.id
          ? {
              id: p.id,
              name: journal.project.name,
              editSequence: journal.project.editSequence,
              updatedAt: Date.now(),
            }
          : p,
      );
      this.publish({ journal, projects });
    });
  }
  dispatch(command: EditCommand): Promise<void> {
    const copy = structuredClone(command);
    return this.edit((journal) => applyEditorCommand(journal, copy));
  }
  dispatchForProject(projectId: string, command: EditCommand): Promise<void> {
    const copy = structuredClone(command);
    return this.edit((journal) => {
      if (journal.project.id !== projectId)
        throw new Error(
          "The editing project changed before this change could be saved. Reopen the intended project before continuing.",
        );
      return applyEditorCommand(journal, copy);
    });
  }
  undo(): Promise<void> {
    return this.edit(undoEditorCommand);
  }
  redo(): Promise<void> {
    return this.edit(redoEditorCommand);
  }
  close(): void {
    this.lease.invalidate();
    this.store.close();
    this.publish({
      status: "closed",
      journal: null,
      projects: [],
      error: null,
    });
    this.subscribers.clear();
  }
}
