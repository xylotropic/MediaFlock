"use client";

import { useEffect, useRef } from "react";
import {
  createOrbRenderer,
  type OrbDrive,
  type OrbVariant,
} from "@/components/orbs/renderer";
import type {
  ShaderOrbState,
  ShaderOrbTone,
  ShaderOrbVariant,
} from "./shader-orb";
import styles from "./shader-orb.module.css";

const variants: Record<ShaderOrbVariant, () => Promise<OrbVariant>> = {
  compose: () => import("./shaders/original-shaders").then((m) => m.composeOrb),
  process: () => import("./shaders/original-shaders").then((m) => m.processOrb),
  insights: () =>
    import("./shaders/original-shaders").then((m) => m.insightsOrb),
};

function appearance(tone: ShaderOrbTone) {
  return {
    colors: {
      body: tone === "dark" ? "#46464c" : "#77777e",
      sheen: "#f1f1f3",
    },
  };
}

export function ShaderOrbCanvas({
  variant,
  tone,
  state,
  onReady,
  onError,
}: {
  variant: ShaderOrbVariant;
  tone: ShaderOrbTone;
  state: ShaderOrbState;
  onReady: (ready: boolean) => void;
  onError: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drive = useRef<OrbDrive>({ state });

  useEffect(() => {
    const look = appearance(tone);
    drive.current = {
      ...look,
      state,
      volumes: { input: 0, output: state === "thinking" ? 0.35 : 0.06 },
    };
  }, [state, variant, tone]);

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    let cancelled = false;
    let renderer: ReturnType<typeof createOrbRenderer> | undefined;
    const startupTimeout = window.setTimeout(() => {
      if (cancelled) return;
      cancelled = true;
      renderer?.dispose();
      onError();
    }, 8000);

    async function start() {
      try {
        const source = await variants[variant]();
        if (cancelled) return;
        const look = appearance(tone);
        const selected: OrbVariant = {
          ...source,
          colors: source.colors.map((color) => ({
            ...color,
            default:
              look.colors[color.key as keyof typeof look.colors] ??
              color.default,
          })),
        };
        renderer = createOrbRenderer({
          canvas: element!,
          variant: selected,
          drive: () => drive.current,
          maxDpr: 1.25,
          pauseOffscreen: true,
          onFirstFrame: () => {
            if (cancelled) return;
            window.clearTimeout(startupTimeout);
            onReady(true);
          },
        });
        await renderer.ready;
      } catch {
        if (cancelled) return;
        window.clearTimeout(startupTimeout);
        renderer?.dispose();
        onError();
      }
    }
    void start();
    return () => {
      cancelled = true;
      window.clearTimeout(startupTimeout);
      renderer?.dispose();
      onReady(false);
    };
  }, [variant, tone, onReady, onError]);

  return <canvas ref={canvas} className={styles.canvas} aria-hidden="true" />;
}
