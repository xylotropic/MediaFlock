import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { closeDb, db, type Context } from "../packages/db";
import { getConfig } from "../packages/domain/config";
import { ensureRegisteredWorkspace } from "../packages/domain/registration";
import {
  issueInitialRecoveryCode,
  recoveryCodeHash,
  resetWithRecoveryCode,
  rotateRecoveryCode,
} from "../packages/domain/recovery-codes";

const original = {
  signup: process.env.MEDIAFLOCK_SELF_SIGNUP_ENABLED,
  codes: process.env.MEDIAFLOCK_RECOVERY_CODES_ENABLED,
  daily: process.env.MEDIAFLOCK_SIGNUP_DAILY_WORKSPACES,
  total: process.env.MEDIAFLOCK_SIGNUP_MAX_WORKSPACES,
};
const localPassword = "Isolated-recovery-2026!";
async function identity() {
  const config = getConfig();
  if (
    config.mode !== "demo" ||
    !["127.0.0.1", "localhost"].includes(new URL(config.supabaseUrl).hostname)
  )
    throw new Error("Recovery fixtures require isolated local Auth.");
  const client = createClient(config.supabaseUrl, config.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const result = await client.auth.signUp({
    email: `recovery-${randomUUID()}@mediaflock.local`,
    password: localPassword,
  });
  if (result.error || !result.data.session)
    throw new Error("Local public signup failed.");
  const verified = await client.auth.getUser();
  if (verified.error || !verified.data.user)
    throw new Error("Local Auth identity was not verified.");
  const user = verified.data.user;
  const member = await ensureRegisteredWorkspace(user);
  const ctx: Context = {
    userId: user.id,
    workspaceId: member.workspace_id,
    role: "owner",
    kind: "human",
    scopes: ["read"],
  };
  const code = await issueInitialRecoveryCode(user, member.workspace_id);
  if (!code) throw new Error("Local recovery code was not issued.");
  return { user, ctx, code };
}
async function ledger(userId: string) {
  return (
    await db().query(
      "select * from account_recovery_codes where user_id=$1 and mode='demo'",
      [userId],
    )
  ).rows[0];
}

beforeAll(() => {
  process.env.MEDIAFLOCK_SELF_SIGNUP_ENABLED = "true";
  process.env.MEDIAFLOCK_RECOVERY_CODES_ENABLED = "true";
  process.env.MEDIAFLOCK_SIGNUP_DAILY_WORKSPACES = "1000";
  process.env.MEDIAFLOCK_SIGNUP_MAX_WORKSPACES = "10000";
});
afterAll(async () => {
  for (const [name, value] of [
    ["MEDIAFLOCK_SELF_SIGNUP_ENABLED", original.signup],
    ["MEDIAFLOCK_RECOVERY_CODES_ENABLED", original.codes],
    ["MEDIAFLOCK_SIGNUP_DAILY_WORKSPACES", original.daily],
    ["MEDIAFLOCK_SIGNUP_MAX_WORKSPACES", original.total],
  ]) {
    if (value === undefined) delete process.env[name!];
    else process.env[name!] = value;
  }
  await closeDb();
});

describe("One-use recovery capabilities", () => {
  it("stores only a peppered hash and never rediscloses an initial code", async () => {
    const account = await identity();
    expect(account.code).toMatch(/^mf_recovery_[A-Za-z0-9_-]{43}$/);
    expect(
      await issueInitialRecoveryCode(account.user, account.ctx.workspaceId),
    ).toBeUndefined();
    const row = await ledger(account.user.id);
    expect(row.code_hash).toBe(recoveryCodeHash(account.code));
    expect(JSON.stringify(row)).not.toContain(account.code);
    const audit = (
      await db().query(
        "select details from audit_events where workspace_id=$1 and action like 'account_recovery.%'",
        [account.ctx.workspaceId],
      )
    ).rows;
    expect(JSON.stringify(audit)).not.toContain(account.code);
    for (const role of ["anon", "authenticated", "mediaflock_app"]) {
      const tx = await db().connect();
      try {
        await tx.query("begin");
        await tx.query(`set local role ${role}`);
        await expect(
          tx.query("select code_hash from account_recovery_codes"),
        ).rejects.toMatchObject({ code: "42501" });
      } finally {
        await tx.query("rollback");
        tx.release();
      }
    }
    const tokenReauth = vi.fn(async () => account.user);
    await expect(
      rotateRecoveryCode(
        { ...account.ctx, kind: "token" },
        account.user,
        localPassword,
        tokenReauth,
      ),
    ).rejects.toMatchObject({ code: "recovery_owner_required" });
    expect(tokenReauth).not.toHaveBeenCalled();
  });

  it("requires the current password and the same Auth identity before rotating", async () => {
    const account = await identity();
    await expect(
      rotateRecoveryCode(account.ctx, account.user, "wrong-password!"),
    ).rejects.toMatchObject({ code: "reauthentication_required" });
    await expect(
      rotateRecoveryCode(
        account.ctx,
        account.user,
        localPassword,
        async () => ({ ...account.user, id: randomUUID() }),
      ),
    ).rejects.toMatchObject({ code: "reauthentication_required" });
    expect((await ledger(account.user.id)).code_hash).toBe(
      recoveryCodeHash(account.code),
    );
    const rotated = await rotateRecoveryCode(
      account.ctx,
      account.user,
      localPassword,
    );
    expect(rotated).not.toBe(account.code);
    const provider = vi.fn(async () => "success" as const);
    await expect(
      resetWithRecoveryCode(
        {
          email: account.user.email!,
          recoveryCode: account.code,
          newPassword: "New-isolated-password!",
        },
        provider,
      ),
    ).rejects.toMatchObject({ code: "recovery_denied" });
    expect(provider).not.toHaveBeenCalled();
    expect((await ledger(account.user.id)).generation).toBe(2);
  });

  it("returns the same denial for wrong proof and unknown account without consuming the real key", async () => {
    const account = await identity();
    const provider = vi.fn(async () => "success" as const);
    const wrongCode = "mf_recovery_" + "A".repeat(43);
    for (const input of [
      {
        email: account.user.email!,
        recoveryCode: wrongCode,
        newPassword: "New-isolated-password!",
      },
      {
        email: "not-an-account@mediaflock.local",
        recoveryCode: account.code,
        newPassword: "New-isolated-password!",
      },
    ])
      await expect(
        resetWithRecoveryCode(input, provider),
      ).rejects.toMatchObject({
        code: "recovery_denied",
        status: 403,
        message: "The account details or recovery code were not accepted.",
      });
    expect(provider).not.toHaveBeenCalled();
    expect((await ledger(account.user.id)).state).toBe("active");
  });

  it("claims the code before the provider call and allows only one concurrent reset", async () => {
    const account = await identity();
    const provider = vi.fn(async (userId: string) => {
      expect(userId).toBe(account.user.id);
      expect((await ledger(userId)).state).toBe("claimed");
      await new Promise((resolve) => setTimeout(resolve, 30));
      return "success" as const;
    });
    const input = {
      email: account.user.email!,
      recoveryCode: account.code,
      newPassword: "New-isolated-password!",
    };
    const results = await Promise.allSettled([
      resetWithRecoveryCode(input, provider),
      resetWithRecoveryCode(input, provider),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results
        .filter((result) => result.status === "rejected")
        .map((result) => result.reason.code),
    ).toEqual(["recovery_denied"]);
    expect(provider).toHaveBeenCalledTimes(1);
    expect((await ledger(account.user.id)).state).toBe("spent");
    await expect(resetWithRecoveryCode(input, provider)).rejects.toMatchObject({
      code: "recovery_denied",
    });
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it("fails closed on an unknown provider outcome without retrying or minting a replacement", async () => {
    const account = await identity();
    const provider = vi.fn(async () => {
      throw new Error("Simulated lost provider response");
    });
    const input = {
      email: account.user.email!,
      recoveryCode: account.code,
      newPassword: "New-isolated-password!",
    };
    await expect(resetWithRecoveryCode(input, provider)).rejects.toMatchObject({
      code: "recovery_unresolved",
      status: 503,
    });
    expect((await ledger(account.user.id)).state).toBe("uncertain");
    await expect(resetWithRecoveryCode(input, provider)).rejects.toMatchObject({
      code: "recovery_denied",
    });
    await expect(
      rotateRecoveryCode(
        account.ctx,
        account.user,
        localPassword,
        async () => account.user,
      ),
    ).rejects.toMatchObject({ code: "recovery_unresolved" });
    expect(
      await issueInitialRecoveryCode(account.user, account.ctx.workspaceId),
    ).toBeUndefined();
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it("uses the attempt fence to prevent a stale provider result from confirming another attempt", async () => {
    const account = await identity();
    const otherAttempt = randomUUID();
    const provider = vi.fn(async () => {
      await db().query(
        "update account_recovery_codes set attempt_id=$2 where user_id=$1 and mode='demo'",
        [account.user.id, otherAttempt],
      );
      return "success" as const;
    });
    await expect(
      resetWithRecoveryCode(
        {
          email: account.user.email!,
          recoveryCode: account.code,
          newPassword: "New-isolated-password!",
        },
        provider,
      ),
    ).rejects.toMatchObject({ code: "recovery_unresolved" });
    const row = await ledger(account.user.id);
    expect(row.attempt_id).toBe(otherAttempt);
    expect(row.state).toBe("claimed");
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it("makes one bounded privileged request and never retries a lost transport response", async () => {
    const account = await identity();
    const transport = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("Simulated network response loss"));
    try {
      await expect(
        resetWithRecoveryCode({
          email: account.user.email!,
          recoveryCode: account.code,
          newPassword: "New-isolated-password!",
        }),
      ).rejects.toMatchObject({ code: "recovery_unresolved" });
      expect(transport).toHaveBeenCalledTimes(1);
      expect(transport.mock.calls[0][0]).toBe(
        getConfig().supabaseUrl + "/auth/v1/admin/users/" + account.user.id,
      );
      expect(transport.mock.calls[0][1]).toMatchObject({
        method: "PUT",
        signal: expect.any(AbortSignal),
      });
      expect((await ledger(account.user.id)).state).toBe("uncertain");
    } finally {
      transport.mockRestore();
    }
  });
});
