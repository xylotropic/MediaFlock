"use client";
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  FilePenLine,
  Mic,
  Square,
  WandSparkles,
} from "lucide-react";
import { ThinkingOrb } from "thinking-orbs";
import { Button, ButtonLink } from "./base/buttons/button";
import { Modal, ErrorNote } from "./ui";
import { useApp, useLoad, useAction } from "./context";
import { useReducedMotion } from "./effects";
import {
  encodeRecording,
  RECORDING_SECONDS,
} from "../../../packages/voice/audio";
import { PackageEditor } from "./screens";

export function CreateContent({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const [mode, setMode] = useState<"choose" | "draft" | "talk">("choose");
  if (mode === "draft")
    return <PackageEditor onClose={onClose} onSaved={onSaved} />;
  if (mode === "talk")
    return (
      <TalkIdea
        onBack={() => setMode("choose")}
        onClose={onClose}
        onSaved={onSaved}
      />
    );
  return (
    <Modal title="Create content" onClose={onClose}>
      <div className="creation-choices">
        <Button
          variant="secondary"
          contentLayout="custom"
          className="creation-choice"
          onClick={() => setMode("draft")}
        >
          <FilePenLine aria-hidden size={28} />
          <strong>Create a draft</strong>
          <ArrowRight aria-hidden size={20} />
        </Button>
        <Button
          variant="secondary"
          contentLayout="custom"
          className="creation-choice"
          onClick={() => setMode("talk")}
        >
          <Mic aria-hidden size={28} />
          <strong>Just talk</strong>
          <ArrowRight aria-hidden size={20} />
        </Button>
      </div>
    </Modal>
  );
}

function TalkIdea({
  onBack,
  onClose,
  onSaved,
}: {
  onBack: () => void;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const { request, session, navigate, mode } = useApp();
  const { data: connections } = useLoad("integrations");
  const { data: subscription } = useLoad("subscriptions/chatgpt");
  const action = useAction(),
    reduced = useReducedMotion();
  const [text, setText] = useState(""),
    [original, setOriginal] = useState(""),
    [title, setTitle] = useState("");
  const [recording, setRecording] = useState(false),
    [starting, setStarting] = useState(false);
  const [audio, setAudio] = useState<Blob | null>(null);
  const [seconds, setSeconds] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [transcriptionAttempted, setTranscriptionAttempted] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null),
    stream = useRef<MediaStream | null>(null);
  const audioPlayer = useRef<HTMLAudioElement>(null);
  const alive = useRef(true),
    startedAt = useRef(0);
  const eleven = connections?.entries.find(
    (entry: any) => entry.service === "elevenlabs",
  );
  const canTranscribe = eleven?.has_key && eleven.enabled;
  const canPolish =
    mode === "demo" ||
    subscription?.profiles.some(
      (p: any) =>
        p.id === subscription.selectedId &&
        p.signedIn &&
        p.planPermission &&
        p.model &&
        !p.reconnectRequired,
    );
  const stop = () => {
    if (recorder.current?.state === "recording") recorder.current.stop();
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    setRecording(false);
  };
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (recorder.current) {
        recorder.current.onstop = null;
        recorder.current.ondataavailable = null;
        if (recorder.current.state === "recording") recorder.current.stop();
      }
      stream.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);
  useEffect(() => {
    const player = audioPlayer.current;
    if (!player || !audio) return;
    const url = URL.createObjectURL(audio);
    player.src = url;
    return () => {
      URL.revokeObjectURL(url);
      player.removeAttribute("src");
    };
  }, [audio]);
  useEffect(() => {
    if (!recording) return;
    const tick = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt.current) / 1000);
      setSeconds(Math.min(elapsed, RECORDING_SECONDS));
      if (elapsed >= RECORDING_SECONDS) {
        if (recorder.current?.state === "recording") recorder.current.stop();
        stream.current?.getTracks().forEach((track) => track.stop());
        stream.current = null;
        setRecording(false);
      }
    }, 250);
    return () => clearInterval(tick);
  }, [recording]);
  const record = async () => {
    setError("");
    setStarting(true);
    try {
      if (
        !navigator.mediaDevices?.getUserMedia ||
        typeof MediaRecorder === "undefined"
      )
        throw Error("Microphone recording is unavailable in this browser.");
      const input = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1 },
        video: false,
      });
      if (!alive.current) {
        input.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = input;
      const type = [
        "audio/webm;codecs=opus",
        "audio/ogg;codecs=opus",
        "audio/mp4",
      ].find((t) => MediaRecorder.isTypeSupported(t));
      const instance = new MediaRecorder(input, {
        ...(type ? { mimeType: type } : {}),
        audioBitsPerSecond: 64000,
      });
      const chunks: Blob[] = [];
      instance.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      instance.onstop = async () => {
        input.getTracks().forEach((track) => track.stop());
        if (!alive.current) return;
        const blob = new Blob(chunks, { type: instance.mimeType });
        setRecording(false);
        if (blob.size > 3 * 1024 * 1024) {
          setAudio(null);
          setError("This recording is too large. Record a shorter idea.");
        } else {
          setBusy(true);
          const decoder = new AudioContext({ sampleRate: 16000 });
          try {
            const decoded = await decoder.decodeAudioData(
              await blob.arrayBuffer(),
            );
            const samples = decoded.getChannelData(0);
            const pcm = encodeRecording(samples);
            if (alive.current) {
              setAudio(new Blob([new Uint8Array(pcm)], { type: "audio/wav" }));
              setTranscriptionAttempted(false);
            }
          } catch {
            if (alive.current)
              setError(
                "This recording could not be prepared. Your text is still here.",
              );
          } finally {
            await decoder.close();
            if (alive.current) setBusy(false);
          }
        }
      };
      instance.onerror = () => {
        input.getTracks().forEach((track) => track.stop());
        if (alive.current) {
          setRecording(false);
          setError("Recording stopped unexpectedly. Your text is still here.");
        }
      };
      recorder.current = instance;
      startedAt.current = Date.now();
      setSeconds(0);
      setAudio(null);
      instance.start(1000);
      setRecording(true);
    } catch (e) {
      stream.current?.getTracks().forEach((track) => track.stop());
      stream.current = null;
      if (alive.current)
        setError(
          e instanceof Error ? e.message : "Microphone access was not granted.",
        );
    } finally {
      if (alive.current) setStarting(false);
    }
  };
  const transcribe = async () => {
    if (!audio) return;
    setBusy(true);
    setError("");
    setTranscriptionAttempted(true);
    try {
      const response = await fetch("/api/voice/transcribe", {
        method: "POST",
        headers: {
          "Content-Type": audio.type,
          "x-workspace-id": session.workspaceId,
          "x-mediaflock-csrf": session.csrf,
          "x-voice-request-id": crypto.randomUUID(),
        },
        body: audio,
      });
      const result = await response.json();
      if (!response.ok)
        throw Error(
          result.error?.message ||
            "Transcription could not be completed. Your recording is still here.",
        );
      if (alive.current) {
        setText((current) =>
          [current.trim(), result.data.text].filter(Boolean).join("\n\n"),
        );
        setOriginal((current) =>
          [current.trim(), result.data.text].filter(Boolean).join("\n\n"),
        );
      }
    } catch (e) {
      if (alive.current)
        setError(e instanceof Error ? e.message : "Transcription failed.");
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const polish = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await request("ideas", "POST", { text });
      if (alive.current) {
        setOriginal((current) => current || text);
        setText(result.output.body);
        setTitle(result.output.title);
      }
    } catch (e) {
      if (alive.current)
        setError(
          e instanceof Error ? e.message : "The idea could not be polished.",
        );
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  return (
    <Modal
      title="Just talk"
      onClose={onClose}
      footer={
        <>
          <Button
            variant="secondary"
            leadingIcon={ArrowLeft}
            disabled={busy || recording || starting}
            onClick={onBack}
          >
            Back
          </Button>
          <Button
            variant="primary"
            trailingIcon={ArrowRight}
            disabled={
              !text.trim() || busy || action.busy || recording || starting
            }
            onClick={() =>
              void action
                .run(
                  () =>
                    request("packages", "POST", {
                      title: title || text.trim().split(/\n/)[0].slice(0, 120),
                      sourceNotes: original || text,
                      brief: text,
                      tags: [],
                      assetIds: [],
                    }),
                  "Draft saved.",
                )
                .then((result) => onSaved(result.id))
                .catch(() => {})
            }
          >
            {action.busy ? "Saving…" : "Save draft"}
          </Button>
        </>
      }
    >
      <div className="talk-idea stack">
        <div className="talk-microphone">
          {(recording || busy) && (
            <ThinkingOrb
              state={recording ? "listening" : "composing"}
              size={64}
              paused={reduced}
              aria-hidden
            />
          )}
          <Button
            variant={recording ? "danger" : "secondary"}
            leadingIcon={recording ? Square : Mic}
            disabled={busy || starting || action.busy}
            onClick={() => (recording ? stop() : void record())}
          >
            {recording
              ? "Stop microphone"
              : starting
                ? "Opening microphone…"
                : "Turn on microphone"}
          </Button>
          {recording && (
            <span role="status">
              Recording · {Math.floor(seconds / 60)}:
              {String(seconds % 60).padStart(2, "0")}
            </span>
          )}
        </div>
        <textarea
          aria-label="Your idea"
          placeholder="Talk it through, or type your idea…"
          value={text}
          maxLength={10000}
          disabled={busy}
          onChange={(e) => {
            setText(e.target.value);
            setTitle("");
          }}
        />
        {audio && (
          <div className="stack">
            <audio controls ref={audioPlayer} aria-label="Recorded idea" />
            {canTranscribe ? (
              <>
                <span className="tiny muted">
                  Send this recording to ElevenLabs. Uses your connected
                  account’s credits and provider retention policy.
                </span>
                <Button
                  variant="secondary"
                  disabled={busy || recording || transcriptionAttempted}
                  onClick={() => void transcribe()}
                >
                  {busy
                    ? "Transcribing…"
                    : transcriptionAttempted
                      ? "Recording submitted"
                      : "Transcribe recording"}
                </Button>
              </>
            ) : (
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  onClose();
                  navigate("connections");
                }}
              >
                Connect ElevenLabs
              </Button>
            )}
          </div>
        )}
        <div className="row wrap">
          <span className="tiny muted">
            Polishing sends this text to your connected ChatGPT account.
          </span>
          <Button
            leadingIcon={WandSparkles}
            variant="secondary"
            disabled={!text.trim() || busy || recording || !canPolish}
            onClick={() => void polish()}
          >
            {busy ? "Working…" : "Polish idea"}
          </Button>
          {!canPolish && subscription?.available === false && (
            <ButtonLink
              variant="secondary"
              href={subscription.localUrl}
              target="_blank"
              rel="noreferrer"
            >
              Use ChatGPT on this Mac
            </ButtonLink>
          )}
          {!canPolish && subscription?.available && (
            <Button
              variant="secondary"
              onClick={() => {
                onClose();
                navigate("connections");
              }}
            >
              Connect ChatGPT
            </Button>
          )}
        </div>
        {(error || action.error) && (
          <ErrorNote message={error || action.error} />
        )}
      </div>
    </Modal>
  );
}
