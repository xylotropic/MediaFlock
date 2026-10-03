"use client";
import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useState,
} from "react";
interface LoadEntry {
  data: any;
  version: number;
  fetchedAt: number;
  pending?: Promise<any>;
}
export type LoadCache = Map<string, LoadEntry>;
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
  loadCache: LoadCache;
}
export const AppContext = createContext<AppState | null>(null);
export function useApp() {
  return useContext(AppContext)!;
}
export function useLoad(path: string) {
  const { request, version, session, loadCache } = useApp();
  const key = JSON.stringify([session.user.id, session.workspaceId, path]);
  const [result, setResult] = useState(() => ({
    key,
    data: loadCache.get(key)?.data ?? null,
    error: "",
    loading: !loadCache.get(key)?.data,
  }));
  const read = useCallback(
    (force = false) => {
      const cached = loadCache.get(key);
      if (!force && cached?.version === version) {
        if (cached.pending) return cached.pending;
        if (cached.data !== null && Date.now() - cached.fetchedAt < 60000)
          return Promise.resolve(cached.data);
      }
      const entry: LoadEntry = {
        data: cached?.data ?? null,
        version,
        fetchedAt: 0,
      };
      const pending = request(path)
        .then((data) => {
          if (loadCache.get(key) === entry) {
            entry.data = data;
            entry.fetchedAt = Date.now();
          }
          return data;
        })
        .finally(() => {
          if (loadCache.get(key) === entry) entry.pending = undefined;
        });
      entry.pending = pending;
      loadCache.set(key, entry);
      return pending;
    },
    [key, loadCache, path, request, version],
  );
  const load = useCallback(async () => {
    setResult((current) => ({ ...current, loading: true }));
    try {
      setResult({ key, data: await read(true), error: "", loading: false });
    } catch (e) {
      setResult((current) => ({
        ...current,
        key,
        error: e instanceof Error ? e.message : "Could not load these items.",
        loading: false,
      }));
    }
  }, [key, read]);
  useEffect(() => {
    let cancelled = false;
    read()
      .then((data) => {
        if (!cancelled) setResult({ key, data, error: "", loading: false });
      })
      .catch((e) => {
        if (!cancelled)
          setResult({
            key,
            data: loadCache.get(key)?.data ?? null,
            error:
              e instanceof Error ? e.message : "Could not load these items.",
            loading: false,
          });
      });
    return () => {
      cancelled = true;
    };
  }, [key, loadCache, read]);
  return {
    data: result.key === key ? result.data : (loadCache.get(key)?.data ?? null),
    error: result.key === key ? result.error : "",
    loading: result.key === key ? result.loading : !loadCache.get(key)?.data,
    reload: load,
  };
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
