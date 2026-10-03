"use client";

import dynamic from "next/dynamic";
import {
  Component,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  hasOrbCanvas,
  requestOrbCanvas,
  subscribeOrbCanvases,
} from "./shader-orb-budget";
import styles from "./shader-orb.module.css";

const OrbCanvas = dynamic(
  () => import("./shader-orb-canvas").then((module) => module.ShaderOrbCanvas),
  { ssr: false, loading: () => null },
);
const motionQuery = "(prefers-reduced-motion: reduce)";
const serverFalse = () => false;
const serverTrue = () => true;
const noSubscription = () => () => {};

function subscribeMotion(listener: () => void) {
  const query = window.matchMedia(motionQuery);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}

function subscribeVisibility(listener: () => void) {
  document.addEventListener("visibilitychange", listener);
  return () => document.removeEventListener("visibilitychange", listener);
}

function canRender() {
  const connection = (
    navigator as Navigator & { connection?: { saveData?: boolean } }
  ).connection;
  return (
    window.isSecureContext &&
    typeof navigator.gpu?.requestAdapter === "function" &&
    !connection?.saveData
  );
}

class CanvasBoundary extends Component<
  { children: ReactNode; onError: () => void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onError();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export type ShaderOrbVariant = "compose" | "process" | "insights";
export type ShaderOrbTone = "light" | "dark";
export type ShaderOrbState = "idle" | "thinking";

export interface ShaderOrbProps {
  variant?: ShaderOrbVariant;
  size?: number;
  tone?: ShaderOrbTone;
  /** Leave decorative orbs idle; use thinking only during a real operation. */
  state?: ShaderOrbState;
  paused?: boolean;
  className?: string;
  style?: CSSProperties;
  /** Omit for decoration. Supply only when the image itself conveys meaning. */
  label?: string;
}

export function ShaderOrb({
  variant = "compose",
  size = 128,
  tone = "light",
  state = "idle",
  paused = false,
  className,
  style,
  label,
}: ShaderOrbProps) {
  const host = useRef<HTMLSpanElement>(null);
  const [ticket] = useState(() => Symbol("shader-orb"));
  const [visible, setVisible] = useState(false);
  const [painted, setPainted] = useState<ShaderOrbVariant | null>(null);
  const [failed, setFailed] = useState<ShaderOrbVariant | null>(null);
  const reduced = useSyncExternalStore(
    subscribeMotion,
    () => window.matchMedia(motionQuery).matches,
    serverTrue,
  );
  const pageVisible = useSyncExternalStore(
    subscribeVisibility,
    () => document.visibilityState === "visible",
    serverFalse,
  );
  const capable = useSyncExternalStore(noSubscription, canRender, serverFalse);
  const leased = useSyncExternalStore(
    subscribeOrbCanvases,
    () => hasOrbCanvas(ticket),
    serverFalse,
  );
  const eligible =
    capable &&
    visible &&
    pageVisible &&
    !reduced &&
    !paused &&
    failed !== variant;

  useEffect(() => {
    const element = host.current;
    if (!element || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => setVisible(entries.some((entry) => entry.isIntersecting)),
      { threshold: 0.05 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!eligible) return;
    return requestOrbCanvas(ticket);
  }, [eligible, ticket]);

  const onReady = useCallback(
    (ready: boolean) => setPainted(ready ? variant : null),
    [variant],
  );
  const onError = useCallback(() => setFailed(variant), [variant]);
  const pixels = Number.isFinite(size)
    ? Math.min(240, Math.max(32, size))
    : 128;
  const active = eligible && leased;

  return (
    <span
      ref={host}
      className={[styles.orb, className].filter(Boolean).join(" ")}
      style={{ width: pixels, height: pixels, ...style }}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      data-shader-orb={variant}
      data-tone={tone}
      data-rendered={active && painted === variant ? "true" : "false"}
    >
      <span className={styles.fallback} />
      {active && (
        <CanvasBoundary key={variant} onError={onError}>
          <OrbCanvas
            variant={variant}
            tone={tone}
            state={state}
            onReady={onReady}
            onError={onError}
          />
        </CanvasBoundary>
      )}
    </span>
  );
}
