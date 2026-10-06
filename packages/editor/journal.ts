import { z } from "zod";
import {
  captionSchema,
  clipSchema,
  effectsSchema,
  projectSchema,
  sourceSchema,
  frameTimeUs,
  type EditorProject,
} from "./project";
const id = z.uuid();
const index = z.number().int().nonnegative().max(1000);
export const editCommandSchema = z.discriminatedUnion("kind", [
  z
    .object({ kind: z.literal("rename"), name: z.string().min(1).max(200) })
    .strict(),
  z
    .object({
      kind: z.literal("add-source"),
      source: sourceSchema,
      index: index.optional(),
    })
    .strict(),
  z.object({ kind: z.literal("remove-source"), id }).strict(),
  z.object({ kind: z.literal("add-clip"), clip: clipSchema, index }).strict(),
  z.object({ kind: z.literal("remove-clip"), id }).strict(),
  z.object({ kind: z.literal("move-clip"), id, index }).strict(),
  z
    .object({
      kind: z.literal("split-clip"),
      id,
      rightId: id,
      atUs: z.number().int().positive(),
    })
    .strict(),
  z.object({ kind: z.literal("join-split"), id, rightId: id }).strict(),
  z
    .object({
      kind: z.literal("trim-clip"),
      id,
      inUs: z.number().int().nonnegative(),
      outUs: z.number().int().positive(),
    })
    .strict(),
  z
    .object({ kind: z.literal("set-effects"), id, effects: effectsSchema })
    .strict(),
  z.object({ kind: z.literal("set-muted"), id, muted: z.boolean() }).strict(),
  z
    .object({
      kind: z.literal("set-output"),
      output: projectSchema.shape.output,
    })
    .strict(),
  z
    .object({
      kind: z.literal("put-caption"),
      caption: captionSchema,
      index: z.number().int().nonnegative().max(10_000).optional(),
    })
    .strict(),
  z.object({ kind: z.literal("remove-caption"), id }).strict(),
  z
    .object({
      kind: z.literal("edit-caption"),
      caption: captionSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("insert-captions"),
      captions: z.array(captionSchema).min(1).max(10_000),
      index: z.number().int().nonnegative().max(10_000).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("remove-caption-range"),
      ids: z.array(id).min(1).max(10_000),
    })
    .strict(),
]);
export type EditCommand = z.infer<typeof editCommandSchema>;
const entrySchema = z
  .object({ forward: editCommandSchema, backward: editCommandSchema })
  .strict();
export const journalSchema = z
  .object({
    project: projectSchema,
    undo: z.array(entrySchema).max(1000),
    redo: z.array(entrySchema).max(1000),
  })
  .strict();
export type EditorJournal = z.infer<typeof journalSchema>;
function requireIndex<T extends { id: string }>(rows: T[], id: string): number {
  const found = rows.findIndex((row) => row.id === id);
  if (found < 0) throw new Error("The editing item is no longer available.");
  return found;
}
function execute(
  project: EditorProject,
  command: EditCommand,
): { project: EditorProject; inverse: EditCommand } {
  const next = structuredClone(project);
  let inverse: EditCommand;
  switch (command.kind) {
    case "rename":
      inverse = { kind: "rename", name: next.name };
      next.name = command.name;
      break;
    case "add-source":
      if ((command.index ?? next.sources.length) > next.sources.length)
        throw new Error("The source position is no longer available.");
      next.sources.splice(
        command.index ?? next.sources.length,
        0,
        command.source,
      );
      inverse = { kind: "remove-source", id: command.source.id };
      break;
    case "remove-source": {
      const n = requireIndex(next.sources, command.id);
      if (
        next.clips.some((c) => c.sourceId === command.id) ||
        next.captions.some((c) => c.sourceId === command.id)
      )
        throw new Error(
          "Remove the source's clips and captions before unlinking it.",
        );
      inverse = { kind: "add-source", source: next.sources[n], index: n };
      next.sources.splice(n, 1);
      break;
    }
    case "add-clip":
      if (command.index > next.clips.length)
        throw new Error("The clip position is no longer available.");
      next.clips.splice(command.index, 0, command.clip);
      inverse = { kind: "remove-clip", id: command.clip.id };
      break;
    case "remove-clip": {
      const n = requireIndex(next.clips, command.id);
      inverse = { kind: "add-clip", clip: next.clips[n], index: n };
      next.clips.splice(n, 1);
      break;
    }
    case "move-clip": {
      const n = requireIndex(next.clips, command.id);
      if (command.index >= next.clips.length)
        throw new Error("The clip position is no longer available.");
      const [clip] = next.clips.splice(n, 1);
      next.clips.splice(command.index, 0, clip);
      inverse = { kind: "move-clip", id: command.id, index: n };
      break;
    }
    case "trim-clip": {
      const clip = next.clips[requireIndex(next.clips, command.id)];
      inverse = {
        kind: "trim-clip",
        id: clip.id,
        inUs: clip.inUs,
        outUs: clip.outUs,
      };
      clip.inUs = command.inUs;
      clip.outUs = command.outUs;
      break;
    }
    case "split-clip": {
      const n = requireIndex(next.clips, command.id),
        clip = next.clips[n];
      if (command.atUs <= clip.inUs || command.atUs >= clip.outUs)
        throw new Error("Split inside the selected clip.");
      const minimum = frameTimeUs(1, next.output.fps);
      if (
        command.atUs - clip.inUs < minimum ||
        clip.outUs - command.atUs < minimum
      )
        throw new Error(
          "Leave at least one output frame on each side of the split.",
        );
      const right = {
        ...structuredClone(clip),
        id: command.rightId,
        inUs: command.atUs,
      };
      clip.outUs = command.atUs;
      next.clips.splice(n + 1, 0, right);
      inverse = { kind: "join-split", id: clip.id, rightId: right.id };
      break;
    }
    case "join-split": {
      const n = requireIndex(next.clips, command.id),
        left = next.clips[n],
        right = next.clips[n + 1];
      if (
        !right ||
        right.id !== command.rightId ||
        left.sourceId !== right.sourceId ||
        left.outUs !== right.inUs ||
        left.muted !== right.muted ||
        JSON.stringify(left.effects) !== JSON.stringify(right.effects)
      )
        throw new Error("The split clips no longer form the same selection.");
      inverse = {
        kind: "split-clip",
        id: left.id,
        rightId: right.id,
        atUs: left.outUs,
      };
      left.outUs = right.outUs;
      next.clips.splice(n + 1, 1);
      break;
    }
    case "set-effects": {
      const clip = next.clips[requireIndex(next.clips, command.id)];
      inverse = { kind: "set-effects", id: clip.id, effects: clip.effects };
      clip.effects = command.effects;
      break;
    }
    case "set-muted": {
      const clip = next.clips[requireIndex(next.clips, command.id)];
      inverse = { kind: "set-muted", id: clip.id, muted: clip.muted };
      clip.muted = command.muted;
      break;
    }
    case "set-output":
      inverse = { kind: "set-output", output: next.output };
      next.output = command.output;
      break;
    case "put-caption": {
      const n = next.captions.findIndex((c) => c.id === command.caption.id);
      inverse =
        n < 0
          ? { kind: "remove-caption", id: command.caption.id }
          : { kind: "put-caption", caption: next.captions[n], index: n };
      if (n < 0) {
        if ((command.index ?? next.captions.length) > next.captions.length)
          throw new Error("The caption position is no longer available.");
        next.captions.splice(
          command.index ?? next.captions.length,
          0,
          command.caption,
        );
      } else next.captions[n] = command.caption;
      break;
    }
    case "edit-caption": {
      const n = requireIndex(next.captions, command.caption.id);
      if (next.captions[n].sourceId !== command.caption.sourceId)
        throw new Error("An existing caption must keep its original source.");
      inverse = { kind: "edit-caption", caption: next.captions[n] };
      next.captions[n] = command.caption;
      break;
    }
    case "insert-captions": {
      const n = command.index ?? next.captions.length;
      if (n > next.captions.length)
        throw new Error("The caption position is no longer available.");
      next.captions.splice(n, 0, ...command.captions);
      inverse = {
        kind: "remove-caption-range",
        ids: command.captions.map((c) => c.id),
      };
      break;
    }
    case "remove-caption-range": {
      const n = requireIndex(next.captions, command.ids[0]);
      if (
        command.ids.some((id, offset) => next.captions[n + offset]?.id !== id)
      )
        throw new Error("The imported caption range is no longer available.");
      inverse = {
        kind: "insert-captions",
        index: n,
        captions: next.captions.slice(n, n + command.ids.length),
      };
      next.captions.splice(n, command.ids.length);
      break;
    }
    case "remove-caption": {
      const n = requireIndex(next.captions, command.id);
      inverse = { kind: "put-caption", caption: next.captions[n], index: n };
      next.captions.splice(n, 1);
      break;
    }
  }
  next.editSequence = project.editSequence + 1;
  return { project: projectSchema.parse(next), inverse };
}
export function startEditorJournal(project: EditorProject): EditorJournal {
  return journalSchema.parse({ project, undo: [], redo: [] });
}
export function applyEditorCommand(
  input: EditorJournal,
  inputCommand: EditCommand,
): EditorJournal {
  const journal = journalSchema.parse(input),
    command = editCommandSchema.parse(inputCommand);
  const { project, inverse } = execute(journal.project, command);
  return {
    project,
    undo: [...journal.undo, { forward: command, backward: inverse }].slice(
      -1000,
    ),
    redo: [],
  };
}
export function undoEditorCommand(input: EditorJournal): EditorJournal {
  const journal = journalSchema.parse(input),
    entry = journal.undo.at(-1);
  if (!entry) return journal;
  return {
    project: execute(journal.project, entry.backward).project,
    undo: journal.undo.slice(0, -1),
    redo: [...journal.redo, entry],
  };
}
export function redoEditorCommand(input: EditorJournal): EditorJournal {
  const journal = journalSchema.parse(input),
    entry = journal.redo.at(-1);
  if (!entry) return journal;
  return {
    project: execute(journal.project, entry.forward).project,
    undo: [...journal.undo, entry],
    redo: journal.redo.slice(0, -1),
  };
}
