"use client";
import { useEffect, useRef } from "react";
import styles from "./landing.module.css";

type NetEffect = { destroy: () => void };
declare global {
  interface Window {
    THREE?: unknown;
    VANTA?: { NET: (options: Record<string, unknown>) => NetEffect };
  }
}
const scripts = new Map<string, Promise<void>>();
function loadScript(src: string): Promise<void> {
  const prior = scripts.get(src);
  if (prior) return prior;
  const pending = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      script.remove();
      scripts.delete(src);
      reject(new Error("The decorative background could not load."));
    };
    document.head.appendChild(script);
  });
  scripts.set(src, pending);
  return pending;
}

/** One decorative Vanta instance, loaded only on the homepage. Its resources
 * are released when the opening section leaves view or the page unmounts. */
export function LandingBackground({ paused }: { paused: boolean }) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = container.current;
    if (!element || paused) return;
    let disposed = false,
      visible = true,
      loading = false;
    let effect: NetEffect | null = null;
    const stop = () => {
      effect?.destroy();
      effect = null;
      element.dataset.backgroundState = "fallback";
    };
    const start = async () => {
      if (disposed || !visible || loading || effect) return;
      loading = true;
      element.dataset.backgroundState = "loading";
      try {
        await loadScript("/vendor/vanta/three-r134.min.js");
        await loadScript("/vendor/vanta/vanta.net-0.5.24.min.js");
        if (disposed || !visible) return;
        const create = window.VANTA?.NET;
        if (!create || !window.THREE) return;
        effect = create({
          el: element,
          THREE: window.THREE,
          color: 0x779ed0,
          backgroundColor: 0xffffff,
          points: 6,
          maxDistance: 22,
          spacing: 24,
          showDots: false,
          mouseControls: true,
          touchControls: true,
          gyroControls: false,
          mouseCoeffX: 0.25,
          mouseCoeffY: 0.25,
          minHeight: 200,
          minWidth: 200,
          scale: 1.5,
          scaleMobile: 2,
        });
        element.dataset.backgroundState = element.querySelector("canvas")
          ? "animated"
          : "fallback";
      } catch {
        stop();
      } finally {
        loading = false;
        if (!effect) element.dataset.backgroundState = "fallback";
      }
    };
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) void start();
      else stop();
    });
    observer.observe(element);
    return () => {
      disposed = true;
      observer.disconnect();
      stop();
    };
  }, [paused]);
  return (
    <div
      ref={container}
      className={styles.heroBackground}
      aria-hidden="true"
      data-background-state="fallback"
    />
  );
}
