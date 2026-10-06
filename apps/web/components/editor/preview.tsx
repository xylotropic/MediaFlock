"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Play, Pause, SkipBack, SkipForward, RotateCcw } from "lucide-react";
import { Button } from "../base/buttons/button";
import {
  compileRenderPlan,
  type EditorProject,
} from "../../../../packages/editor/project";
import {
  EditorPlayback,
  type PlaybackSnapshot,
} from "../../../../packages/editor/playback";
import type { EditorRuntime } from "./provider";

interface Props {
  runtime: EditorRuntime;
  project: EditorProject;
  initialClipId: string;
  seekRequest: { clipId: string; serial: number };
  onTime: (clipId: string, sourceUs: number) => void;
}
export function TimelinePreview(props: Props) {
  const [retry, setRetry] = useState(0);
  return (
    <TimelinePlayback
      key={retry}
      {...props}
      retry={() => setRetry((v) => v + 1)}
    />
  );
}
function clock(us: number) {
  const seconds = Math.floor(us / 1_000_000);
  return `${Math.floor(seconds / 60)
    .toString()
    .padStart(
      2,
      "0",
    )}:${(seconds % 60).toString().padStart(2, "0")}.${Math.floor(
    (us % 1_000_000) / 10_000,
  )
    .toString()
    .padStart(2, "0")}`;
}
function TimelinePlayback({
  runtime,
  project,
  initialClipId,
  seekRequest,
  onTime,
  retry,
}: Props & { retry: () => void }) {
  const mount = useRef<HTMLDivElement>(null),
    engine = useRef<EditorPlayback | null>(null);
  const [startClip] = useState(initialClipId);
  const initialSeekSerial = useRef(seekRequest.serial);
  const plan = useMemo(() => compileRenderPlan(project), [project]);
  const [state, setState] = useState<PlaybackSnapshot>({
    phase: "loading",
    frame: 0,
    positionUs: 0,
    clipId: "",
    sourceUs: 0,
    error: "",
    pictures: 0,
    pictureBytes: 0,
    consumed: 0,
    queuedEnd: 0,
    frontier: 0,
    clockReady: false,
  });
  useEffect(() => {
    const container = mount.current;
    if (!container) return;
    const canvas = document.createElement("canvas");
    canvas.width = project.output.width;
    canvas.height = project.output.height;
    canvas.setAttribute("aria-label", "Edited timeline preview");
    canvas.style.aspectRatio = `${project.output.width}/${project.output.height}`;
    container.append(canvas);
    const player = new EditorPlayback(
      project,
      runtime.controller.lease,
      runtime.files,
      () =>
        new Worker(new URL("./playback.worker.ts", import.meta.url), {
          type: "module",
        }),
    );
    engine.current = player;
    const unsubscribe = player.subscribe(() => {
      const value = player.getSnapshot();
      setState(value);
      if (value.clipId) onTime(value.clipId, value.sourceUs);
    });
    try {
      player.attach(
        canvas,
        player.plan.clips.find((c) => c.id === startClip)?.recordInFrame ?? 0,
      );
    } catch (error) {
      setState((v) => ({
        ...v,
        phase: "error",
        error:
          error instanceof Error
            ? error.message
            : "Timeline preview could not open.",
      }));
    }
    return () => {
      unsubscribe();
      player.close();
      canvas.remove();
      if (engine.current === player) engine.current = null;
    };
  }, [project, runtime, startClip, onTime]);
  useEffect(() => {
    if (seekRequest.serial !== initialSeekSerial.current && seekRequest.clipId)
      engine.current?.seekClip(seekRequest.clipId);
  }, [seekRequest]);
  const playing = state.phase === "playing" || state.phase === "buffering";
  const unavailable = state.phase === "error" || state.phase === "loading";
  return (
    <div
      className="editor-preview"
      data-playback-phase={state.phase}
      data-playback-cursor={state.consumed}
      data-playback-queued={state.queuedEnd}
      data-playback-frontier={state.frontier}
      data-playback-clock={state.clockReady}
    >
      <div ref={mount} className="editor-timeline-canvas" />
      {state.error && (
        <p role="alert" className="editor-error">
          {state.error}{" "}
          <Button
            size="small"
            variant="secondary"
            leadingIcon={RotateCcw}
            onClick={retry}
          >
            Reopen preview
          </Button>
        </p>
      )}
      <div className="editor-transport">
        <Button
          leadingIcon={SkipBack}
          iconOnly
          variant="secondary"
          aria-label="Previous frame"
          disabled={unavailable || state.frame === 0}
          onClick={() => engine.current?.step(-1)}
        />
        <Button
          leadingIcon={
            playing ? Pause : state.phase === "ended" ? RotateCcw : Play
          }
          variant="primary"
          disabled={unavailable}
          onClick={() => {
            if (playing) engine.current?.pause();
            else void engine.current?.play();
          }}
        >
          {playing
            ? "Pause"
            : state.phase === "ended"
              ? "Replay timeline"
              : "Play timeline"}
        </Button>
        <Button
          leadingIcon={SkipForward}
          iconOnly
          variant="secondary"
          aria-label="Next frame"
          disabled={unavailable || state.frame === plan.videoFrames - 1}
          onClick={() => engine.current?.step(1)}
        />
        <output aria-label="Timeline playback position">
          {clock(state.positionUs)} / {clock(plan.durationUs)}
        </output>
      </div>
      <input
        type="range"
        aria-label="Position in edited timeline"
        min={0}
        max={plan.videoFrames - 1}
        value={state.frame}
        step={1}
        disabled={state.phase === "error"}
        onChange={(e) => {
          void engine.current
            ?.seek(Number(e.target.value))
            .catch(() => undefined);
        }}
      />
      <p className="editor-playback-status" role="status">
        {state.phase === "loading"
          ? "Opening local video…"
          : state.phase === "buffering"
            ? "Preparing picture and sound…"
            : state.phase === "ended"
              ? "Timeline complete"
              : `Frame ${state.frame + 1} of ${plan.videoFrames}`}
      </p>
    </div>
  );
}
