import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

process.env.MEDIAFLOCK_ENV_FILE ||= ".env.demo";
const { getConfig } = await import("../packages/domain/config");
const { db, closeDb } = await import("../packages/db");
const { storageAdmin } = await import("../packages/domain/auth");
const config = getConfig();
const origin = process.env.TEST_APP_ORIGIN || "http://127.0.0.1:3211";
if (
  config.mode !== "demo" ||
  !["127.0.0.1", "localhost"].includes(new URL(origin).hostname) ||
  !["127.0.0.1", "localhost"].includes(new URL(config.supabaseUrl).hostname) ||
  !["127.0.0.1", "localhost"].includes(new URL(config.databaseUrl).hostname)
)
  throw new Error(
    "Browser Auth journey is allowed only against isolated local services.",
  );
const suffix = randomUUID();
const email = `browser-auth-${suffix}@mediaflock.local`;
const oldPassword = "Browser-original-" + randomUUID();
const newPassword = "Browser-changed-" + randomUUID();
const thirdPassword = "Browser-settings-" + randomUUID();
let recoveryCode = "";
const steps: string[] = [];
const errors: string[] = [];
const failedResponses: Array<{ path: string; status: number }> = [];
const screenshots: string[] = [];
let expectedOldPasswordFailure = false;
let failure: unknown;
let cleaned = false;
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  reducedMotion: "reduce",
});
const page = await context.newPage();
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => {
  if (
    message.type() === "error" &&
    !message.text().startsWith("Failed to load resource:")
  )
    errors.push(message.text());
});
page.on("response", (response) => {
  if (response.status() < 400 || !response.url().startsWith(origin)) return;
  const path = new URL(response.url()).pathname;
  if (
    expectedOldPasswordFailure &&
    path === "/api/login" &&
    response.status() === 401
  )
    return;
  failedResponses.push({ path, status: response.status() });
});
function redact(value: unknown) {
  let text = value instanceof Error ? value.message : String(value);
  for (const secret of [oldPassword, newPassword, thirdPassword, recoveryCode])
    if (secret) text = text.replaceAll(secret, "[redacted]");
  return text.replace(
    /mf_recovery_[A-Za-z0-9_-]{43}/g,
    "[recovery code redacted]",
  );
}
async function screenshot(name: string) {
  // Never capture the recovery-code panel or the code-filled reset form.
  await mkdir("artifacts/screenshots", { recursive: true });
  const path = "artifacts/screenshots/" + name + ".png";
  await page.screenshot({ path, fullPage: true, animations: "disabled" });
  screenshots.push(path);
}
async function cleanup() {
  // Remove only this journey's empty private workspace and disposable identity.
  // Never disable table triggers globally or touch seeded/other user records.
  const row = (
    await db().query("select id,email from auth.users where email=$1", [email])
  ).rows[0];
  if (!row) {
    cleaned = true;
    return;
  }
  if (
    row.email !== email ||
    !row.email.startsWith("browser-auth-") ||
    !row.email.endsWith("@mediaflock.local")
  )
    throw new Error("Disposable Auth identity verification failed.");
  const tx = await db().connect();
  try {
    await tx.query("begin");
    const workspaceIds = (
      await tx.query(
        "select workspace_id from memberships where user_id=$1 and role='owner'",
        [row.id],
      )
    ).rows.map((member) => member.workspace_id);
    const otherMembers = (
      await tx.query(
        "select count(*)::integer as count from memberships where workspace_id=any($1::uuid[]) and user_id<>$2",
        [workspaceIds, row.id],
      )
    ).rows[0].count;
    if (otherMembers) throw new Error("Refusing to clean a shared workspace.");
    for (const table of [
      "social_accounts",
      "assets",
      "content_packages",
      "approvals",
      "publish_jobs",
      "experiments",
    ]) {
      const used = (
        await tx.query(
          `select count(*)::integer as count from ${table} where workspace_id=any($1::uuid[])`,
          [workspaceIds],
        )
      ).rows[0].count;
      if (used)
        throw new Error(
          "Refusing to clean a workspace containing unrelated content.",
        );
    }
    // This connection-only transaction permits deletion of its own immutable
    // test audit rows. SET LOCAL resets automatically when it commits/rolls back.
    await tx.query("set local session_replication_role='replica'");
    await tx.query(
      "delete from audit_events where workspace_id=any($1::uuid[])",
      [workspaceIds],
    );
    await tx.query("delete from api_tokens where user_id=$1", [row.id]);
    await tx.query("delete from account_security_state where user_id=$1", [
      row.id,
    ]);
    await tx.query("delete from account_recovery_codes where user_id=$1", [
      row.id,
    ]);
    await tx.query("delete from self_service_registrations where user_id=$1", [
      row.id,
    ]);
    await tx.query("delete from memberships where user_id=$1", [row.id]);
    await tx.query("delete from workspaces where id=any($1::uuid[])", [
      workspaceIds,
    ]);
    await tx.query("commit");
  } catch (error) {
    await tx.query("rollback");
    throw error;
  } finally {
    tx.release();
  }
  const deleted = await storageAdmin().auth.admin.deleteUser(row.id);
  if (deleted.error)
    throw new Error("Disposable local Auth identity could not be removed.");
  cleaned = true;
}

try {
  const configuration = await context.request.get(origin + "/api/config");
  expect(configuration.status()).toBe(200);
  const settings = (await configuration.json()).data;
  if (
    settings.mode !== "demo" ||
    !settings.selfSignupEnabled ||
    !settings.recoveryCodesEnabled ||
    settings.authEmailEnabled
  )
    throw new Error(
      "Enable only local self-signup and recovery-code flags before running this journey.",
    );
  await page.goto(origin + "/signup");
  await page
    .getByLabel("Name", { exact: true })
    .fill("Disposable Chrome Auth Test");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(oldPassword);
  const signup = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/signup" &&
      response.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  expect((await signup).status()).toBe(201);
  recoveryCode = (
    (await page.getByLabel("Your recovery code").textContent()) || ""
  ).trim();
  if (!/^mf_recovery_[A-Za-z0-9_-]{43}$/.test(recoveryCode))
    throw new Error("Recovery code was not issued in the expected format.");
  await expect(
    page.getByRole("button", { name: "Open MediaFlock" }),
  ).toBeDisabled();
  const persisted = await page.evaluate(
    (code) =>
      [...Object.values(localStorage), ...Object.values(sessionStorage)].some(
        (value) => value.includes(code),
      ),
    recoveryCode,
  );
  if (persisted)
    throw new Error("Recovery code was written to browser storage.");
  await page
    .getByRole("checkbox", { name: "I saved my recovery code" })
    .check();
  await page.getByRole("button", { name: "Open MediaFlock" }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  steps.push(
    "Public local signup; code shown once and save acknowledgement required",
  );
  for (const path of ["accounts", "assets", "packages", "publications"]) {
    const response = await context.request.get(origin + "/api/v1/" + path);
    expect(response.status()).toBe(200);
    expect((await response.json()).data).toHaveLength(0);
  }
  steps.push("New workspace contains no accounts, media or posts");
  await page.goto(origin + "/app?screen=settings");
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Password for recovery code", { exact: true })
    .fill(oldPassword);
  const rotation = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/auth/recovery-code/generate" &&
      response.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Create recovery code", exact: true })
    .click();
  expect((await rotation).status()).toBe(200);
  const replacement = (
    (await page.getByLabel("Your recovery code").textContent()) || ""
  ).trim();
  if (
    !/^mf_recovery_[A-Za-z0-9_-]{43}$/.test(replacement) ||
    replacement === recoveryCode
  )
    throw new Error("A new recovery code was not issued by Settings.");
  recoveryCode = replacement;
  await page
    .getByRole("button", { name: "I saved my recovery code", exact: true })
    .click();
  await expect(page.getByLabel("Your recovery code")).toHaveCount(0);
  steps.push(
    "Settings rotates the saved code with current-password proof and session CSRF",
  );
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
  await page.goto(origin + "/forgot-password");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Recovery code", { exact: true }).fill(recoveryCode);
  await page.getByLabel("New password", { exact: true }).fill(newPassword);
  const reset = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/auth/recovery-code" &&
      response.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Reset password", exact: true })
    .click();
  expect((await reset).status()).toBe(200);
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
  steps.push("Saved one-use code resets the password through local Auth");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(oldPassword);
  expectedOldPasswordFailure = true;
  const rejected = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/login" &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  expect((await rejected).status()).toBe(401);
  await expect(
    page.getByText("Email or password was not accepted.", { exact: true }),
  ).toBeVisible();
  expectedOldPasswordFailure = false;
  await screenshot("auth-old-password-rejected");
  steps.push("Old password is rejected with a clear message");
  await page.getByLabel("Password", { exact: true }).fill(newPassword);
  const accepted = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/login" &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  expect((await accepted).status()).toBe(200);
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  steps.push("New password signs in with a fresh accepted Auth session");
  await page.goto(origin + "/app?screen=settings");
  await page.getByLabel("Current password", { exact: true }).fill(newPassword);
  await page.getByLabel("New password", { exact: true }).fill(thirdPassword);
  const passwordChange = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/v1/password" &&
      response.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Change password", exact: true })
    .click();
  expect((await passwordChange).status()).toBe(200);
  const freshSession = await context.request.get(origin + "/api/session");
  expect(freshSession.status()).toBe(200);
  if (!(await freshSession.json()).data?.user)
    throw new Error(
      "Settings password change did not preserve a fresh verified session.",
    );
  expect(
    (await context.request.get(origin + "/api/v1/overview")).status(),
  ).toBe(200);
  steps.push(
    "Settings password change returns success and preserves fresh session/app reads",
  );
  await page.goto(origin + "/app");
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await screenshot("auth-journey-complete");
  expect(errors).toEqual([]);
  expect(failedResponses).toEqual([]);
} catch (error) {
  failure = error;
} finally {
  await browser.close();
  try {
    await cleanup();
  } catch (error) {
    failure ||= error;
  }
  await closeDb();
  await mkdir("artifacts/test-data", { recursive: true });
  await writeFile(
    "artifacts/test-data/browser-auth.json",
    JSON.stringify(
      {
        ok: !failure,
        browser: "Google Chrome",
        steps,
        unexpectedErrors: errors.map(redact),
        failedResponses,
        screenshots,
        disposableFixturesRemoved: cleaned,
        ...(failure ? { error: redact(failure) } : {}),
      },
      null,
      2,
    ),
  );
}
if (failure) throw new Error(redact(failure));
console.log(
  "Google Chrome Auth journey passed; disposable local fixtures removed.",
);
