import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createClient, type User } from "@supabase/supabase-js";
import { closeDb, db } from "../packages/db";
import { getConfig } from "../packages/domain/config";
import {
  cleanName,
  ensureRegisteredWorkspace,
  recoveryGrant,
  signupInput,
  validRecoveryGrant,
} from "../packages/domain/registration";

const oldSettings = {
  enabled: process.env.MEDIAFLOCK_SELF_SIGNUP_ENABLED,
  daily: process.env.MEDIAFLOCK_SIGNUP_DAILY_WORKSPACES,
  total: process.env.MEDIAFLOCK_SIGNUP_MAX_WORKSPACES,
};
async function publicUser(metadata: Record<string, unknown> = {}) {
  const config = getConfig();
  if (
    config.mode !== "demo" ||
    !["127.0.0.1", "localhost"].includes(new URL(config.supabaseUrl).hostname)
  )
    throw new Error("Registration fixtures require isolated local Auth.");
  const auth = createClient(config.supabaseUrl, config.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const result = await auth.auth.signUp({
    email: `registration-${randomUUID()}@mediaflock.local`,
    password: "Isolated-registration-2026!",
    options: { data: metadata },
  });
  if (result.error || !result.data.session)
    throw new Error(
      "Local public signup must have confirmations disabled for isolated tests.",
    );
  const verified = await auth.auth.getUser();
  if (verified.error || !verified.data.user)
    throw new Error("Local signup identity was not authenticated.");
  return verified.data.user;
}

beforeAll(() => {
  process.env.MEDIAFLOCK_SELF_SIGNUP_ENABLED = "true";
  process.env.MEDIAFLOCK_SIGNUP_DAILY_WORKSPACES = "1000";
  process.env.MEDIAFLOCK_SIGNUP_MAX_WORKSPACES = "10000";
});
afterAll(async () => {
  for (const [name, value] of [
    ["MEDIAFLOCK_SELF_SIGNUP_ENABLED", oldSettings.enabled],
    ["MEDIAFLOCK_SIGNUP_DAILY_WORKSPACES", oldSettings.daily],
    ["MEDIAFLOCK_SIGNUP_MAX_WORKSPACES", oldSettings.total],
  ]) {
    if (value === undefined) delete process.env[name!];
    else process.env[name!] = value;
  }
  await closeDb();
});

describe("Public registration boundaries", () => {
  it("normalizes identity fields and rejects passwords, metadata and timezones outside the contract", () => {
    expect(
      signupInput.parse({
        email: " Person@Example.com ",
        password: "twelve-characters!",
        name: " Ada\n   Lovelace ",
        timezone: "America/New_York",
      }),
    ).toEqual({
      email: "person@example.com",
      password: "twelve-characters!",
      name: "Ada Lovelace",
      timezone: "America/New_York",
    });
    expect(cleanName("\u0000   Grace\u007f Hopper ")).toBe("Grace Hopper");
    for (const input of [
      { email: "person@example.com", password: "too-short" },
      {
        email: "person@example.com",
        password: "long-password!",
        role: "owner",
      },
      {
        email: "person@example.com",
        password: "long-password!",
        timezone: "Invented/Timezone",
      },
    ])
      expect(signupInput.safeParse(input).success).toBe(false);
  });

  it("creates one workspace for concurrent requests and never joins another user's workspace through metadata", async () => {
    const first = await publicUser({ full_name: "First owner" });
    const firstMembership = await ensureRegisteredWorkspace(first);
    const second = await publicUser({
      full_name: "\u0001 Second\n Owner ",
      timezone: "UTC",
      workspace_id: firstMembership.workspace_id,
      role: "owner",
    });
    const memberships = await Promise.all(
      Array.from({ length: 8 }, () => ensureRegisteredWorkspace(second)),
    );
    expect(new Set(memberships.map((member) => member.workspace_id)).size).toBe(
      1,
    );
    expect(memberships[0].workspace_id).not.toBe(firstMembership.workspace_id);
    const rows = (
      await db().query(
        "select m.workspace_id,m.role,w.name,w.timezone from memberships m join workspaces w on w.id=m.workspace_id where m.user_id=$1",
        [second.id],
      )
    ).rows;
    expect(rows).toEqual([
      {
        workspace_id: memberships[0].workspace_id,
        role: "owner",
        name: "Second Owner's workspace",
        timezone: "UTC",
      },
    ]);
    expect(
      (
        await db().query(
          "select count(*)::integer as count from self_service_registrations where user_id=$1",
          [second.id],
        )
      ).rows[0].count,
    ).toBe(1);
  });

  it("rejects unconfirmed identities before allocating a workspace", async () => {
    const user = await publicUser();
    await expect(
      ensureRegisteredWorkspace({
        ...user,
        email_confirmed_at: undefined,
      } as User),
    ).rejects.toMatchObject({ code: "confirmation_required" });
    expect(
      (
        await db().query(
          "select count(*)::integer as count from memberships where user_id=$1",
          [user.id],
        )
      ).rows[0].count,
    ).toBe(0);
  });

  it("preserves existing membership when signup is disabled and refuses new allocations", async () => {
    const existingUser = await publicUser();
    const existing = await ensureRegisteredWorkspace(existingUser);
    const newUser = await publicUser();
    process.env.MEDIAFLOCK_SELF_SIGNUP_ENABLED = "false";
    try {
      expect(await ensureRegisteredWorkspace(existingUser)).toEqual(existing);
      await expect(ensureRegisteredWorkspace(newUser)).rejects.toMatchObject({
        code: "signup_unavailable",
      });
    } finally {
      process.env.MEDIAFLOCK_SELF_SIGNUP_ENABLED = "true";
    }
  });

  it("serializes quota checks so two concurrent users cannot take the final allocation", async () => {
    const users = [await publicUser(), await publicUser()];
    const baseline = (
      await db().query(
        "select count(*)::integer as count from self_service_registrations where mode='demo' and created_at>=date_trunc('day',now())",
      )
    ).rows[0].count;
    process.env.MEDIAFLOCK_SIGNUP_DAILY_WORKSPACES = String(baseline + 1);
    try {
      const results = await Promise.allSettled(
        users.map(ensureRegisteredWorkspace),
      );
      expect(
        results.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      expect(
        results
          .filter((result) => result.status === "rejected")
          .map((result) => result.reason.code),
      ).toEqual(["signup_capacity"]);
      expect(
        (
          await db().query(
            "select count(*)::integer as count from self_service_registrations where user_id=any($1::uuid[])",
            [users.map((user) => user.id)],
          )
        ).rows[0].count,
      ).toBe(1);
    } finally {
      process.env.MEDIAFLOCK_SIGNUP_DAILY_WORKSPACES = "1000";
    }
  });

  it("binds a password recovery grant to one identity and a fifteen minute expiry", () => {
    const userId = randomUUID();
    const now = Date.now();
    const grant = recoveryGrant(userId, now);
    expect(validRecoveryGrant(grant, userId, now)).toBe(true);
    expect(validRecoveryGrant(grant, randomUUID(), now)).toBe(false);
    expect(validRecoveryGrant(grant.replace(/.$/, "X"), userId, now)).toBe(
      false,
    );
    expect(validRecoveryGrant(grant, userId, now + 900_000)).toBe(false);
    expect(validRecoveryGrant(grant + ":anything", userId, now)).toBe(false);
  });
});
