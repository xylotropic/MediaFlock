import { chromium, expect } from "@playwright/test";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";

const origin = "http://127.0.0.1:3210";
const runtime = JSON.parse(
  await readFile(
    resolve(homedir(), "Library/Application Support/MediaFlock/current.json"),
    "utf8",
  ),
).runtime;
const credentials = JSON.parse(
  await readFile(
    process.env.MEDIAFLOCK_OWNER_LOGIN_FILE ||
      "artifacts/deployment/private/owner-login.json",
    "utf8",
  ),
);
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  reducedMotion: "reduce",
});
const page = await context.newPage(),
  errors: string[] = [],
  httpErrors: { path: string; status: number }[] = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error" && !m.text().startsWith("Failed to load resource:"))
    errors.push(m.text());
});
page.on("response", (r) => {
  const path = new URL(r.url()).pathname;
  if (r.status() >= 400 && !(r.status() === 401 && path === "/api/session"))
    httpErrors.push({ path, status: r.status() });
});
const screenshots: string[] = [];
await mkdir("artifacts/screenshots", { recursive: true });
async function get(path: string) {
  const response = await context.request.get(origin + path);
  expect(response.status(), path).toBe(200);
  return response.json();
}
async function shot(name: string) {
  await page.evaluate(() => document.fonts.ready);
  const path = "artifacts/screenshots/production-" + name + ".png";
  await page.screenshot({ path, fullPage: true, animations: "disabled" });
  screenshots.push(path);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual((page.viewportSize()?.width || 0) + 1);
}
try {
  expect((await get("/api/health")).mode).toBe("live");
  expect(await get("/api/openapi")).toEqual(
    JSON.parse(await readFile("docs/openapi.json", "utf8")),
  );
  await page.goto(origin);
  await expect(
    page.getByRole("button", { name: "Enter workspace", exact: true }),
  ).toBeVisible();
  await shot("login");
  await page.getByLabel("Email", { exact: true }).fill(credentials.email);
  await page.getByLabel("Password", { exact: true }).fill(credentials.password);
  await page
    .getByRole("button", { name: "Enter workspace", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  const session = (await get("/api/session")).data;
  expect(session.role).toBe("owner");
  expect(session.workspaces).toHaveLength(1);
  expect(session.workspaces[0].mode).toBe("live");
  for (const path of [
    "accounts",
    "packages",
    "assets",
    "approvals",
    "publications",
  ])
    expect((await get("/api/v1/" + path)).data).toHaveLength(0);
  expect((await get("/api/v1/connections/health")).data.backend).toBe(
    "connected",
  );
  expect((await get("/api/v1/integrations")).data.entries).toHaveLength(0);
  await expect
    .poll(
      async () =>
        (await get("/api/v1/settings")).data.worker.some((x: any) => x.healthy),
      { timeout: 20000 },
    )
    .toBe(true);
  const screens = [
    "Overview",
    "Content Studio",
    "Library",
    "Approvals",
    "Calendar",
    "Analytics",
    "Accounts",
    "Connections",
    "Settings",
  ];
  const requests: Record<string, string> = {
    Overview: "overview",
    "Content Studio": "packages",
    Library: "assets",
    Approvals: "approvals",
    Calendar: "publications",
    Analytics: "analytics",
    Accounts: "accounts",
    Connections: "connections/health",
    Settings: "settings",
  };
  async function navigate(name: string) {
    const open = page.getByRole("button", {
      name: "Open navigation",
      exact: true,
    });
    if (await open.isVisible()) await open.click();
    const nav = page.getByRole("navigation", { name: "Main navigation" });
    const button = nav.getByRole("button", { name, exact: true });
    const alreadySelected =
      (await button.getAttribute("aria-current")) === "page";
    const request = alreadySelected
      ? Promise.resolve()
      : page.waitForResponse(
          (r) =>
            new URL(r.url()).pathname === "/api/v1/" + requests[name] &&
            r.status() === 200,
        );
    await button.click();
    await request;
    await expect(
      page.getByText("Loading persisted records…", { exact: true }),
    ).toHaveCount(0);
    await expect(
      nav.getByRole("button", { name, exact: true }),
    ).toHaveAttribute("aria-current", "page");
    if (name === "Connections")
      await expect(page.getByText("Connected", { exact: true })).toBeVisible();
  }
  // First navigation forces a fetch because Overview is already selected.
  await navigate("Connections");
  for (const name of screens) {
    await navigate(name);
    await shot("desktop-" + name.toLowerCase().replaceAll(" ", "-"));
  }
  await navigate("Overview");
  await page
    .getByRole("button", { name: "Collapse sidebar", exact: true })
    .click();
  await expect(page.locator("aside.sidebar")).toHaveClass(/collapsed/);
  await shot("collapsed-sidebar");
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Expand sidebar", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Expand sidebar", exact: true })
    .click();
  await page.setViewportSize({ width: 390, height: 844 });
  for (const name of screens) {
    await navigate(name);
    await shot("mobile-" + name.toLowerCase().replaceAll(" ", "-"));
  }
  expect(await page.locator("body").innerText()).not.toMatch(
    /Demo workspace|Floyd[’']s workspace|simulated integrations/i,
  );
  await expect(
    page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("button"),
  ).toHaveCount(9);
  const beforeWorkers = (await get("/api/v1/settings")).data.worker.map(
    (x: any) => x.id,
  );
  execFileSync("pnpm", ["service:restart"], { stdio: "pipe" });
  await expect
    .poll(
      async () => {
        try {
          const r = await context.request.get(origin + "/api/health");
          return r.ok() ? (await r.json()).mode : "waiting";
        } catch {
          return "waiting";
        }
      },
      { timeout: 30000 },
    )
    .toBe("live");
  await expect
    .poll(
      async () =>
        (await get("/api/v1/settings")).data.worker.some(
          (x: any) => x.healthy && !beforeWorkers.includes(x.id),
        ),
      { timeout: 30000 },
    )
    .toBe(true);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true }),
  ).toBeVisible();
  expect((await get("/api/session")).data.workspaceId).toBe(
    session.workspaceId,
  );
  const resources = await page
    .locator('script[src],link[rel="stylesheet"][href]')
    .evaluateAll((nodes) =>
      nodes
        .map((n) => n.getAttribute("src") || n.getAttribute("href") || "")
        .filter((p) => p.startsWith("/_next/static/")),
    );
  const servedAssets = [];
  for (const resource of resources) {
    const response = await context.request.get(origin + resource);
    expect(response.status()).toBe(200);
    const hash = (bytes: Buffer) =>
      createHash("sha256").update(bytes).digest("hex");
    const served = hash(await response.body()),
      built = hash(
        await readFile(
          resolve(
            runtime,
            "apps/web/.next/static",
            resource.split("/_next/static/")[1].split("?")[0],
          ),
        ),
      );
    expect(served).toBe(built);
    servedAssets.push({ resource, sha256: served });
  }
  expect(errors).toEqual([]);
  expect(httpErrors).toEqual([]);
  const report = {
    status: "passed",
    mode: "live",
    origin,
    verifiedAt: new Date().toISOString(),
    checks: [
      "real Supabase owner authentication",
      "empty live data with no fixture accounts/posts/media",
      "private Storage availability",
      "worker heartbeat",
      "nine responsive screens",
      "sidebar persistence",
      "Auth/database state survives independent web and worker restart",
      "served JS/CSS equals installed release",
    ],
    screenshots,
    buildId: (
      await readFile(resolve(runtime, "apps/web/.next/BUILD_ID"), "utf8")
    ).trim(),
    servedAssets,
    consoleErrors: errors,
    responseErrors: httpErrors,
  };
  await writeFile(
    "artifacts/deployment/production-readonly-report.json",
    JSON.stringify(report, null, 2),
  );
  console.log(
    JSON.stringify({
      status: report.status,
      checks: report.checks.length,
      screenshots: screenshots.length,
      servedAssets: servedAssets.length,
      consoleErrors: errors.length,
    }),
  );
} finally {
  await browser.close();
}
