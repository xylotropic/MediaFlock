import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { BrowserEditorFiles } from "../packages/editor/files";
import { EditorScopeLease } from "../packages/editor/scope";
import type { LocalSource } from "../packages/editor/project";

class CapturedFiles extends BrowserEditorFiles {
  writes: string[] = [];
  override async copyOriginal(file: File, id: string) {
    this.writes.push(id);
    return { bytes: file.size, sha256: "a".repeat(64) };
  }
}
it("recovers only the exact original under its existing source identity", async () => {
  const lease = new EditorScopeLease({
    backend: "https://fixture.invalid",
    environment: "demo",
    userId: randomUUID(),
    workspaceId: randomUUID(),
  });
  const files = new CapturedFiles(lease);
  const data = new TextEncoder().encode("The immutable original fixture.");
  const file = new File([data], "original.mp4");
  const source: LocalSource = {
    id: randomUUID(),
    name: file.name,
    bytes: file.size,
    sha256: bytesToHex(sha256(data)),
    durationUs: 1_000_000,
    width: 640,
    height: 360,
    hasAudio: true,
    rotation: "0",
  };
  await expect(
    files.restoreOriginal(
      new File([new Uint8Array(file.size)], "different.mp4"),
      source,
    ),
  ).rejects.toThrow(/does not match/);
  await expect(
    files.restoreOriginal(new File([data.slice(1)], "truncated.mp4"), source),
  ).rejects.toThrow(/exact original/);
  expect(files.writes).toEqual([]);
  await files.restoreOriginal(file, source);
  expect(files.writes).toEqual([source.id]);
  lease.invalidate();
  await expect(files.restoreOriginal(file, source)).rejects.toThrow(
    /workspace has changed/,
  );
  expect(files.writes).toEqual([source.id]);
});
