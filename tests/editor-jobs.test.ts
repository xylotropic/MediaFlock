import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import {
  editorJobSchema,
  transitionEditorJob,
  type EditorJob,
} from "../packages/editor/jobs";
import { newEditorProject } from "../packages/editor/project";
function job(): EditorJob {
  const project = newEditorProject(randomUUID(), "Export fixture"),
    sourceId = randomUUID();
  project.sources.push({
    id: sourceId,
    name: "source.mp4",
    sha256: "a".repeat(64),
    bytes: 1000,
    durationUs: 1_000_000,
    width: 640,
    height: 360,
    hasAudio: true,
    rotation: "0",
  });
  project.clips.push({
    id: randomUUID(),
    sourceId,
    inUs: 0,
    outUs: 1_000_000,
    muted: false,
    effects: { brightness: 1, contrast: 1, saturation: 1, look: "original" },
  });
  return editorJobSchema.parse({
    version: 1,
    id: randomUUID(),
    namespace: "isolated fixture",
    project,
    phase: "queued",
    createdAt: 1,
    updatedAt: 1,
    result: null,
    error: null,
  });
}
const receipt = {
  sha256: "b".repeat(64),
  bytes: 3000,
  videoFrames: 30,
  audioFrames: 48000,
};
it("does not offer an incomplete or cancelled file as a finished export", () => {
  for (const phase of [
    "preparing",
    "rendering",
    "finalizing",
    "validating",
  ] as const) {
    let state = job();
    for (const step of [
      "preparing",
      "rendering",
      "finalizing",
      "validating",
    ] as const) {
      state = transitionEditorJob(state, step);
      if (step === phase) break;
    }
    state = transitionEditorJob(state, "cancelled");
    expect(state.result).toBeNull();
    expect(() => transitionEditorJob(state, "complete", receipt)).toThrow(
      /no longer valid/,
    );
    expect(
      editorJobSchema.safeParse({ ...state, result: receipt }).success,
    ).toBe(false);
  }
});
it("binds the finished receipt to the sealed picture and sound endpoints", () => {
  let state = job();
  for (const step of [
    "preparing",
    "rendering",
    "finalizing",
    "validating",
  ] as const)
    state = transitionEditorJob(state, step);
  expect(() =>
    transitionEditorJob(state, "complete", { ...receipt, audioFrames: 49024 }),
  ).toThrow(/sealed edit/);
  state = transitionEditorJob(state, "complete", receipt);
  expect(state.result).toEqual(receipt);
  expect(() => transitionEditorJob(state, "cancelled")).toThrow(
    /no longer valid/,
  );
});
