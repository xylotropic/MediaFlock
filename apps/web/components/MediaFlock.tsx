"use client";
import { useState, useEffect, useCallback, useSyncExternalStore } from "react";
import {
  LayoutDashboard,
  FolderOpen,
  SquarePen,
  CheckCheck,
  CalendarDays,
  ChartNoAxesCombined,
  Users,
  Settings,
  Plug,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Menu,
  RefreshCw,
  LogOut,
  X,
  ArrowRight,
  Plus,
} from "lucide-react";
import { motion, LayoutGroup } from "motion/react";
import { useReducedMotion } from "./effects";
import { AppContext } from "./context";
import { Brand, Modal, ErrorNote } from "./ui";
import {
  Overview,
  Library,
  Studio,
  Approvals,
  Calendar,
  Analytics,
  Accounts,
  SettingsPage,
  PackageEditor,
  JobInspector,
} from "./screens";
import { ConnectionsPage } from "./connections";
const navigation = [
  ["overview", "Overview", LayoutDashboard],
  ["studio", "Content Studio", SquarePen],
  ["library", "Library", FolderOpen],
  ["approvals", "Approvals", CheckCheck],
  ["calendar", "Calendar", CalendarDays],
  ["analytics", "Analytics", ChartNoAxesCombined],
  ["accounts", "Accounts", Users],
  ["connections", "Connections", Plug],
  ["settings", "Settings", Settings],
] as const;
function subscribeSidebar(callback: () => void) {
  window.addEventListener("mediaflock-sidebar", callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener("mediaflock-sidebar", callback);
    window.removeEventListener("storage", callback);
  };
}
function sidebarSnapshot() {
  try {
    return window.localStorage.getItem("mediaflock-sidebar") === "collapsed";
  } catch {
    return false;
  }
}
export function MediaFlock() {
  const collapsed = useSyncExternalStore(
    subscribeSidebar,
    sidebarSnapshot,
    () => false,
  );
  function toggleSidebar() {
    try {
      window.localStorage.setItem(
        "mediaflock-sidebar",
        collapsed ? "expanded" : "collapsed",
      );
      window.dispatchEvent(new Event("mediaflock-sidebar"));
    } catch {}
  }
  const reducedMotion = useReducedMotion();
  const [config, setConfig] = useState<any>(null),
    [session, setSession] = useState<any>(null),
    [loading, setLoading] = useState(true),
    [screen, setScreen] = useState("overview"),
    [version, setVersion] = useState(0),
    [menu, setMenu] = useState(false),
    [toast, setToast] = useState(""),
    [palette, setPalette] = useState(false),
    [search, setSearch] = useState(""),
    [packageId, setPackageId] = useState<string | null>(null),
    [packageModal, setPackageModal] = useState(false),
    [jobId, setJobId] = useState<string | null>(null);
  const notify = useCallback((message: string) => {
      setToast(message);
    }, []),
    refresh = useCallback(() => setVersion((v) => v + 1), []);
  const loadSession = useCallback(async () => {
    const response = await fetch("/api/session", { cache: "no-store" });
    const result = await response.json();
    if (response.ok) setSession(result.data);
    else setSession(null);
  }, []);
  useEffect(() => {
    fetch("/api/config", { cache: "no-store" })
      .then((r) => r.json())
      .then((r) => {
        setConfig(r.data);
        const initial = new URLSearchParams(window.location.search).get(
          "screen",
        );
        if (initial && navigation.some((x) => x[0] === initial))
          setScreen(initial);
      })
      .finally(() => loadSession().finally(() => setLoading(false)));
  }, [loadSession]);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setPalette((p) => !p);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timeout = setTimeout(() => setToast(""), 7000);
    return () => clearTimeout(timeout);
  }, [toast]);
  const request = useCallback(
    async (path: string, method = "GET", body?: unknown) => {
      const headers: Record<string, string> = {
        "x-workspace-id": session?.workspaceId || "",
      };
      if (method !== "GET") headers["x-mediaflock-csrf"] = session?.csrf || "";
      if (body !== undefined && !(body instanceof FormData))
        headers["Content-Type"] = "application/json";
      const response = await fetch("/api/v1/" + path, {
        method,
        headers,
        body:
          body === undefined
            ? undefined
            : body instanceof FormData
              ? body
              : JSON.stringify(body),
        cache: "no-store",
      });
      const result = await response.json();
      if (!response.ok) {
        if (response.status === 401) setSession(null);
        throw new Error(
          result.error?.message || "Request could not be completed.",
        );
      }
      return result.data;
    },
    [session],
  );
  const navigate = (next: string) => {
    setScreen(next);
    setMenu(false);
    const url = new URL(window.location.href);
    url.searchParams.set("screen", next);
    window.history.replaceState({}, "", url);
  };
  const selectPackage = (id: string) => {
    setPackageId(id);
    navigate("studio");
  };
  const workspace = session?.workspaces?.find(
      (x: any) => x.id === session.workspaceId,
    ),
    timezone = workspace?.timezone || "America/New_York";
  if (loading) return <div className="loading">Loading MediaFlock…</div>;
  if (!session)
    return (
      <Login
        ready={config?.ready}
        mode={config?.mode}
        onSuccess={loadSession}
      />
    );
  const context = {
    session,
    mode: config?.mode || "demo",
    version,
    request,
    refresh,
    notify,
    navigate,
    selectPackage,
    inspectJob: setJobId,
    newContent: () => setPackageModal(true),
    timezone,
  };
  const title = navigation.find((x) => x[0] === screen)?.[1] || "Overview";
  const initials = String(session.user.name || "Floyd Korzan")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((x) => x[0])
    .join("");
  return (
    <AppContext.Provider value={context}>
      <div className={"app " + (collapsed ? "sidebar-is-collapsed" : "")}>
        {menu && (
          <button
            className="nav-backdrop"
            onClick={() => setMenu(false)}
            aria-label="Close navigation"
          />
        )}
        <aside
          className={
            "sidebar " + (menu ? "open " : "") + (collapsed ? "collapsed" : "")
          }
        >
          <div className="sidebar-brand">
            <Brand />
          </div>
          <button
            className="sidebar-collapse"
            onClick={toggleSidebar}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? (
              <PanelLeftOpen size={15} />
            ) : (
              <PanelLeftClose size={15} />
            )}
          </button>
          <nav className="nav" aria-label="Main navigation">
            <LayoutGroup id="mediaflock-sidebar">
              {navigation.map(([id, label, Icon]) => (
                <button
                  key={id}
                  className={screen === id ? "selected" : ""}
                  onClick={() => navigate(id)}
                  aria-label={label}
                  title={collapsed ? label : undefined}
                  aria-current={screen === id ? "page" : undefined}
                >
                  {screen === id && (
                    <motion.span
                      className="nav-selection"
                      layoutId="sidebar-selection"
                      initial={false}
                      transition={
                        reducedMotion
                          ? { duration: 0 }
                          : {
                              type: "spring",
                              stiffness: 500,
                              damping: 42,
                              mass: 0.8,
                            }
                      }
                    />
                  )}
                  <Icon size={15} strokeWidth={1.6} />
                  <span>{label}</span>
                </button>
              ))}
            </LayoutGroup>
          </nav>
          <div className="sidebar-bottom">
            <div className="profile">
              <span className="avatar">{initials}</span>
              <div className="grow">
                <div className="tiny">{session.user.name}</div>
              </div>
              <button
                className="btn icon ghost"
                aria-label="Sign out"
                onClick={async () => {
                  const r = await fetch("/api/logout", {
                    method: "POST",
                    headers: { "x-mediaflock-csrf": session.csrf },
                  });
                  if (r.ok) setSession(null);
                  else notify("Sign-out could not be completed.");
                }}
              >
                <LogOut size={13} />
              </button>
            </div>
          </div>
        </aside>
        <div className="shell">
          <header className="topbar">
            <div className="row">
              <button
                className="btn icon ghost menu-btn"
                onClick={() => setMenu(!menu)}
                aria-label="Open navigation"
                aria-expanded={menu}
              >
                <Menu size={18} />
              </button>
              <div className="breadcrumbs">
                <span>Workspace</span>
                <span>/</span>
                <strong>{title}</strong>
              </div>
            </div>
            <div className="row">
              <button
                className="command-trigger"
                onClick={() => setPalette(true)}
                aria-label="Open command palette"
              >
                <Search size={13} />
                Search or jump to…<kbd>⌘ K</kbd>
              </button>
              <button
                className="btn icon ghost"
                aria-label="Refresh records"
                onClick={refresh}
              >
                <RefreshCw size={14} />
              </button>
            </div>
          </header>
          <main className="main">
            {screen === "overview" ? (
              <Overview />
            ) : screen === "studio" ? (
              <Studio packageId={packageId} onChoose={setPackageId} />
            ) : screen === "library" ? (
              <Library />
            ) : screen === "approvals" ? (
              <Approvals />
            ) : screen === "calendar" ? (
              <Calendar />
            ) : screen === "analytics" ? (
              <Analytics />
            ) : screen === "accounts" ? (
              <Accounts />
            ) : screen === "connections" ? (
              <ConnectionsPage />
            ) : (
              <SettingsPage />
            )}
          </main>
        </div>
      </div>
      {toast && (
        <div className="toast" role="status">
          <span>{toast}</span>
          <button
            aria-label="Dismiss notification"
            onClick={() => setToast("")}
          >
            <X size={14} />
          </button>
        </div>
      )}
      {palette && (
        <Modal
          title="Command palette"
          onClose={() => {
            setPalette(false);
            setSearch("");
          }}
        >
          <div
            className="search-input"
            style={{ maxWidth: "none", marginBottom: 14 }}
          >
            <Search size={15} />
            <input
              aria-label="Search commands"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Jump to a screen or create content…"
            />
          </div>
          {[
            { id: "new", label: "Create content package", Icon: Plus },
            ...navigation.map(([id, label, Icon]) => ({ id, label, Icon })),
          ]
            .filter((x) => x.label.toLowerCase().includes(search.toLowerCase()))
            .map(({ id, label, Icon }) => (
              <button
                key={id}
                className="palette-option"
                onClick={() => {
                  setPalette(false);
                  setSearch("");
                  if (id === "new") setPackageModal(true);
                  else navigate(id);
                }}
              >
                <Icon size={16} />
                {label}
                <ArrowRight size={12} className="ml-auto" />
              </button>
            ))}
          <div className="tiny muted section-space">
            Tab to move · Enter to select · Escape to close
          </div>
        </Modal>
      )}
      {packageModal && (
        <PackageEditor
          onClose={() => setPackageModal(false)}
          onSaved={(id) => {
            setPackageModal(false);
            selectPackage(id);
          }}
        />
      )}
      {jobId && <JobInspector id={jobId} onClose={() => setJobId(null)} />}
    </AppContext.Provider>
  );
}
function Login({
  ready,
  mode,
  onSuccess,
}: {
  ready: boolean;
  mode: string;
  onSuccess: () => Promise<void>;
}) {
  const [email, setEmail] = useState(
      mode === "demo" ? "floyd@mediaflock.local" : "",
    ),
    [password, setPassword] = useState(
      mode === "demo" ? "MediaFlock-demo-2026!" : "",
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <div className="login-page">
      <section className="login-brand">
        <Brand />
        <div>
          <div className="eyebrow">An accountable content cycle</div>
          <h1>
            Make it.
            <br />
            Approve it.
            <br />
            Learn from it.
          </h1>
          <p>
            From source material to account-specific content, traceable delivery
            and evidence for the next experiment.
          </p>
        </div>
      </section>
      <div className="login-form-wrap">
        <form
          className="login-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              const r = await fetch("/api/login", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email, password }),
              });
              const data = await r.json();
              if (!r.ok) throw new Error(data.error.message);
              await onSuccess();
            } catch (e) {
              setError(e instanceof Error ? e.message : "Sign-in failed.");
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="eyebrow" style={{ marginBottom: 15 }}>
            Workspace access
          </div>
          <h2>Sign in to MediaFlock</h2>
          <p>Use your workspace credentials.</p>
          {error && <ErrorNote message={error} />}
          <div className="stack">
            <div className="field">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <button
              className="btn primary"
              disabled={busy || !ready}
              type="submit"
            >
              {busy ? "Signing in…" : "Enter workspace"}
              <ArrowRight size={14} />
            </button>
          </div>
          {!ready && (
            <div className="note error-note section-space">
              MediaFlock is unavailable. Check the service connection and
              refresh.
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
