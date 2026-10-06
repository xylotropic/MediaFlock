import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { EditorController } from "../packages/editor/controller";
import { EditorScopeLease } from "../packages/editor/scope";
import {
  EditorConflictError,
  type EditorProjectStore,
} from "../packages/editor/store";
import type { EditorJournal } from "../packages/editor/journal";

class TestStore implements EditorProjectStore {
  rows = new Map<string, EditorJournal>();
  failure: Error | null = null;
  beforeSave: (() => Promise<void>) | null = null;
  async list() {
    return [...this.rows.values()].map((journal) => ({
      id: journal.project.id,
      name: journal.project.name,
      editSequence: journal.project.editSequence,
      updatedAt: 1,
    }));
  }
  async load(id: string) {
    return structuredClone(this.rows.get(id) ?? null);
  }
  async save(journal: EditorJournal, expected: number | null) {
    await this.beforeSave?.();
    if (this.failure) throw this.failure;
    if (
      (this.rows.get(journal.project.id)?.project.editSequence ?? null) !==
      expected
    )
      throw new EditorConflictError();
    this.rows.set(journal.project.id, structuredClone(journal));
  }
  close() {}
}
function fixture(store = new TestStore()) {
  const lease = new EditorScopeLease({
    backend: "https://example.invalid",
    environment: "demo",
    userId: randomUUID(),
    workspaceId: randomUUID(),
  });
  return { store, lease, controller: new EditorController(lease, store) };
}
it("restores a backup into a new project without overwriting the current saved edit", async () => {
  const { controller, store } = fixture();
  await controller.start();
  await controller.create("Original name");
  await controller.dispatch({ kind: "rename", name: "Backed-up name" });
  const backup = structuredClone(controller.getSnapshot().journal!);
  await controller.dispatch({ kind: "rename", name: "Latest saved edit" });
  await controller.restoreBackup(backup);
  const restored = controller.getSnapshot().journal!;
  expect(restored.project.id).not.toBe(backup.project.id);
  expect(restored.project.editSequence).toBe(0);
  expect(restored.project.name).toBe("Backed-up name (restored)");
  expect(store.rows.get(backup.project.id)?.project.name).toBe(
    "Latest saved edit",
  );
  expect(backup.project.editSequence).toBe(1);
  await controller.undo();
  expect(controller.getSnapshot().journal?.project.name).toBe("Original name");
  const before = controller.getSnapshot().journal;
  await expect(
    controller.restoreBackup({ project: { id: "../../other" } }),
  ).rejects.toThrow();
  expect(controller.getSnapshot().journal).toBe(before);
});
it("serializes rapid edits and reopens durable undo history", async () => {
  const { controller, store } = fixture();
  await controller.start();
  await controller.create("First");
  const command = { kind: "rename" as const, name: "Second" };
  const second = controller.dispatch(command);
  command.name = "Unsubmitted mutation";
  const third = controller.dispatch({ kind: "rename", name: "Third" });
  await Promise.all([second, third]);
  expect(controller.getSnapshot().journal?.project.editSequence).toBe(2);
  const reopened = fixture(store).controller;
  await reopened.start();
  await reopened.undo();
  expect(reopened.getSnapshot().journal?.project.name).toBe("Second");
  expect(reopened.getSnapshot().journal?.project.editSequence).toBe(3);
  await reopened.redo();
  expect(reopened.getSnapshot().journal?.project.name).toBe("Third");
});
it("retains the acknowledged edit on a storage failure", async () => {
  const { controller, store } = fixture();
  await controller.start();
  await controller.create("Saved");
  store.failure = new DOMException(
    "Storage quota exceeded",
    "QuotaExceededError",
  );
  await expect(
    controller.dispatch({ kind: "rename", name: "Unsaved" }),
  ).rejects.toThrow(/quota/);
  expect(controller.getSnapshot().journal?.project.name).toBe("Saved");
  expect(controller.getSnapshot().status).toBe("error");
  store.failure = null;
  await controller.dispatch({ kind: "rename", name: "Retried" });
  expect(controller.getSnapshot().journal?.project.editSequence).toBe(1);
});
it("keeps a whole caption import pending on a failed save and persists one undo after retry", async () => {
  const { controller, store } = fixture();
  await controller.start();
  await controller.create("Caption import");
  const source = {
    id: randomUUID(),
    name: "source.mp4",
    sha256: "a".repeat(64),
    bytes: 1000,
    durationUs: 6_000_000,
    width: 640,
    height: 360,
    hasAudio: true,
    rotation: "0" as const,
  };
  await controller.dispatch({ kind: "add-source", source });
  const before = controller.getSnapshot().journal!;
  const captions = Array.from({ length: 3 }, (_, n) => ({
    id: randomUUID(),
    sourceId: source.id,
    inUs: n * 1_000_000,
    outUs: (n + 1) * 1_000_000,
    text: `Line ${n + 1}`,
  }));
  store.failure = new DOMException(
    "Storage quota exceeded",
    "QuotaExceededError",
  );
  await expect(
    controller.dispatchForProject(before.project.id, {
      kind: "insert-captions",
      captions,
    }),
  ).rejects.toThrow(/quota/);
  expect(controller.getSnapshot().journal).toBe(before);
  expect(store.rows.get(before.project.id)?.project.captions).toHaveLength(0);
  store.failure = null;
  await controller.dispatchForProject(before.project.id, {
    kind: "insert-captions",
    captions,
  });
  const reopened = fixture(store).controller;
  await reopened.start();
  expect(reopened.getSnapshot().journal?.project.captions).toEqual(captions);
  await reopened.undo();
  expect(reopened.getSnapshot().journal?.project.captions).toHaveLength(0);
  await reopened.redo();
  expect(reopened.getSnapshot().journal?.project.captions).toEqual(captions);
  await controller.create("Different project");
  await expect(
    controller.dispatchForProject(before.project.id, {
      kind: "insert-captions",
      captions,
    }),
  ).rejects.toThrow(/project changed/);
  expect(controller.getSnapshot().journal?.project.captions).toHaveLength(0);
});
it("locks conflicted writes until the saved version is reopened", async () => {
  const { controller, store } = fixture();
  await controller.start();
  await controller.create("Initial");
  const other = fixture(store).controller;
  await other.start();
  await other.dispatch({ kind: "rename", name: "Other window" });
  await expect(
    controller.dispatch({ kind: "rename", name: "Stale" }),
  ).rejects.toBeInstanceOf(EditorConflictError);
  await expect(
    controller.dispatch({ kind: "rename", name: "Still stale" }),
  ).rejects.toBeInstanceOf(EditorConflictError);
  await controller.open(other.getSnapshot().journal!.project.id);
  await controller.dispatch({ kind: "rename", name: "Reconciled" });
  expect(controller.getSnapshot().journal?.project.editSequence).toBe(2);
});
it("never republishes an old workspace when an asynchronous save finishes after logout", async () => {
  const { controller, store } = fixture();
  await controller.start();
  await controller.create("Saved");
  let finish!: () => void, entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  store.beforeSave = () =>
    new Promise<void>((resolve) => {
      finish = resolve;
      entered();
    });
  const pending = controller.dispatch({
    kind: "rename",
    name: "Late completion",
  });
  await started;
  controller.close();
  finish();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(controller.getSnapshot()).toMatchObject({
    status: "closed",
    journal: null,
    projects: [],
  });
});
