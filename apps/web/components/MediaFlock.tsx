"use client";
import { CreateContent } from "./create-content";
import { Button } from "./base/buttons/button";
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
  Search,
  Menu,
  RefreshCw,
  X,
  ArrowRight,
  Plus,
  Film,
} from "lucide-react";
import { OperationStatus } from "./effects";
import { AppContext, type LoadCache } from "./context";
import { Brand, Modal } from "./ui";
import { DashboardSidebar } from "./application/dashboard/dashboard-sidebar";
import {
  Overview,
  Library,
  Studio,
  Approvals,
  Calendar,
  Analytics,
  Accounts,
  SettingsPage,
  JobInspector,
} from "./screens";
import { ConnectionsPage } from "./connections";
import { AuthPanel } from "./auth-screen";
import { EditorProvider } from "./editor/provider";
import { VideoEditor } from "./editor/screen";
const navigation = [
  ["overview", "Overview", LayoutDashboard],
  ["studio", "Content", SquarePen],
  ["editor", "Video editor", Film],
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
  const [loadCache] = useState<LoadCache>(() => new Map());
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
    if (next !== screen)
      window.scrollTo({ top: 0, left: 0, behavior: "instant" });
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
  if (loading)
    return (
      <div className="app-loading">
        <OperationStatus label="Loading MediaFlock…" state="connecting" />
      </div>
    );
  if (!session)
    return (
      <AuthPanel
        ready={config?.ready}
        mode={config?.mode}
        signupEnabled={config?.selfSignupEnabled}
        emailEnabled={config?.authEmailEnabled}
        recoveryEnabled={config?.recoveryCodesEnabled}
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
    loadCache,
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
      <EditorProvider
        key={`${context.mode}:${session.user.id}:${session.workspaceId}`}
        scope={{
          backend: window.location.origin,
          environment: context.mode,
          userId: session.user.id,
          workspaceId: session.workspaceId,
        }}
      >
      <div className={"app " + (collapsed ? "sidebar-is-collapsed" : "")}>
        {menu && (
          <Button
            variant="ghost"
            contentLayout="custom"
            type="button"
            className="nav-backdrop"
            onClick={() => setMenu(false)}
            aria-label="Close navigation"
          />
        )}
        <DashboardSidebar
          collapsed={collapsed}
          mobileOpen={menu}
          selected={screen}
          items={navigation.map(([key, label, icon]) => ({
            key,
            label,
            icon,
            href: `/app?screen=${key}`,
          }))}
          brand={<Brand />}
          name={String(session.user.name || "Your account")}
          initials={initials}
          onCollapse={toggleSidebar}
          onClose={() => setMenu(false)}
          onNavigate={navigate}
          onSearch={() => setPalette(true)}
          onSignOut={() => {
            void (async () => {
              const r = await fetch("/api/logout", {
                method: "POST",
                headers: { "x-mediaflock-csrf": session.csrf },
              });
              if (r.ok) setSession(null);
              else notify("Sign-out could not be completed.");
            })();
          }}
        />
        <div className="shell">
          <header className="topbar">
            <div className="row">
              <Button
                leadingIcon={Menu}
                iconOnly
                variant="ghost"
                type="button"
                className="menu-btn w-9"
                onClick={() => setMenu(!menu)}
                aria-label="Open navigation"
                aria-expanded={menu}
              ></Button>
              <div className="breadcrumbs">
                <span>Workspace</span>
                <span>/</span>
                <strong>{title}</strong>
              </div>
            </div>
            <div className="row">
              <Button
                leadingIcon={Search}
                variant="ghost"
                contentLayout="custom"
                type="button"
                className="command-trigger"
                onClick={() => setPalette(true)}
                aria-label="Open command palette"
              >
                Search or jump to…<kbd>⌘ K</kbd>
              </Button>
              <Button
                leadingIcon={RefreshCw}
                iconOnly
                variant="ghost"
                type="button"
                className="w-9"
                aria-label="Refresh records"
                onClick={refresh}
              ></Button>
            </div>
          </header>
          <main className="main" key={screen}>
            {screen === "overview" ? (
              <Overview />
            ) : screen === "studio" ? (
              <Studio packageId={packageId} onChoose={setPackageId} />
            ) : screen === "editor" ? (
              <VideoEditor />
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
          <Button
            leadingIcon={X}
            iconOnly
            variant="ghost"
            contentLayout="custom"
            type="button"
            aria-label="Dismiss notification"
            onClick={() => setToast("")}
          ></Button>
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
              <Button
                variant="ghost"
                contentLayout="custom"
                type="button"
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
              </Button>
            ))}
          <div className="tiny muted section-space">
            Tab to move · Enter to select · Escape to close
          </div>
        </Modal>
      )}
      {packageModal && (
        <CreateContent
          onClose={() => setPackageModal(false)}
          onSaved={(id) => {
            setPackageModal(false);
            selectPackage(id);
          }}
        />
      )}
      {jobId && <JobInspector id={jobId} onClose={() => setJobId(null)} />}
      </EditorProvider>
    </AppContext.Provider>
  );
}
