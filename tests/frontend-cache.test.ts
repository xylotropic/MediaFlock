import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  AppContext,
  useLoad,
  type AppState,
  type LoadCache,
} from "../apps/web/components/context";

function cachedView(userId: string, workspaceId: string, path = "overview") {
  const loadCache: LoadCache = new Map([
    [
      JSON.stringify(["owner-a", "workspace-a", "overview"]),
      {
        data: { title: "Workspace A private draft" },
        version: 0,
        fetchedAt: Date.now(),
      },
    ],
  ]);
  const state: AppState = {
    session: { user: { id: userId }, workspaceId },
    mode: "live",
    version: 0,
    timezone: "UTC",
    loadCache,
    request: vi.fn(),
    refresh: vi.fn(),
    notify: vi.fn(),
    navigate: vi.fn(),
    selectPackage: vi.fn(),
    inspectJob: vi.fn(),
    newContent: vi.fn(),
  };
  function View() {
    const { data, loading } = useLoad(path);
    return createElement(
      "output",
      null,
      data?.title || (loading ? "Pending" : "Empty"),
    );
  }
  return renderToStaticMarkup(
    createElement(AppContext.Provider, { value: state }, createElement(View)),
  );
}

describe("Screen cache admission", () => {
  it("renders a returning screen from the owner's cached response immediately", () => {
    expect(cachedView("owner-a", "workspace-a")).toContain(
      "Workspace A private draft",
    );
  });
  it("does not render a previous owner's data after a different owner signs in", () => {
    expect(cachedView("owner-b", "workspace-a")).toBe(
      "<output>Pending</output>",
    );
  });
  it("does not render a response from another workspace", () => {
    expect(cachedView("owner-a", "workspace-b")).toBe(
      "<output>Pending</output>",
    );
  });
  it("does not substitute another screen's response while a new screen loads", () => {
    expect(cachedView("owner-a", "workspace-a", "accounts")).toBe(
      "<output>Pending</output>",
    );
  });
});
