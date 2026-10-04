"use client";
import { Button } from "./base/buttons/button";
import { useSyncExternalStore, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { ThinkingOrb, type OrbState } from "thinking-orbs";
import { BorderBeam } from "border-beam";
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
export function SegmentedTabs({
  value,
  options,
  onChange,
  label = "View",
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  label?: string;
}) {
  return (
    <div className="board-segmented-tabs" role="group" aria-label={label}>
      {options.map((option) => (
        <Button
          key={option.value}
          variant={option.value === value ? "primary" : "ghost"}
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </Button>
      ))}
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
