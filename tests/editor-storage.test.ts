import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { newEditorProject, type LocalSource } from "../packages/editor/project";
import {
  checkedLocalWriteEnd,
  EDITOR_CONTAINER_OVERHEAD_BYTES,
} from "../packages/editor/render-format";
import { EditorScopeLease } from "../packages/editor/scope";
import {
  checkEditorStorageEstimate,
  EDITOR_STORAGE_OVERHEAD_BYTES,
  EDITOR_STORAGE_SPARE_BYTES,
  exportStorageBytes,
  importStorageBytes,
  withEditorStorage,
} from "../packages/editor/storage";

afterEach(() => vi.unstubAllGlobals());
function source(hasAudio = true): LocalSource {
  return {
    id: randomUUID(),
    name: "90-minute original.mp4",
    bytes: 1_000,
    sha256: "a".repeat(64),
    durationUs: 5_400_000_000,
    width: 1920,
    height: 1080,
    hasAudio,
    rotation: "0",
  };
}
function project() {
  const p = newEditorProject(randomUUID(), "Storage fixture");
  p.sources.push(source(), source(), source(false), source());
  for (const s of p.sources.slice(0, 3))
    p.clips.push({
      id: randomUUID(),
      sourceId: s.id,
      inUs: 0,
      outUs: 1_000_000,
      muted: true,
      effects: { brightness: 1, contrast: 1, saturation: 1, look: "original" },
    });
  return p;
}
it("accounts for whole used audio originals even when short cuts are muted", () => {
  const p = project();
  const wholeAudioBytes = 2 * 5_400 * 48_000 * 2 * 4;
  const encodedBytes = ((3 * 8_192_000) / 8) * 1.25;
  expect(exportStorageBytes(p)).toBe(
    2 * wholeAudioBytes +
      2 * encodedBytes +
      2 * EDITOR_CONTAINER_OVERHEAD_BYTES +
      EDITOR_STORAGE_OVERHEAD_BYTES,
  );
  // Repeated cuts do not create additional source caches; only output grows.
  p.clips.push({ ...p.clips[0], id: randomUUID() });
  expect(exportStorageBytes(p)).toBe(
    2 * wholeAudioBytes +
      2 * (((4 * 8_192_000) / 8) * 1.25) +
      2 * EDITOR_CONTAINER_OVERHEAD_BYTES +
      EDITOR_STORAGE_OVERHEAD_BYTES,
  );
});
it("excludes unused and silent sources, including their long durations", () => {
  const p = project();
  p.clips = [p.clips[2]];
  expect(exportStorageBytes(p)).toBe(
    2 * ((8_192_000 / 8) * 1.25) +
      2 * EDITOR_CONTAINER_OVERHEAD_BYTES +
      EDITOR_STORAGE_OVERHEAD_BYTES,
  );
});
it("leaves room for atomic import staging and a separate spare allowance", () => {
  const bytes = importStorageBytes(20 * 1024 ** 3);
  expect(bytes).toBe(40 * 1024 ** 3 + EDITOR_STORAGE_OVERHEAD_BYTES);
  expect(() =>
    checkEditorStorageEstimate(
      { quota: bytes + EDITOR_STORAGE_SPARE_BYTES, usage: 0 },
      bytes,
    ),
  ).not.toThrow();
  expect(() =>
    checkEditorStorageEstimate(
      { quota: bytes + EDITOR_STORAGE_SPARE_BYTES, usage: 1 },
      bytes,
    ),
  ).toThrow(/free browser storage/);
});
it.each([
  {},
  { quota: 1000 },
  { usage: 0 },
  { quota: Infinity, usage: 0 },
  { quota: 1000, usage: NaN },
  { quota: -1, usage: 0 },
  { quota: 1000, usage: -1 },
  { quota: 1000, usage: 1001 },
])("rejects unavailable or invalid quota evidence: %j", (estimate) => {
  expect(() => checkEditorStorageEstimate(estimate, 100)).toThrow(
    /could not check/,
  );
});
it("does not enter work after a scope changes during the capacity check", async () => {
  const lease = new EditorScopeLease({
    backend: "https://fixture.invalid",
    environment: "demo",
    userId: randomUUID(),
    workspaceId: randomUUID(),
  });
  const work = vi.fn();
  vi.stubGlobal("navigator", {
    locks: {
      request: async (
        _name: string,
        _options: unknown,
        callback: () => Promise<unknown>,
      ) => callback(),
    },
    storage: {
      estimate: async () => {
        lease.invalidate();
        return { quota: 10 ** 12, usage: 0 };
      },
    },
  });
  await expect(
    withEditorStorage(lease, undefined, 1_000, work),
  ).rejects.toThrow(/aborted/);
  expect(work).not.toHaveBeenCalled();
});
it("rejects insufficient capacity before creating a file or worker", async () => {
  const lease = new EditorScopeLease({
    backend: "https://fixture.invalid",
    environment: "demo",
    userId: randomUUID(),
    workspaceId: randomUUID(),
  });
  const work = vi.fn();
  vi.stubGlobal("navigator", {
    locks: {
      request: async (
        _name: string,
        _options: unknown,
        callback: () => Promise<unknown>,
      ) => callback(),
    },
    storage: { estimate: async () => ({ quota: 1024, usage: 0 }) },
  });
  await expect(
    withEditorStorage(lease, undefined, 1_000, work),
  ).rejects.toThrow(/free browser storage/);
  expect(work).not.toHaveBeenCalled();
});

it("bounds file extension by end offset while allowing in-place header rewrites", () => {
  expect(checkedLocalWriteEnd(0, 100, 200)).toBe(100);
  expect(checkedLocalWriteEnd(180, 20, 200)).toBe(200);
  expect(checkedLocalWriteEnd(0, 20, 200)).toBe(20);
  expect(() => checkedLocalWriteEnd(181, 20, 200)).toThrow(/file-size limit/);
  expect(() => checkedLocalWriteEnd(10 ** 12, 1, 200)).toThrow(
    /file-size limit/,
  );
});
it.each([
  [NaN, 1],
  [Infinity, 1],
  [-1, 1],
  [0, -1],
  [0, 1.5],
  [Number.MAX_SAFE_INTEGER, 1],
])("rejects invalid or overflowing write offsets: %j", (position, bytes) => {
  expect(() =>
    checkedLocalWriteEnd(position, bytes, Number.MAX_SAFE_INTEGER),
  ).toThrow(/file-size limit/);
});
