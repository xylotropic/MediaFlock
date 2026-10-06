import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { newEditorProject } from "../packages/editor/project";
import {
  applyEditorCommand,
  journalSchema,
  redoEditorCommand,
  startEditorJournal,
  undoEditorCommand,
} from "../packages/editor/journal";
it("retains undo and redo through serialization without rolling the sequence backward", () => {
  let state = startEditorJournal(newEditorProject(randomUUID(), "First name"));
  state = applyEditorCommand(state, { kind: "rename", name: "Second name" });
  state = applyEditorCommand(state, { kind: "rename", name: "Third name" });
  state = journalSchema.parse(JSON.parse(JSON.stringify(state)));
  state = undoEditorCommand(state);
  expect(state.project.name).toBe("Second name");
  expect(state.project.editSequence).toBe(3);
  state = undoEditorCommand(state);
  expect(state.project.name).toBe("First name");
  expect(state.project.editSequence).toBe(4);
  state = redoEditorCommand(state);
  expect(state.project.name).toBe("Second name");
  expect(state.project.editSequence).toBe(5);
  state = applyEditorCommand(state, { kind: "rename", name: "New direction" });
  expect(state.redo).toHaveLength(0);
});
it("rejects invalid edits without mutating the acknowledged project or history", () => {
  const state = startEditorJournal(
      newEditorProject(randomUUID(), "Saved project"),
    ),
    before = JSON.stringify(state);
  expect(() =>
    applyEditorCommand(state, { kind: "rename", name: "" }),
  ).toThrow();
  expect(JSON.stringify(state)).toBe(before);
  expect(() =>
    applyEditorCommand(state, { kind: "remove-clip", id: randomUUID() }),
  ).toThrow(/no longer available/);
  expect(JSON.stringify(state)).toBe(before);
});
it("preserves source manifests when removing and restoring a clip", () => {
  let state = startEditorJournal(
    newEditorProject(randomUUID(), "Source fixture"),
  );
  const source = {
    id: randomUUID(),
    name: "original.mp4",
    sha256: "a".repeat(64),
    bytes: 1000,
    durationUs: 6_000_000,
    width: 640,
    height: 360,
    hasAudio: true,
    rotation: "0" as const,
  };
  state = applyEditorCommand(state, { kind: "add-source", source });
  const clip = {
    id: randomUUID(),
    sourceId: source.id,
    inUs: 500_000,
    outUs: 1_500_000,
    muted: false,
    effects: {
      brightness: 1,
      contrast: 1,
      saturation: 1,
      look: "original" as const,
    },
  };
  state = applyEditorCommand(state, { kind: "add-clip", clip, index: 0 });
  expect(() =>
    applyEditorCommand(state, { kind: "remove-source", id: source.id }),
  ).toThrow(/clips and captions/);
  state = applyEditorCommand(state, { kind: "remove-clip", id: clip.id });
  expect(state.project.sources).toEqual([source]);
  state = undoEditorCommand(state);
  expect(state.project.clips).toEqual([clip]);
});
it("restores source and caption order exactly after removal and undo", () => {
  let state = startEditorJournal(
    newEditorProject(randomUUID(), "Order fixture"),
  );
  for (const name of ["first.mp4", "second.mp4", "third.mp4"]) {
    state = applyEditorCommand(state, {
      kind: "add-source",
      source: {
        id: randomUUID(),
        name,
        sha256: "a".repeat(64),
        bytes: 1000,
        durationUs: 6_000_000,
        width: 640,
        height: 360,
        hasAudio: true,
        rotation: "0",
      },
    });
  }
  const sources = structuredClone(state.project.sources);
  state = applyEditorCommand(state, {
    kind: "remove-source",
    id: sources[0].id,
  });
  state = undoEditorCommand(state);
  expect(state.project.sources).toEqual(sources);
  for (const text of ["First", "Second", "Third"]) {
    state = applyEditorCommand(state, {
      kind: "put-caption",
      caption: {
        id: randomUUID(),
        sourceId: sources[0].id,
        inUs: 0,
        outUs: 1_000_000,
        text,
      },
    });
  }
  const captions = structuredClone(state.project.captions);
  state = applyEditorCommand(state, {
    kind: "remove-caption",
    id: captions[0].id,
  });
  state = undoEditorCommand(state);
  expect(state.project.captions).toEqual(captions);
});
it("treats splitting as one durable undoable edit and retains the original source range", () => {
  const sourceId = randomUUID(),
    clipId = randomUUID(),
    rightId = randomUUID();
  const project = newEditorProject(randomUUID(), "Split fixture");
  project.sources.push({
    id: sourceId,
    name: "source.mp4",
    sha256: "a".repeat(64),
    bytes: 1000,
    durationUs: 6_000_000,
    width: 640,
    height: 360,
    hasAudio: true,
    rotation: "0",
  });
  project.clips.push({
    id: clipId,
    sourceId,
    inUs: 500_000,
    outUs: 4_500_000,
    muted: false,
    effects: { brightness: 1, contrast: 1, saturation: 1, look: "sepia" },
  });
  const before = startEditorJournal(project);
  expect(() =>
    applyEditorCommand(before, {
      kind: "split-clip",
      id: clipId,
      rightId,
      atUs: 500_001,
    }),
  ).toThrow(/one output frame/);
  expect(() =>
    applyEditorCommand(before, {
      kind: "split-clip",
      id: clipId,
      rightId,
      atUs: 4_499_999,
    }),
  ).toThrow(/one output frame/);
  expect(before.project.clips).toHaveLength(1);
  let state = applyEditorCommand(startEditorJournal(project), {
    kind: "split-clip",
    id: clipId,
    rightId,
    atUs: 533_333,
  });
  expect(state.project.clips.map((c) => [c.inUs, c.outUs])).toEqual([
    [500_000, 533_333],
    [533_333, 4_500_000],
  ]);
  expect(state.undo).toHaveLength(1);
  state = undoEditorCommand(
    journalSchema.parse(JSON.parse(JSON.stringify(state))),
  );
  expect(state.project.clips).toEqual(project.clips);
  state = redoEditorCommand(state);
  expect(state.project.clips[1].id).toBe(rightId);
  expect(state.project.clips[1].effects.look).toBe("sepia");
});
