"use client";
import { useEffect, useRef, useState } from "react";
import { Download, Pencil, Plus, Trash2, Upload } from "lucide-react";
import { Button } from "../base/buttons/button";
import { useApp } from "../context";
import {
  MAX_CAPTION_FILE_BYTES,
  parseCaptionFile,
  timelineCaptionFile,
  type CaptionImport,
} from "../../../../packages/editor/caption-files";
import type {
  EditorClip,
  EditorProject,
  LocalSource,
  SourceCaption,
} from "../../../../packages/editor/project";
import type { EditorRuntime } from "./provider";

function captionCount(count: number) {
  return `${count} ${count === 1 ? "caption" : "captions"}`;
}
export function downloadCaptionFile(project: EditorProject, name: string) {
  const text = timelineCaptionFile(project);
  const url = URL.createObjectURL(
    new Blob([text], { type: "application/x-subrip;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `${name.replace(/[^\p{L}\p{N}_-]/gu, "_") || "MediaFlock"}.srt`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function CaptionPanel({
  runtime,
  project,
  source,
  selected,
}: {
  runtime: EditorRuntime;
  project: EditorProject;
  source: LocalSource;
  selected: EditorClip;
}) {
  const { notify } = useApp();
  const [editingId, setEditingId] = useState("");
  const [pageNumber, setPageNumber] = useState(0);
  const [pending, setPending] = useState<
    (CaptionImport & { name: string }) | null
  >(null);
  const [busy, setBusy] = useState(false);
  const request = useRef(0),
    input = useRef<HTMLInputElement>(null);
  useEffect(
    () => () => {
      request.current++;
    },
    [],
  );
  const captions = project.captions.filter((c) => c.sourceId === source.id);
  const editing = captions.find((c) => c.id === editingId);
  const page = Math.min(
    pageNumber,
    Math.max(0, Math.ceil(captions.length / 50) - 1),
  );
  function report(error: unknown) {
    if (!runtime.controller.lease.signal.aborted)
      notify(
        error instanceof Error
          ? error.message
          : "The captions could not be saved.",
      );
  }
  async function importFile(file: File) {
    const generation = ++request.current;
    setBusy(true);
    setPending(null);
    try {
      if (file.size > MAX_CAPTION_FILE_BYTES)
        throw new Error("Choose a caption file smaller than 2 MB.");
      const bytes = await file.arrayBuffer();
      runtime.controller.lease.assertActive();
      if (generation !== request.current) return;
      let text: string;
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        throw new Error("Save the subtitle file as UTF-8 before importing it.");
      }
      const parsed = parseCaptionFile(text, source);
      if (project.captions.length + parsed.captions.length > 10_000)
        throw new Error(
          "This project can hold at most 10,000 source captions. Remove unused cues before importing more.",
        );
      setPending({ ...parsed, name: file.name });
    } catch (error) {
      if (generation === request.current) report(error);
    } finally {
      if (generation === request.current) setBusy(false);
    }
  }
  async function acceptImport() {
    if (!pending) return;
    setBusy(true);
    try {
      await runtime.controller.dispatchForProject(project.id, {
        kind: "insert-captions",
        captions: pending.captions,
      });
      runtime.controller.lease.assertActive();
      setPending(null);
      setPageNumber(0);
      notify(
        `${captionCount(pending.captions.length)} saved for ${source.name}. Undo removes this import together.`,
      );
    } catch (error) {
      report(error);
    } finally {
      setBusy(false);
    }
  }
  async function saveCaption(values: {
    inUs: number;
    outUs: number;
    text: string;
  }) {
    const caption = {
      ...values,
      sourceId: source.id,
      id: editing?.id || crypto.randomUUID(),
    };
    await runtime.controller.dispatchForProject(project.id, {
      kind: editing ? "edit-caption" : "put-caption",
      caption,
    });
    runtime.controller.lease.assertActive();
    setEditingId("");
  }
  return (
    <section className="panel editor-caption-panel">
      <div className="panel-head">
        <div>
          <h2>Captions</h2>
          <p className="editor-caption-source" title={source.name}>
            Original source: {source.name}
          </p>
        </div>
        <label>
          <input
            type="checkbox"
            checked={project.output.captions}
            onChange={(e) => {
              void runtime.controller
                .dispatchForProject(project.id, {
                  kind: "set-output",
                  output: { ...project.output, captions: e.target.checked },
                })
                .catch(report);
            }}
          />{" "}
          Show in picture
        </label>
      </div>
      <div className="panel-body">
        <div className="editor-caption-tools">
          <Button
            variant="secondary"
            leadingIcon={Upload}
            disabled={busy}
            onClick={() => input.current?.click()}
          >
            Import SRT / VTT
          </Button>
          <Button
            variant="secondary"
            leadingIcon={Download}
            disabled={!project.captions.length || !project.clips.length}
            onClick={() => {
              try {
                runtime.controller.lease.assertActive();
                downloadCaptionFile(project, `${project.name}-timeline`);
              } catch (error) {
                report(error);
              }
            }}
          >
            Download timeline captions
          </Button>
          <span>
            {captions.length} source{" "}
            {captions.length === 1 ? "caption" : "captions"}
          </span>
        </div>
        <input
          ref={input}
          type="file"
          className="editor-file-input"
          accept=".srt,.vtt,application/x-subrip,text/vtt"
          aria-label="Import local subtitle file"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void importFile(file);
          }}
        />
        {busy && <p role="status">Checking or saving captions…</p>}
        {pending && (
          <div
            className="editor-caption-import-review"
            role="region"
            aria-label="Review caption import"
          >
            <strong>{pending.name}</strong>
            <p>
              Add {captionCount(pending.captions.length)} to the original source{" "}
              <strong>{source.name}</strong>. Times use that video&apos;s clock.
              Existing captions are kept.
            </p>
            {pending.styleConverted && (
              <p>
                Imported formatting and position settings use MediaFlock&apos;s
                caption style.
              </p>
            )}
            <ol>
              {pending.captions.slice(0, 3).map((c) => (
                <li key={c.id}>
                  <span>
                    {(c.inUs / 1_000_000).toFixed(3)}–
                    {(c.outUs / 1_000_000).toFixed(3)}s
                  </span>
                  <p>{c.text}</p>
                </li>
              ))}
            </ol>
            <div className="row">
              <Button disabled={busy} onClick={() => void acceptImport()}>
                Add {captionCount(pending.captions.length)}
              </Button>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => setPending(null)}
              >
                Cancel import
              </Button>
            </div>
          </div>
        )}
        <CaptionForm
          key={
            editing
              ? `edit:${editing.id}`
              : `new:${selected.id}:${selected.inUs}:${selected.outUs}`
          }
          source={source}
          selected={selected}
          caption={editing}
          save={saveCaption}
          cancel={() => setEditingId("")}
          report={report}
        />
        <p className="editor-storage-note">
          Cue times refer to the original source. Captions follow its clips when
          you split, trim, or reorder them. Timeline downloads use the edited
          video&apos;s clock; saved-export captions match that export&apos;s
          exact edit.
        </p>
        <ol className="editor-captions">
          {captions.slice(page * 50, page * 50 + 50).map((c) => (
            <li key={c.id}>
              <span>
                {(c.inUs / 1_000_000).toFixed(3)}–
                {(c.outUs / 1_000_000).toFixed(3)}s
              </span>
              <p>{c.text}</p>
              <div className="editor-caption-actions">
                <Button
                  variant="ghost"
                  iconOnly
                  leadingIcon={Pencil}
                  aria-label={`Edit caption ${c.text.slice(0, 40)}`}
                  disabled={busy}
                  onClick={() => setEditingId(c.id)}
                />
                <Button
                  variant="ghost"
                  iconOnly
                  leadingIcon={Trash2}
                  aria-label={`Remove caption ${c.text.slice(0, 40)}`}
                  disabled={busy}
                  onClick={() => {
                    void runtime.controller
                      .dispatchForProject(project.id, {
                        kind: "remove-caption",
                        id: c.id,
                      })
                      .then(() => {
                        if (editingId === c.id) setEditingId("");
                      })
                      .catch(report);
                  }}
                />
              </div>
            </li>
          ))}
        </ol>
        {captions.length > 50 && (
          <div className="row editor-caption-pagination">
            <Button
              variant="secondary"
              disabled={!page}
              onClick={() => setPageNumber(page - 1)}
            >
              Previous captions
            </Button>
            <span>
              Page {page + 1} of {Math.ceil(captions.length / 50)}
            </span>
            <Button
              variant="secondary"
              disabled={(page + 1) * 50 >= captions.length}
              onClick={() => setPageNumber(page + 1)}
            >
              Next captions
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
function CaptionForm({
  source,
  selected,
  caption,
  save,
  cancel,
  report,
}: {
  source: LocalSource;
  selected: EditorClip;
  caption?: SourceCaption;
  save: (values: {
    inUs: number;
    outUs: number;
    text: string;
  }) => Promise<void>;
  cancel: () => void;
  report: (error: unknown) => void;
}) {
  const [busy, setBusy] = useState(false),
    [reset, setReset] = useState(0);
  return (
    <form
      className="editor-caption-form"
      key={reset}
      aria-label={caption ? "Edit source caption" : "Add source caption"}
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        const values = {
          inUs: Math.round(Number(data.get("start")) * 1_000_000),
          outUs: Math.round(Number(data.get("end")) * 1_000_000),
          text: String(data.get("text")).trim(),
        };
        if (!values.text || values.outUs <= values.inUs) {
          report(
            new Error(
              "Enter a readable caption and an end time after its start.",
            ),
          );
          return;
        }
        setBusy(true);
        void save(values)
          .then(() => setReset((v) => v + 1))
          .catch(report)
          .finally(() => setBusy(false));
      }}
    >
      <label className="field">
        Source start (seconds)
        <input
          name="start"
          type="number"
          min="0"
          max={source.durationUs / 1_000_000}
          step="0.000001"
          defaultValue={(caption?.inUs ?? selected.inUs) / 1_000_000}
          required
          disabled={busy}
        />
      </label>
      <label className="field">
        Source end (seconds)
        <input
          name="end"
          type="number"
          min="0.000001"
          max={source.durationUs / 1_000_000}
          step="0.000001"
          defaultValue={(caption?.outUs ?? selected.outUs) / 1_000_000}
          required
          disabled={busy}
        />
      </label>
      <label className="field editor-caption-text">
        Caption text
        <textarea
          name="text"
          required
          maxLength={2000}
          placeholder="A short, reviewed line"
          defaultValue={caption?.text || ""}
          disabled={busy}
        />
      </label>
      <div className="editor-caption-form-actions">
        <Button
          type="submit"
          leadingIcon={caption ? Pencil : Plus}
          disabled={busy}
        >
          {busy ? "Saving…" : caption ? "Save caption" : "Add caption"}
        </Button>
        {caption && (
          <Button variant="secondary" disabled={busy} onClick={cancel}>
            Cancel edit
          </Button>
        )}
      </div>
    </form>
  );
}
