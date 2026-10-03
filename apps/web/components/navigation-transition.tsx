"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { ThinkingOrb } from "thinking-orbs";
import { useReducedMotion } from "./effects";

const NavigationContext = createContext<() => void>(() => undefined);

export function useNavigationTransition() {
  return useContext(NavigationContext);
}

function NavigationOrb() {
  const reduced = useReducedMotion();
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(false), 420);
    return () => window.clearTimeout(timer);
  }, []);

  if (!visible || reduced) return null;

  return (
    <div className="navigation-orb" aria-hidden="true">
      <ThinkingOrb state="working" size={64} theme="light" speed={0.85} />
    </div>
  );
}

export function RouteTransition({ children }: { children: ReactNode }) {
  const [sequence, setSequence] = useState(0);
  const beginNavigation = useCallback(() => {
    setSequence((value) => value + 1);
  }, []);

  return (
    <NavigationContext.Provider value={beginNavigation}>
      <div className="page-transition">{children}</div>
      <NavigationOrb key={sequence} />
    </NavigationContext.Provider>
  );
}
