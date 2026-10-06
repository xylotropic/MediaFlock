import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { z } from "zod";
import type { EditorScopeLease } from "./scope";
import type { LocalSource } from "./project";
import { importStorageBytes, withEditorStorage } from "./storage";

export const LOCAL_FILE_CHUNK_BYTES = 4 * 1024 ** 2;
export const MAX_LOCAL_SOURCE_BYTES = 20 * 1024 ** 3;
export interface ImportProgress {
  phase: "waiting" | "copying" | "verifying";
  completed: number;
  total: number;
}
function check(lease: EditorScopeLease, signal?: AbortSignal) {
  lease.assertActive();
  signal?.throwIfAborted();
}
export async function hashLocalBlob(
  blob: Blob,
  lease: EditorScopeLease,
  signal?: AbortSignal,
  progress?: (completed: number) => void,
): Promise<string> {
  const hash = sha256.create();
  try {
    for (let offset = 0; offset < blob.size; offset += LOCAL_FILE_CHUNK_BYTES) {
      check(lease, signal);
      const data = new Uint8Array(
        await blob.slice(offset, offset + LOCAL_FILE_CHUNK_BYTES).arrayBuffer(),
      );
      check(lease, signal);
      hash.update(data);
      progress?.(Math.min(blob.size, offset + data.length));
    }
    check(lease, signal);
    return bytesToHex(hash.digest());
  } finally {
    hash.destroy();
  }
}

/** Originals are read through File snapshots only. The browser-owned copy is
 * closed and verified before a command may register its source manifest. */
export class BrowserEditorFiles {
  constructor(private readonly lease: EditorScopeLease) {}
  private async scopeDirectory(): Promise<FileSystemDirectoryHandle> {
    this.lease.assertActive();
    const name = bytesToHex(
      sha256(new TextEncoder().encode(this.lease.namespace)),
    );
    const root = await navigator.storage.getDirectory();
    const editor = await root.getDirectoryHandle("mediaflock-editor", {
      create: true,
    });
    const scope = await editor.getDirectoryHandle(name, { create: true });
    this.lease.assertActive();
    return scope;
  }
  private async directory(): Promise<FileSystemDirectoryHandle> {
    const scope = await this.scopeDirectory();
    const sources = await scope.getDirectoryHandle("sources", { create: true });
    this.lease.assertActive();
    return sources;
  }
  async jobDirectory(
    id: string,
    create = false,
  ): Promise<FileSystemDirectoryHandle> {
    z.uuid().parse(id);
    const scope = await this.scopeDirectory(),
      jobs = await scope.getDirectoryHandle("exports", { create: true });
    this.lease.assertActive();
    if (create) {
      try {
        await jobs.getDirectoryHandle(id);
        throw new Error("This export already exists.");
      } catch (e) {
        if (!(e instanceof DOMException && e.name === "NotFoundError")) throw e;
      }
    }
    const directory = await jobs.getDirectoryHandle(id, { create });
    this.lease.assertActive();
    return directory;
  }
  async jobDirectories(): Promise<
    Array<{ id: string; directory: FileSystemDirectoryHandle }>
  > {
    const scope = await this.scopeDirectory(),
      jobs = await scope.getDirectoryHandle("exports", { create: true });
    this.lease.assertActive();
    const rows: Array<{ id: string; directory: FileSystemDirectoryHandle }> =
      [];
    for await (const [id, handle] of jobs.entries()) {
      this.lease.assertActive();
      if (handle.kind !== "directory" || !z.uuid().safeParse(id).success)
        continue;
      if (rows.length >= 200)
        throw new Error("This workspace has reached its local export limit.");
      rows.push({ id, directory: await jobs.getDirectoryHandle(id) });
    }
    return rows;
  }
  async copyOriginal(
    original: File,
    id: string,
    signal?: AbortSignal,
    progress?: (value: ImportProgress) => void,
    register?: (integrity: { sha256: string; bytes: number }) => Promise<void>,
  ): Promise<{ sha256: string; bytes: number }> {
    z.uuid().parse(id);
    if (!original.size || original.size > MAX_LOCAL_SOURCE_BYTES)
      throw new Error("Choose a video between one byte and 20 GB.");
    progress?.({ phase: "waiting", completed: 0, total: original.size });
    return withEditorStorage(
      this.lease,
      signal,
      importStorageBytes(original.size),
      async () => {
        const integrity = await this.copyToNewFile(
          original,
          id,
          signal,
          progress,
        );
        // Registration may commit before its acknowledgement fails. Preserve
        // the verified copy on any registration error; it may be referenced.
        await register?.(integrity);
        return integrity;
      },
      `mediaflock-source:${this.lease.namespace}:${id}`,
    );
  }
  private async copyToNewFile(
    original: File,
    id: string,
    signal?: AbortSignal,
    progress?: (value: ImportProgress) => void,
  ): Promise<{ sha256: string; bytes: number }> {
    check(this.lease, signal);
    if (!original.size || original.size > MAX_LOCAL_SOURCE_BYTES)
      throw new Error("Choose a video between one byte and 20 GB.");
    const directory = await this.directory();
    check(this.lease, signal);
    // Never truncate a prior source, including an interrupted import.
    try {
      await directory.getFileHandle(id);
      throw new Error("This local source already exists.");
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "NotFoundError")) throw e;
    }
    check(this.lease, signal);
    const handle = await directory.getFileHandle(id, { create: true });
    const hash = sha256.create();
    let writable: FileSystemWritableFileStream | undefined;
    let closed = false;
    try {
      writable = await handle.createWritable();
      for (
        let offset = 0;
        offset < original.size;
        offset += LOCAL_FILE_CHUNK_BYTES
      ) {
        check(this.lease, signal);
        const data = new Uint8Array(
          await original
            .slice(offset, offset + LOCAL_FILE_CHUNK_BYTES)
            .arrayBuffer(),
        );
        check(this.lease, signal);
        hash.update(data);
        await writable.write(data);
        check(this.lease, signal);
        progress?.({
          phase: "copying",
          completed: Math.min(original.size, offset + data.length),
          total: original.size,
        });
      }
      await writable.close();
      closed = true;
      check(this.lease, signal);
      const sourceHash = bytesToHex(hash.digest());
      const copy = await handle.getFile();
      if (copy.size !== original.size)
        throw new Error("The local video copy is incomplete.");
      const copiedHash = await hashLocalBlob(
        copy,
        this.lease,
        signal,
        (completed) =>
          progress?.({ phase: "verifying", completed, total: copy.size }),
      );
      if (copiedHash !== sourceHash)
        throw new Error("The local video copy failed its integrity check.");
      check(this.lease, signal);
      return { sha256: sourceHash, bytes: original.size };
    } catch (e) {
      if (!closed) await writable?.abort().catch(() => undefined);
      // This is only the new, unregistered cache copy created by this call.
      await directory.removeEntry(id).catch(() => undefined);
      throw e;
    } finally {
      hash.destroy();
    }
  }
  async readSource(
    source: Pick<LocalSource, "id" | "bytes" | "name">,
  ): Promise<File> {
    z.uuid().parse(source.id);
    const directory = await this.directory();
    this.lease.assertActive();
    let file: File;
    try {
      file = await (await directory.getFileHandle(source.id)).getFile();
    } catch {
      throw new Error(
        `The local copy of ${source.name} is unavailable. Reimport its original to recover it.`,
      );
    }
    this.lease.assertActive();
    if (file.size !== source.bytes)
      throw new Error("The saved local video has changed or is incomplete.");
    return file;
  }
  async verifySource(source: LocalSource, signal?: AbortSignal): Promise<File> {
    const file = await this.readSource(source);
    if ((await hashLocalBlob(file, this.lease, signal)) !== source.sha256)
      throw new Error(
        "The saved local video failed its integrity check. The original has not been changed.",
      );
    return file;
  }
  async restoreOriginal(
    original: File,
    source: LocalSource,
    signal?: AbortSignal,
    progress?: (value: ImportProgress) => void,
  ): Promise<void> {
    check(this.lease, signal);
    if (original.size !== source.bytes)
      throw new Error("Choose the exact original video used by this project.");
    const originalHash = await hashLocalBlob(
      original,
      this.lease,
      signal,
      (completed) =>
        progress?.({ phase: "verifying", completed, total: original.size }),
    );
    if (originalHash !== source.sha256)
      throw new Error(
        "This video does not match the project's original. Your saved edits have not changed.",
      );
    // copyOriginal refuses to overwrite any existing copy and verifies the new
    // closed file. Keep the existing source ID so every edit and cue still fits.
    await this.copyOriginal(original, source.id, signal, progress);
  }
}
