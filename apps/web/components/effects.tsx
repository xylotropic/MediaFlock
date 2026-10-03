"use client";
import { useSyncExternalStore, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { ThinkingOrb, type OrbState } from "thinking-orbs";
import { BorderBeam } from "border-beam";
import { Liquid } from "liquid-gooey";
import { motion } from "motion/react";
const MetalFx = dynamic(() => import("metal-fx").then((m) => m.MetalFx), {
  ssr: false,
});
const reducedQuery = "(prefers-reduced-motion: reduce)";
function subscribeMotion(listener: () => void) {
  const q = window.matchMedia(reducedQuery);
  q.addEventListener("change", listener);
  return () => q.removeEventListener("change", listener);
}
export function useReducedMotion() {
  return useSyncExternalStore(
    subscribeMotion,
    () => window.matchMedia(reducedQuery).matches,
    () => true,
  );
}
export function OperationOrb({
  state = "working",
  dark = false,
}: {
  state?: OrbState;
  dark?: boolean;
}) {
  const reduced = useReducedMotion();
  return (
    <ThinkingOrb
      state={state}
      size={20}
      theme={dark ? "dark" : "light"}
      paused={reduced}
      speed={0.65}
      aria-hidden="true"
    />
  );
}
export function OperationStatus({
  label,
  state = "connecting",
}: {
  label: string;
  state?: OrbState;
}) {
  const reduced = useReducedMotion();
  return (
    <div className="operation-status" role="status" aria-label={label}>
      <ThinkingOrb state={state} size={64} paused={reduced} />
      <span className="sr-only">{label}</span>
    </div>
  );
}
export function SilverFrame({ children }: { children: ReactNode }) {
  const reduced = useReducedMotion();
  return (
    <MetalFx
      preset="silver"
      theme="light"
      strength={0.33}
      paused={reduced}
      disableGlow
      normalizeHostStyles={false}
      borderRadius={6}
      className="silver-frame"
    >
      {children}
    </MetalFx>
  );
}
export function FocusBeam({
  children,
  active = false,
  dark = false,
}: {
  children: ReactNode;
  active?: boolean;
  dark?: boolean;
}) {
  const reduced = useReducedMotion();
  return (
    <BorderBeam
      size="line"
      colorVariant="mono"
      theme={dark ? "dark" : "light"}
      staticColors
      strength={0.35}
      duration={4}
      active={active && !reduced}
      borderRadius={6}
      className="focus-beam"
    >
      {children}
    </BorderBeam>
  );
}
export function LiquidTabs({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  const reduced = useReducedMotion(),
    index = Math.max(
      0,
      options.findIndex((x) => x.value === value),
    ),
    width = 104;
  return (
    <div
      className="liquid-tabs"
      role="group"
      aria-label={label}
      style={{ width: options.length * width + 8 }}
    >
      <Liquid
        fill="#1b1b1b"
        blur={4}
        contrast={18}
        shadow="0 1px 2px rgba(0,0,0,.06)"
        style={{
          width: options.length * width,
          height: 32,
          pointerEvents: "none",
          position: "absolute",
          left: 4,
          top: 4,
        }}
        aria-hidden="true"
      >
        <Liquid.Item
          effect={reduced ? "morph" : "move"}
          x={index * width}
          transition={{ duration: reduced ? 0 : 220, ease: "ease-out" }}
          move={{
            stretch: 0.035,
            trail: 0,
            wobble: 0.05,
            advanced: { force: 0, bend: 0, bendX: 0 },
          }}
        >
          <div style={{ height: 32, width, borderRadius: 5 }} />
        </Liquid.Item>
      </Liquid>
      <div className="liquid-tabs-labels">
        {options.map((option) => (
          <button
            type="button"
            key={option.value}
            aria-pressed={option.value === value}
            className={option.value === value ? "active" : ""}
            style={{ width }}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
// Aceternity's bento/card layout and animated sidebar informed these neutral, reduced-motion adaptations.
export function SurfaceMotion({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={false}
      whileHover={reduced ? undefined : { y: -2 }}
      transition={{ duration: 0.16, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}
