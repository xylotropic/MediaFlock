import { z } from "zod";
import { journalSchema, type EditorJournal } from "./journal";
import type { EditorScopeLease } from "./scope";

const savedSchema = z
  .object({
    namespace: z.string(),
    projectId: z.uuid(),
    journal: journalSchema,
    updatedAt: z.number().int().nonnegative(),
  })
  .strict()
  .refine(
    (row) => row.projectId === row.journal.project.id,
    "The stored project ID does not match its journal.",
  );
export interface ProjectSummary {
  id: string;
  name: string;
  editSequence: number;
  updatedAt: number;
}
export interface EditorProjectStore {
  list(): Promise<ProjectSummary[]>;
  load(id: string): Promise<EditorJournal | null>;
  save(journal: EditorJournal, expectedSequence: number | null): Promise<void>;
  close(): void;
}
export class EditorConflictError extends Error {
  constructor() {
    super(
      "This project changed in another window. Reopen its saved version before editing.",
    );
    this.name = "EditorConflictError";
  }
}

/** Native IndexedDB transactions arbitrate concurrent windows. A save is
 * acknowledged only after its strict-durability transaction completes. */
export class BrowserEditorProjectStore implements EditorProjectStore {
  private readonly database: Promise<IDBDatabase>;
  private closed = false;
  constructor(private readonly lease: EditorScopeLease) {
    lease.assertActive();
    this.database = new Promise((resolve, reject) => {
      const request = indexedDB.open("mediaflock-local-editor", 1);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore("projects", {
          keyPath: ["namespace", "projectId"],
        });
        store.createIndex("namespace", "namespace");
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () =>
        reject(
          new Error(
            "Close older MediaFlock editor windows to open saved projects.",
          ),
        );
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          this.closed = true;
          db.close();
        };
        if (this.closed || lease.signal.aborted) {
          db.close();
          reject(
            new DOMException(
              "The editing workspace has changed.",
              "AbortError",
            ),
          );
        } else resolve(db);
      };
    });
    // Opening can fail before the first consumer attaches its own handler.
    void this.database.catch(() => undefined);
    lease.signal.addEventListener("abort", () => this.close(), { once: true });
  }
  private async run<T>(
    mode: IDBTransactionMode,
    action: (
      store: IDBObjectStore,
      finish: (result: T) => void,
      fail: (error: Error) => void,
    ) => void,
  ): Promise<T> {
    this.lease.assertActive();
    if (this.closed) throw new Error("The local project store is closed.");
    const db = await this.database;
    this.lease.assertActive();
    if (this.closed) throw new Error("The local project store is closed.");
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction("projects", mode, { durability: "strict" });
      let value: T,
        finished = false,
        failure: Error | undefined;
      const abort = () => {
        try {
          tx.abort();
        } catch {
          /* Already completed. */
        }
      };
      this.lease.signal.addEventListener("abort", abort, { once: true });
      const cleanup = () =>
        this.lease.signal.removeEventListener("abort", abort);
      tx.oncomplete = () => {
        cleanup();
        try {
          this.lease.assertActive();
          if (!finished)
            throw new Error("The local save did not return a result.");
          resolve(value);
        } catch (e) {
          reject(e);
        }
      };
      tx.onabort = () => {
        cleanup();
        reject(
          failure ??
            tx.error ??
            new DOMException("The local save was interrupted.", "AbortError"),
        );
      };
      try {
        action(
          tx.objectStore("projects"),
          (result) => {
            value = result;
            finished = true;
          },
          (error) => {
            failure = error;
            abort();
          },
        );
      } catch (e) {
        failure = e instanceof Error ? e : new Error("The local save failed.");
        abort();
      }
    });
  }
  async list(): Promise<ProjectSummary[]> {
    return this.run("readonly", (store, finish, fail) => {
      const rows: ProjectSummary[] = [];
      const request = store
        .index("namespace")
        .openCursor(IDBKeyRange.only(this.lease.namespace));
      request.onsuccess = () => {
        try {
          const cursor = request.result;
          if (!cursor) {
            finish(rows.sort((a, b) => b.updatedAt - a.updatedAt));
            return;
          }
          const row = savedSchema.parse(cursor.value);
          rows.push({
            id: row.projectId,
            name: row.journal.project.name,
            editSequence: row.journal.project.editSequence,
            updatedAt: row.updatedAt,
          });
          if (rows.length > 200)
            throw new Error("This workspace exceeds the local project limit.");
          cursor.continue();
        } catch (e) {
          fail(
            e instanceof Error ? e : new Error("A saved project is invalid."),
          );
        }
      };
    });
  }
  async load(id: string): Promise<EditorJournal | null> {
    z.uuid().parse(id);
    return this.run("readonly", (store, finish, fail) => {
      const request = store.get([this.lease.namespace, id]);
      request.onsuccess = () => {
        try {
          finish(
            request.result === undefined
              ? null
              : savedSchema.parse(request.result).journal,
          );
        } catch {
          fail(
            new Error(
              "The saved project could not be read. Its stored data has been preserved.",
            ),
          );
        }
      };
    });
  }
  async save(
    input: EditorJournal,
    expectedSequence: number | null,
  ): Promise<void> {
    const journal = journalSchema.parse(input);
    if (
      expectedSequence === null
        ? journal.project.editSequence !== 0
        : !Number.isSafeInteger(expectedSequence) ||
          expectedSequence < 0 ||
          journal.project.editSequence !== expectedSequence + 1
    )
      throw new Error("The edit sequence does not match this save.");
    return this.run("readwrite", (store, finish, fail) => {
      const request = store.get([this.lease.namespace, journal.project.id]);
      request.onsuccess = () => {
        try {
          const prior =
            request.result === undefined
              ? null
              : savedSchema.parse(request.result);
          if (
            (prior?.journal.project.editSequence ?? null) !== expectedSequence
          )
            throw new EditorConflictError();
          const write = () => {
            store.put({
              namespace: this.lease.namespace,
              projectId: journal.project.id,
              journal,
              updatedAt: Date.now(),
            });
            finish(undefined);
          };
          if (expectedSequence === null) {
            const count = store
              .index("namespace")
              .count(IDBKeyRange.only(this.lease.namespace));
            count.onsuccess = () => {
              if (count.result >= 200)
                fail(
                  new Error(
                    "This workspace has reached its local project limit.",
                  ),
                );
              else write();
            };
          } else write();
        } catch (e) {
          fail(
            e instanceof Error
              ? e
              : new Error("The project could not be saved."),
          );
        }
      };
    });
  }
  close(): void {
    this.closed = true;
    void this.database.then(
      (db) => db.close(),
      () => undefined,
    );
  }
}
