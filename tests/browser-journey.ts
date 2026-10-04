import { chromium, expect } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const origin = process.env.TEST_APP_ORIGIN || "http://127.0.0.1:3211";
const screenshotDir = "artifacts/screenshots";
await mkdir(screenshotDir, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  reducedMotion: "reduce",
});
const page = await context.newPage();
const consoleErrors: string[] = [];
const responseErrors: { path: string; status: number }[] = [];
page.on("response", (response) => {
  const path = new URL(response.url()).pathname;
  if (
    response.status() >= 400 &&
    !(response.status() === 401 && path === "/api/session")
  )
    responseErrors.push({ path, status: response.status() });
});
page.on("pageerror", (error) => consoleErrors.push(error.message));
page.on("console", (message) => {
  if (
    message.type() === "error" &&
    !message.text().startsWith("Failed to load resource:")
  )
    consoleErrors.push(message.text());
});
const steps: string[] = [];
const screenshots: string[] = [];
const label = "Chrome journey " + new Date().toISOString();
const fileName = "journey-" + Date.now() + ".png";
const bytes = await readFile("artifacts/fixtures/original-study.png");
async function navigate(name: string) {
  if (
    await page
      .getByRole("button", { name: "Open navigation", exact: true })
      .isVisible()
  )
    await page
      .getByRole("button", { name: "Open navigation", exact: true })
      .click();
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name, exact: true })
    .click();
  await expect(
    page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("link", { name, exact: true }),
  ).toHaveAttribute("aria-current", "page");
  if (name !== "Content")
    await expect(
      page.getByRole("heading", { name, exact: true }).first(),
    ).toBeVisible();
  await expect(
    page.getByText("Loading your content…", { exact: true }),
  ).toHaveCount(0);
  if (name === "Connections")
    await expect(
      page
        .locator("article.connection-row")
        .filter({
          has: page.getByRole("heading", { name: "Supabase", exact: true }),
        })
        .getByText("Connected", { exact: true }),
    ).toBeVisible();
}
async function get(path: string) {
  const r = await context.request.get(origin + "/api/v1/" + path);
  expect(r.status()).toBe(200);
  return (await r.json()).data;
}
async function shot(name: string) {
  await page.evaluate(() => document.fonts.ready);
  const path = screenshotDir + "/" + name + ".png";
  await page.screenshot({ path, fullPage: true, animations: "disabled" });
  screenshots.push(path);
  const overflow = await page.evaluate(() => ({
    width: innerWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(overflow.document, `Page overflow in ${name}`).toBeLessThanOrEqual(
    overflow.width + 1,
  );
}
async function closeDialog() {
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
}
function localMinute() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(Date.now() - 60000));
  const p = (type: string) => parts.find((x) => x.type === type)?.value;
  return `${p("year")}-${p("month")}-${p("day")}T${p("hour")}:${p("minute")}`;
}
try {
  await page.goto(origin + "/signin");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".demo-banner")).toHaveCount(0);
  steps.push("Real local Supabase sign-in");
  await navigate("Library");
  await page.getByRole("button", { name: "Upload media", exact: true }).click();
  await page
    .getByLabel("Select media file")
    .setInputFiles({ name: fileName, mimeType: "image/png", buffer: bytes });
  await page.getByLabel("Asset tags").fill("browser-verified, original");
  await page
    .getByLabel("Asset notes")
    .fill("Original local PNG fixture; preserve bytes.");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Upload media", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 45000 });
  const assets = await get("assets");
  const asset = assets.find((x: any) => x.filename === fileName);
  expect(asset.checksum).toBe(createHash("sha256").update(bytes).digest("hex"));
  steps.push("Upload validated original into private local Storage");
  await page.getByRole("button", { name: "New content", exact: true }).click();
  await page.getByLabel("Content title").fill(label);
  await page
    .getByLabel("Source notes", { exact: true })
    .fill("Original media demonstrates a simple creative workflow.");
  await page
    .getByLabel("Creative brief")
    .fill(
      "Explain the creative process clearly. Use a practical opening and an honest call to action.",
    );
  await page
    .getByRole("dialog")
    .getByText("Tags", { exact: true })
    .first()
    .click();
  await page.getByLabel("Content tags").fill("browser-verified");
  await page.getByRole("dialog").getByLabel(fileName, { exact: false }).check();
  await page.getByRole("button", { name: "Save content", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: label, exact: true }),
  ).toBeVisible();
  steps.push("Persist content package with original media");
  await page
    .getByRole("button", { name: "Generate versions", exact: true })
    .click();
  const accountList = await get("accounts");
  const destinations = accountList
    .filter(
      (x: any) =>
        ["facebook", "linkedin"].includes(x.platform) &&
        x.status === "connected",
    )
    .slice(0, 2);
  expect(destinations).toHaveLength(2);
  for (const account of destinations) {
    await page.getByLabel("Select " + account.handle, { exact: true }).check();
    await page
      .getByLabel("Format for " + account.handle, { exact: true })
      .selectOption(account.platform === "facebook" ? "image" : "text");
  }
  await page
    .getByRole("button", { name: "Generate 2 versions", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".variant-card")).toHaveCount(2);
  await expect(page.getByText("Demo AI example", { exact: true })).toHaveCount(
    2,
  );
  steps.push("Generate two account-specific labeled demo variants");
  const first = page
    .locator(".variant-card")
    .filter({ hasText: destinations[0].handle });
  await first.getByRole("button", { name: "Edit", exact: true }).click();
  await page
    .getByLabel("Version caption")
    .fill("Browser-verified edited caption. Original media stays unchanged.");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(first.getByText("Revision 2", { exact: true })).toBeVisible();
  steps.push("Save immutable revision and verify edited content");
  for (const account of destinations) {
    const card = page
      .locator(".variant-card")
      .filter({ hasText: account.handle });
    await card
      .getByRole("button", { name: "Request approval", exact: true })
      .click();
    await page.getByLabel("Approval scheduled time").fill(localMinute());
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Request approval", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
  await shot("desktop-studio");
  await navigate("Approvals");
  for (const account of destinations) {
    const card = page
      .locator("article.panel")
      .filter({ hasText: label })
      .filter({ hasText: account.handle });
    await card
      .getByRole("button", { name: "Review post", exact: true })
      .click();
    await expect(
      page.getByRole("dialog").getByText(account.handle, { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Approve this post", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
  steps.push(
    "Human review of exact account, revision, media, visibility and time",
  );
  await page.getByRole("button", { name: /^Approved \d/ }).click();
  for (const account of destinations) {
    const card = page
      .locator("article.panel")
      .filter({ hasText: label })
      .filter({ hasText: account.handle });
    await card
      .getByRole("button", { name: "View decision", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Schedule approved post", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
  let jobs = (await get("publications")).filter((x: any) => x.title === label);
  expect(jobs).toHaveLength(2);
  expect(
    jobs.every((x: any) =>
      ["queued", "submitting", "scheduled", "processing", "published"].includes(
        x.state,
      ),
    ),
  ).toBe(true);
  steps.push("Schedule two approved destinations with durable intents");
  await navigate("Overview");
  await page
    .getByRole("button", { name: "Process queue", exact: true })
    .click();
  await expect
    .poll(
      async () => {
        jobs = (await get("publications")).filter(
          (x: any) => x.title === label,
        );
        return jobs.every((x: any) => x.state === "published");
      },
      { timeout: 45000, intervals: [1000, 2000] },
    )
    .toBe(true);
  steps.push("Run separate worker and confirm both simulated publications");
  await navigate("Calendar");
  await page.getByRole("button", { name: "List", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "List", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("button", { name: "List", exact: true }),
  ).toHaveCSS("background-image", /linear-gradient/);
  await page.getByRole("button", { name: "Month", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Month", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".calendar-month .calendar-day")).toHaveCount(42);
  await page.getByRole("button", { name: "List", exact: true }).click();
  await page.getByLabel("Calendar status filter").selectOption("all");
  await page.getByRole("button", { name: "Month", exact: true }).click();
  await page
    .locator(".calendar-entry")
    .filter({ hasText: label })
    .first()
    .click();
  await expect(page.getByRole("dialog").locator("pre").first()).toContainText(
    "simulated",
  );
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("button", { name: "List", exact: true }).click();
  const row = page.locator("tr").filter({ hasText: label }).first();
  await row.getByRole("button", { name: "Inspect", exact: true }).click();
  await expect(page.getByRole("dialog").locator("pre").first()).toContainText(
    "simulated",
  );
  await shot("desktop-publication-receipt");
  await page
    .getByRole("button", { name: "Collect demo metrics", exact: true })
    .click();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page
    .getByRole("button", { name: "Process queue", exact: true })
    .click();
  await expect
    .poll(
      async () => {
        const metrics = await get("publications/" + jobs[0].id + "/metrics");
        return metrics.length;
      },
      { timeout: 25000 },
    )
    .toBeGreaterThan(0);
  steps.push(
    "Inspect durable attempts and simulated receipt; collect labeled observations",
  );
  await navigate("Analytics");
  await expect(
    page.getByRole("heading", {
      name: "Post metrics",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Evidence", exact: true })
    .first()
    .click();
  await expect(page.getByRole("dialog")).toContainText("Provenance: simulated");
  await closeDialog();
  await page.getByLabel("Analytics measurement view").selectOption("changes");
  await expect(
    page.getByRole("columnheader", {
      name: "Net counter change",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByLabel("Analytics measurement view").selectOption("posts");
  steps.push(
    "Inspect analytics provenance, baseline evidence and period views",
  );
  // Cookie-authenticated API writes must require both origin and the bound CSRF token.
  const sessionResponse = await context.request.get(origin + "/api/session");
  const session = (await sessionResponse.json()).data;
  expect(
    (
      await context.request.post(origin + "/api/v1/packages", {
        data: { title: "CSRF denied" },
        headers: { Origin: origin },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await context.request.post(origin + "/api/v1/packages", {
        data: { title: "Origin denied" },
        headers: {
          Origin: "https://example.invalid",
          "X-MediaFlock-CSRF": session.csrf,
        },
      })
    ).status(),
  ).toBe(403);
  steps.push("Cookie write CSRF and origin rejection");
  await page.keyboard.press("Meta+k");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Tab");
  expect(
    await page.evaluate(
      () => !!document.activeElement?.closest('[role="dialog"]'),
    ),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  steps.push("Keyboard command palette, focus containment and Escape");
  await navigate("Overview");
  await page
    .getByRole("button", { name: "Collapse sidebar", exact: true })
    .click();
  await expect(page.locator("aside.sidebar")).toHaveClass(/collapsed/);
  await shot("desktop-collapsed-sidebar");
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Expand sidebar", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Expand sidebar", exact: true })
    .click();
  steps.push("Collapsible sidebar persists its layout preference");
  await expect(
    page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("link", { name: "Experiments", exact: true }),
  ).toHaveCount(0);
  await expect(
    page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("link", { name: "Activity", exact: true }),
  ).toHaveCount(0);
  const screens = [
    "Overview",
    "Content",
    "Library",
    "Approvals",
    "Calendar",
    "Analytics",
    "Accounts",
    "Connections",
    "Settings",
  ];
  for (const name of screens) {
    await navigate(name);
    await shot("desktop-" + name.toLowerCase().replaceAll(" ", "-"));
  }
  await page.setViewportSize({ width: 390, height: 844 });
  for (const name of screens) {
    await navigate(name);
    await shot("mobile-" + name.toLowerCase().replaceAll(" ", "-"));
  }
  steps.push("Nine screens at desktop and mobile sizes; no document overflow");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true }),
  ).toBeVisible();
  expect((await get("packages")).some((x: any) => x.title === label)).toBe(
    true,
  );
  const original = await context.request.get(
    origin + "/api/v1/assets/" + asset.id + "/file",
  );
  expect(
    createHash("sha256")
      .update(await original.body())
      .digest("hex"),
  ).toBe(asset.checksum);
  steps.push("Refresh persistence and original-byte checksum verification");
  expect(consoleErrors).toEqual([]);
  expect(responseErrors).toEqual([]);
  await writeFile(
    "artifacts/browser-report.json",
    JSON.stringify(
      {
        status: "passed",
        browser: "Google Chrome",
        origin,
        label,
        steps,
        screenshots,
        consoleErrors,
        responseErrors,
        verifiedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      status: "passed",
      steps: steps.length,
      screenshots: screenshots.length,
      consoleErrors: consoleErrors.length,
    }),
  );
} catch (error) {
  await page.screenshot({
    path: screenshotDir + "/failure.png",
    fullPage: true,
  });
  await writeFile(
    "artifacts/browser-report.json",
    JSON.stringify(
      {
        status: "failed",
        steps,
        consoleErrors,
        responseErrors,
        error: error instanceof Error ? error.message : "Unknown failure",
      },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await browser.close();
}
