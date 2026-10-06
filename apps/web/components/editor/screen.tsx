"use client";
import "../../styles/editor.css";
import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import {
  Plus,
  Upload,
  Undo2,
  Redo2,
  Scissors,
  ArrowLeft,
  ArrowRight,
  Trash2,
  Download,
  Film,
  Clapperboard,
  FolderOpen,
} from "lucide-react";
import { Button } from "../base/buttons/button";
import { Chip } from "../base/badges/chip";
import { useApp } from "../context";
import { TimelinePreview } from "./preview";
import { CaptionPanel, downloadCaptionFile } from "./caption-panel";
import { useEditorRuntime, type EditorRuntime } from "./provider";
import {
  compileRenderPlan,
  type EditorClip,
  type EditorProject,
} from "../../../../packages/editor/project";
import type { EditCommand } from "../../../../packages/editor/journal";

export function VideoEditor() {
  const { runtime, error } = useEditorRuntime();
  if (!runtime)
    return (
      <div className="page-heading">
        <h1>Video editor</h1>
        <p role={error ? "alert" : "status"}>
          {error || "Opening your local editing workspace…"}
        </p>
      </div>
    );
  return <EditorWorkspace runtime={runtime} />;
}
function EditorWorkspace({ runtime }: { runtime: EditorRuntime }) {
  const { notify } = useApp();
  const state = useSyncExternalStore(
    runtime.controller.subscribe,
    runtime.controller.getSnapshot,
    runtime.controller.getSnapshot,
  );
  const importing = useSyncExternalStore(
    runtime.importer.subscribe,
    runtime.importer.getSnapshot,
    runtime.importer.getSnapshot,
  );
  const exporting = useSyncExternalStore(
    runtime.exporter.subscribe,
    runtime.exporter.getSnapshot,
    runtime.exporter.getSnapshot,
  );
  const [downloading, setDownloading] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const backupInput = useRef<HTMLInputElement>(null);
  function perform(promise: Promise<unknown>) {
    void promise.catch((e) => {
      if (!runtime.controller.lease.signal.aborted && e?.name !== "AbortError")
        notify(
          e instanceof Error ? e.message : "The edit could not be completed.",
        );
    });
  }
  const project = state.journal?.project;
  return (
    <section className="editor-workspace">
      <div className="page-heading">
        <div>
          <h1>Video editor</h1>
          <p>Make clips, shape the picture, and review your captions.</p>
        </div>
        <div className="row">
          <Button
            variant="secondary"
            leadingIcon={FolderOpen}
            disabled={importing.active || state.status === "saving"}
            onClick={() => backupInput.current?.click()}
          >
            Restore project
          </Button>
          <Button
            variant="secondary"
            leadingIcon={Plus}
            disabled={importing.active || state.status === "saving"}
            onClick={() =>
              perform(runtime.controller.create("Untitled project"))
            }
          >
            New project
          </Button>
          <Button
            leadingIcon={Upload}
            disabled={!project || importing.active || state.status === "saving"}
            onClick={() => fileInput.current?.click()}
          >
            Import video
          </Button>
          <Button
            leadingIcon={Clapperboard}
            disabled={
              !project?.clips.length ||
              exporting.active ||
              importing.active ||
              state.status === "saving"
            }
            onClick={() => perform(runtime.exporter.export())}
          >
            Export video
          </Button>
        </div>
      </div>
      <input
        ref={fileInput}
        type="file"
        accept="video/mp4,.mp4,.mov"
        className="editor-file-input"
        aria-label="Import local video"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) perform(runtime.importer.import(file));
        }}
      />
      <input
        ref={backupInput}
        type="file"
        accept=".mediaflock.json,application/json"
        className="editor-file-input"
        aria-label="Restore editing project backup"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file)
            perform(
              (async () => {
                if (file.size > 32 * 1024 ** 2)
                  throw new Error(
                    "Choose a project backup smaller than 32 MB.",
                  );
                const data: unknown = JSON.parse(await file.text());
                runtime.controller.lease.assertActive();
                await runtime.controller.restoreBackup(data);
              })(),
            );
        }}
      />
      <div className="editor-project-bar">
        <label>
          Editing project{" "}
          <select
            aria-label="Saved editing project"
            value={project?.id || ""}
            disabled={importing.active || !state.projects.length}
            onChange={(e) => perform(runtime.controller.open(e.target.value))}
          >
            {!state.projects.length && (
              <option value="">No saved projects</option>
            )}
            {state.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <div className="row">
          <Chip
            color={
              state.status === "error"
                ? "rose"
                : state.status === "saving"
                  ? "yellow"
                  : "lime"
            }
          >
            {state.status === "error"
              ? "Edit needs attention"
              : state.status === "saving"
                ? "Saving…"
                : "Saved locally"}
          </Chip>
          <Button
            variant="secondary"
            leadingIcon={Undo2}
            aria-label="Undo edit"
            disabled={!state.journal?.undo.length || importing.active}
            onClick={() => perform(runtime.controller.undo())}
          />
          <Button
            variant="secondary"
            leadingIcon={Redo2}
            aria-label="Redo edit"
            disabled={!state.journal?.redo.length || importing.active}
            onClick={() => perform(runtime.controller.redo())}
          />
        </div>
      </div>
      {state.error && (
        <div className="editor-alert" role="alert">
          <p>{state.error}</p>
          {project && (
            <Button
              variant="secondary"
              onClick={() => perform(runtime.controller.open(project.id))}
            >
              Reopen saved version
            </Button>
          )}
        </div>
      )}
      {importing.active && (
        <div className="editor-import-status" role="status">
          <div>
            <strong>{importing.name}</strong>
            <p>
              {importing.phase === "inspecting"
                ? "Checking video format…"
                : importing.phase === "waiting"
                  ? "Waiting for other local imports or exports…"
                  : importing.phase === "copying"
                    ? "Saving a local copy…"
                    : "Verifying the local copy…"}
            </p>
            <progress
              max={Math.max(1, importing.total)}
              value={importing.phase === "inspecting" ? 0 : importing.completed}
            />
          </div>
          <Button variant="secondary" onClick={() => runtime.importer.cancel()}>
            Cancel import
          </Button>
        </div>
      )}
      {importing.error && (
        <p role="alert" className="editor-error">
          {importing.error}
        </p>
      )}
      {exporting.active && (
        <div className="editor-import-status" role="status">
          <div>
            <strong>Exporting your saved edit</strong>
            <p>
              {exporting.cancelling
                ? "Cancelling export…"
                : exporting.waiting
                  ? "Checking space and waiting for other local imports or exports…"
                  : exporting.progress?.phase === "preparing"
                    ? "Preparing video and sound…"
                    : exporting.progress?.phase === "rendering"
                      ? "Rendering picture and captions…"
                      : exporting.progress?.phase === "finalizing"
                        ? "Finishing the video file…"
                        : "Checking the finished video…"}
            </p>
            <progress
              max={Math.max(1, exporting.progress?.total || 1)}
              value={exporting.progress?.completed || 0}
            />
          </div>
          <Button
            variant="secondary"
            disabled={!exporting.canCancel}
            onClick={() => runtime.exporter.cancel()}
          >
            Cancel export
          </Button>
        </div>
      )}
      {exporting.error && (
        <p className="editor-error" role="alert">
          {exporting.error}
        </p>
      )}
      {exporting.cleanupWarning && (
        <p className="editor-error" role="status">
          {exporting.cleanupWarning}
        </p>
      )}
      {project ? (
        <ProjectCanvas
          key={project.id}
          runtime={runtime}
          project={project}
          perform={perform}
        />
      ) : (
        <div className="editor-empty">
          <Film size={36} />
          <h2>Your next cut starts here.</h2>
          <p>
            Create a project, then choose a video from this computer. Original
            files stay on your computer.
          </p>
          <Button
            leadingIcon={Plus}
            onClick={() =>
              perform(runtime.controller.create("Untitled project"))
            }
          >
            Create editing project
          </Button>
        </div>
      )}
      {exporting.jobs.length > 0 && (
        <section className="panel editor-export-panel">
          <div className="panel-head">
            <h2>Saved exports</h2>
            <Chip variant="caption" color="blue">
              {exporting.jobs.length}
            </Chip>
          </div>
          <div className="panel-body">
            {exporting.jobs.map((job) => (
              <div className="editor-export-row" key={job.id}>
                <div>
                  <strong>{job.project.name}</strong>
                  <p>
                    {new Date(job.createdAt).toLocaleString()} ·{" "}
                    {job.project.output.width} × {job.project.output.height}
                  </p>
                  {project?.id === job.project.id &&
                    project.editSequence !== job.project.editSequence && (
                      <p>Exported from an earlier edit.</p>
                    )}
                  {job.error && <p className="editor-error">{job.error}</p>}
                </div>
                <Chip
                  variant="caption"
                  color={
                    job.phase === "complete"
                      ? "lime"
                      : job.phase === "failed"
                        ? "rose"
                        : "yellow"
                  }
                >
                  {job.phase === "complete"
                    ? "Ready"
                    : job.phase === "interrupted"
                      ? "Interrupted"
                      : job.phase === "cancelled"
                        ? "Cancelled"
                        : job.phase === "failed"
                          ? "Failed"
                          : "In progress"}
                </Chip>
                {job.phase === "complete" && (
                  <Button
                    variant="secondary"
                    leadingIcon={Download}
                    disabled={downloading !== null}
                    aria-busy={downloading === job.id}
                    onClick={() => {
                      setDownloading(job.id);
                      void runtime.exporter
                        .finishedFile(job.id)
                        .then((file) => {
                          if (runtime.controller.lease.signal.aborted) return;
                          const url = URL.createObjectURL(file),
                            link = document.createElement("a");
                          link.href = url;
                          link.download = `${job.project.name.replace(/[^\p{L}\p{N}_-]/gu, "_") || "MediaFlock"}-${job.id.slice(0, 8)}.mp4`;
                          link.click();
                          setTimeout(() => URL.revokeObjectURL(url), 1000);
                        })
                        .catch((e) => {
                          if (!runtime.controller.lease.signal.aborted)
                            notify(
                              e instanceof Error
                                ? e.message
                                : "The saved export could not be downloaded.",
                            );
                        })
                        .finally(() => setDownloading(null));
                    }}
                  >
                    {downloading === job.id
                      ? "Checking file…"
                      : "Download video"}
                  </Button>
                )}
                {job.phase === "complete" &&
                  job.project.captions.length > 0 && (
                    <Button
                      variant="secondary"
                      leadingIcon={Download}
                      onClick={() => {
                        try {
                          runtime.controller.lease.assertActive();
                          downloadCaptionFile(
                            job.project,
                            `${job.project.name}-${job.id.slice(0, 8)}`,
                          );
                        } catch (error) {
                          notify(
                            error instanceof Error
                              ? error.message
                              : "The captions could not be downloaded.",
                          );
                        }
                      }}
                    >
                      Download captions
                    </Button>
                  )}
              </div>
            ))}
          </div>
        </section>
      )}
      <p className="tiny muted">
        <a href="/licenses/editor/index.html" target="_blank" rel="noreferrer">
          Open source licenses
        </a>
      </p>
    </section>
  );
}
function ProjectCanvas({
  runtime,
  project,
  perform,
}: {
  runtime: EditorRuntime;
  project: EditorProject;
  perform: (p: Promise<unknown>) => void;
}) {
  const [selectedId, setSelectedId] = useState("");
  const [seekRequest, setSeekRequest] = useState({ clipId: "", serial: 0 });
  const [sourceRevision, setSourceRevision] = useState(0);
  const restoreInput = useRef<HTMLInputElement>(null),
    restoreId = useRef("");
  const importing = useSyncExternalStore(
    runtime.importer.subscribe,
    runtime.importer.getSnapshot,
    runtime.importer.getSnapshot,
  );
  const sourceTime = useRef(0);
  const onTime = useCallback((clipId: string, us: number) => {
    sourceTime.current = us;
    setSelectedId(clipId);
  }, []);
  const selected =
    project.clips.find((c) => c.id === selectedId) || project.clips[0];
  const source = project.sources.find((s) => s.id === selected?.sourceId);
  function dispatch(command: EditCommand) {
    perform(runtime.controller.dispatch(command));
  }
  let duration = 0,
    quantized = 0,
    timelineError = "";
  try {
    if (project.clips.length) {
      const plan = compileRenderPlan(project);
      duration = plan.durationUs;
      quantized = plan.clips.reduce((n, c) => n + c.trimmedUs, 0);
    }
  } catch (e) {
    timelineError = e instanceof Error ? e.message : "The timeline is invalid.";
  }
  function downloadProject() {
    const blob = new Blob(
      [JSON.stringify(runtime.controller.getSnapshot().journal, null, 2)],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob),
      link = document.createElement("a");
    link.href = url;
    link.download = `${project.name.replace(/[^\p{L}\p{N}_-]/gu, "_") || "MediaFlock"}.mediaflock.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <>
      <input
        ref={restoreInput}
        type="file"
        accept="video/mp4,.mp4,.mov"
        className="editor-file-input"
        aria-label="Restore original source video"
        onChange={(e) => {
          const file = e.target.files?.[0],
            id = restoreId.current;
          e.target.value = "";
          if (file && id)
            perform(
              runtime.importer
                .restore(file, id)
                .then(() => setSourceRevision((v) => v + 1)),
            );
        }}
      />
      <div className="editor-layout">
        <aside className="editor-source-panel panel">
          <div className="panel-head">
            <h2>Source videos</h2>
            <Chip variant="caption" color="blue">
              {project.sources.length}
            </Chip>
          </div>
          <div className="panel-body">
            {!project.sources.length ? (
              <p className="muted">Import a video to begin.</p>
            ) : (
              project.sources.map((s) => (
                <div className="editor-source" key={s.id}>
                  <Film size={22} />
                  <div>
                    <strong title={s.name}>{s.name}</strong>
                    <span>
                      {(s.durationUs / 60_000_000).toFixed(1)} min · {s.width} ×{" "}
                      {s.height}
                    </span>
                  </div>
                  <Button
                    size="small"
                    variant="secondary"
                    leadingIcon={Plus}
                    aria-label={`Add ${s.name} to timeline`}
                    onClick={() => {
                      const id = crypto.randomUUID();
                      setSelectedId(id);
                      dispatch({
                        kind: "add-clip",
                        index: project.clips.length,
                        clip: {
                          id,
                          sourceId: s.id,
                          inUs: 0,
                          outUs: s.durationUs,
                          muted: false,
                          effects: {
                            brightness: 1,
                            contrast: 1,
                            saturation: 1,
                            look: "original",
                          },
                        },
                      });
                    }}
                  >
                    Add clip
                  </Button>
                  <Button
                    size="small"
                    variant="ghost"
                    leadingIcon={FolderOpen}
                    aria-label={`Restore original ${s.name}`}
                    disabled={importing.active}
                    onClick={() => {
                      restoreId.current = s.id;
                      restoreInput.current?.click();
                    }}
                  >
                    Restore source
                  </Button>
                </div>
              ))
            )}
          </div>
          <p className="editor-storage-note">
            Sources and edits are saved in this browser on this computer.
            Download project backups before clearing browser data.
          </p>
        </aside>
        <section className="editor-picture-panel panel">
          <div className="panel-head">
            <h2>Timeline preview</h2>
            <Chip variant="caption" color="purple">
              {project.output.width} × {project.output.height}
            </Chip>
          </div>
          {selected && source && !timelineError ? (
            <TimelinePreview
              key={`${project.id}:${project.editSequence}:${sourceRevision}`}
              runtime={runtime}
              project={project}
              initialClipId={selected.id}
              seekRequest={seekRequest}
              onTime={onTime}
            />
          ) : (
            <div className="editor-preview-empty">
              <Film size={40} />
              <p role={timelineError ? "alert" : undefined}>
                {timelineError || "Add a source video to your timeline."}
              </p>
            </div>
          )}
        </section>
        <aside className="editor-inspector panel">
          <div className="panel-head">
            <h2>Picture & sound</h2>
          </div>
          <div className="panel-body">
            <form
              className="field"
              key={`name-${project.editSequence}`}
              onSubmit={(e) => {
                e.preventDefault();
                dispatch({
                  kind: "rename",
                  name: String(new FormData(e.currentTarget).get("name")),
                });
              }}
            >
              <label htmlFor="editing-name">Project name</label>
              <input
                id="editing-name"
                name="name"
                defaultValue={project.name}
                required
                maxLength={200}
              />
              <Button variant="secondary" size="small" type="submit">
                Rename project
              </Button>
            </form>
            <label className="field">
              Output shape
              <select
                aria-label="Output shape"
                value={`${project.output.width}x${project.output.height}`}
                onChange={(e) => {
                  const [width, height] = e.target.value
                    .split("x")
                    .map(Number) as [720 | 1080 | 1920, 720 | 1080 | 1920];
                  dispatch({
                    kind: "set-output",
                    output: { ...project.output, width, height },
                  });
                }}
              >
                <option value="1080x1920">Vertical · 9:16</option>
                <option value="1920x1080">Landscape · 16:9</option>
                <option value="1080x1080">Square · 1:1</option>
              </select>
            </label>
            <label className="field">
              Picture fit
              <select
                aria-label="Picture fit"
                value={project.output.fit}
                onChange={(e) =>
                  dispatch({
                    kind: "set-output",
                    output: {
                      ...project.output,
                      fit: e.target.value as "cover" | "contain",
                    },
                  })
                }
              >
                <option value="cover">Fill frame</option>
                <option value="contain">Fit entire picture</option>
              </select>
            </label>
            {selected && (
              <ClipInspector
                key={selected.id + ":" + project.editSequence}
                clip={selected}
                sourceDuration={source?.durationUs || 0}
                dispatch={dispatch}
              />
            )}
          </div>
        </aside>
      </div>
      <section className="panel editor-timeline">
        <div className="panel-head">
          <div>
            <h2>Timeline</h2>
            <p>
              {project.clips.length}{" "}
              {project.clips.length === 1 ? "clip" : "clips"} ·{" "}
              {(duration / 1_000_000).toFixed(2)} seconds
            </p>
          </div>
          <div className="row">
            <Button
              variant="secondary"
              leadingIcon={Scissors}
              disabled={!selected}
              onClick={() => {
                if (!selected) return;
                dispatch({
                  kind: "split-clip",
                  id: selected.id,
                  rightId: crypto.randomUUID(),
                  atUs: sourceTime.current,
                });
              }}
            >
              Split at playhead
            </Button>
            <Button
              variant="secondary"
              leadingIcon={Download}
              onClick={downloadProject}
            >
              Project backup
            </Button>
          </div>
        </div>
        {timelineError && (
          <p role="alert" className="editor-error">
            {timelineError}
          </p>
        )}
        {quantized > 0 && (
          <p className="editor-storage-note">
            Clip ends align to output frames. A total of{" "}
            {(quantized / 1000).toFixed(2)} ms of fractional tails is omitted.
          </p>
        )}
        <ol className="editor-clips">
          {project.clips.map((clip, n) => {
            const s = project.sources.find((s) => s.id === clip.sourceId);
            return (
              <li key={clip.id}>
                <Button
                  variant={selected?.id === clip.id ? "primary" : "secondary"}
                  contentLayout="custom"
                  className="editor-clip-card"
                  aria-pressed={selected?.id === clip.id}
                  onClick={() => {
                    setSelectedId(clip.id);
                    setSeekRequest((v) => ({
                      clipId: clip.id,
                      serial: v.serial + 1,
                    }));
                  }}
                >
                  <span className="editor-clip-number">{n + 1}</span>
                  <strong>{s?.name}</strong>
                  <span>
                    {(clip.inUs / 1_000_000).toFixed(2)}–
                    {(clip.outUs / 1_000_000).toFixed(2)}s
                  </span>
                </Button>
                <div className="row">
                  <Button
                    iconOnly
                    size="small"
                    variant="ghost"
                    leadingIcon={ArrowLeft}
                    aria-label={`Move clip ${n + 1} earlier`}
                    disabled={!n}
                    onClick={() =>
                      dispatch({ kind: "move-clip", id: clip.id, index: n - 1 })
                    }
                  />
                  <Button
                    iconOnly
                    size="small"
                    variant="ghost"
                    leadingIcon={ArrowRight}
                    aria-label={`Move clip ${n + 1} later`}
                    disabled={n === project.clips.length - 1}
                    onClick={() =>
                      dispatch({ kind: "move-clip", id: clip.id, index: n + 1 })
                    }
                  />
                  <Button
                    iconOnly
                    size="small"
                    variant="ghost"
                    leadingIcon={Trash2}
                    aria-label={`Remove clip ${n + 1}`}
                    onClick={() =>
                      dispatch({ kind: "remove-clip", id: clip.id })
                    }
                  />
                </div>
              </li>
            );
          })}
        </ol>
      </section>
      {source && selected ? (
        <CaptionPanel
          key={`${project.id}:${source.id}`}
          runtime={runtime}
          project={project}
          source={source}
          selected={selected}
        />
      ) : (
        <section className="panel editor-caption-panel">
          <div className="panel-head">
            <h2>Captions</h2>
          </div>
          <div className="panel-body">
            <p className="muted">Select a clip to add or import captions.</p>
          </div>
        </section>
      )}
    </>
  );
}
function ClipInspector({
  clip,
  sourceDuration,
  dispatch,
}: {
  clip: EditorClip;
  sourceDuration: number;
  dispatch: (c: EditCommand) => void;
}) {
  return (
    <>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          dispatch({
            kind: "trim-clip",
            id: clip.id,
            inUs: Math.round(Number(form.get("start")) * 1_000_000),
            outUs: Math.round(Number(form.get("end")) * 1_000_000),
          });
        }}
      >
        <div className="editor-trim-fields">
          <label className="field">
            In (seconds)
            <input
              name="start"
              type="number"
              min="0"
              max={sourceDuration / 1_000_000}
              step="0.000001"
              defaultValue={clip.inUs / 1_000_000}
              required
            />
          </label>
          <label className="field">
            Out (seconds)
            <input
              name="end"
              type="number"
              min="0.001"
              max={sourceDuration / 1_000_000}
              step="0.000001"
              defaultValue={clip.outUs / 1_000_000}
              required
            />
          </label>
        </div>
        <Button variant="secondary" type="submit" size="small">
          Apply trim
        </Button>
      </form>
      <label className="field">
        Look
        <select
          aria-label="Look"
          value={clip.effects.look}
          onChange={(e) =>
            dispatch({
              kind: "set-effects",
              id: clip.id,
              effects: {
                ...clip.effects,
                look: e.target.value as EditorClip["effects"]["look"],
              },
            })
          }
        >
          <option value="original">Original color</option>
          <option value="monochrome">Black & white</option>
          <option value="sepia">Sepia</option>
        </select>
      </label>
      {(["brightness", "contrast", "saturation"] as const).map((key) => (
        <label key={key} className="field">
          {key[0].toUpperCase() + key.slice(1)}
          <input
            type="number"
            min={key === "saturation" ? 0 : 0.25}
            max="2"
            step="0.05"
            defaultValue={clip.effects[key]}
            onBlur={(e) => {
              const value = Number(e.currentTarget.value);
              if (value !== clip.effects[key])
                dispatch({
                  kind: "set-effects",
                  id: clip.id,
                  effects: { ...clip.effects, [key]: value },
                });
            }}
          />
        </label>
      ))}
      <label className="editor-mute">
        <input
          type="checkbox"
          checked={clip.muted}
          onChange={(e) =>
            dispatch({
              kind: "set-muted",
              id: clip.id,
              muted: e.target.checked,
            })
          }
        />{" "}
        Mute this clip
      </label>
    </>
  );
}
