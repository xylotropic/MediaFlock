"use client";
import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useState,
} from "react";
export interface AppState {
  session: any;
  mode: "demo" | "live";
  version: number;
  request: (path: string, method?: string, body?: unknown) => Promise<any>;
  refresh: () => void;
  notify: (message: string) => void;
  navigate: (screen: string) => void;
  selectPackage: (id: string) => void;
  inspectJob: (id: string) => void;
  newContent: () => void;
  timezone: string;
}
export const AppContext = createContext<AppState | null>(null);
export function useApp() {
  return useContext(AppContext)!;
}
export function useLoad(path: string) {
  const { request, version } = useApp();
  const [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await request(path);
      setData(d);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load these items.");
    } finally {
      setLoading(false);
    }
  }, [path, request]);
  useEffect(() => {
    let cancelled = false;
    request(path)
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setError("");
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [path, request, version]);
  return { data, error, loading, reload: load };
}
export function useAction() {
  const { refresh, notify } = useApp();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const run = async (fn: () => Promise<any>, message?: string) => {
    setBusy(true);
    setError("");
    try {
      const value = await fn();
      refresh();
      if (message) notify(message);
      return value;
    } catch (e) {
      const text =
        e instanceof Error ? e.message : "Could not complete this action.";
      setError(text);
      throw e;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, setError, run };
}
