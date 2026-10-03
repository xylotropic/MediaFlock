import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { db, closeDb, scoped, type Context } from "../packages/db";
import { getConfig } from "../packages/domain/config";
import { createToken, tokenContext } from "../packages/domain/auth";
import {
  resetWithRecoveryCode,
  rotateRecoveryCode,
} from "../packages/domain/recovery-codes";
import {
  validateHumanSession,
  verifiedSessionId,
} from "../packages/domain/session-security";
import { delivery, fixture } from "./helpers";

const originalCodes = process.env.MEDIAFLOCK_RECOVERY_CODES_ENABLED;
async function signedIn(account: Awaited<ReturnType<typeof fixture>>) {
  const config = getConfig();
  const client = createClient(config.supabaseUrl, config.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signin = await client.auth.signInWithPassword({
    email: account.email,
    password: account.password,
  });
  if (signin.error || !signin.data.session)
    throw new Error("Isolated local signin failed.");
  const verified = await client.auth.getUser();
  if (verified.error || verified.data.user?.id !== account.ctx.userId)
    throw new Error("Isolated Auth user was not verified.");
  const sessionId = verifiedSessionId(
    signin.data.session.access_token,
    verified.data.user.id,
  );
  return {
    user: verified.data.user,
    sessionId,
    ctx: { ...account.ctx, authSessionId: sessionId } as Context,
  };
}
async function directRead(
  userId: string,
  sessionId: string,
  workspaceId: string,
) {
  const tx = await db().connect();
  try {
    await tx.query("begin");
    await tx.query("set local role authenticated");
    await tx.query(
      "select set_config('request.jwt.claims',$1,true),set_config('request.jwt.claim.sub','',true),set_config('mediaflock.server_verified','',true)",
      [JSON.stringify({ sub: userId, session_id: sessionId })],
    );
    return (
      await tx.query("select id from workspaces where id=$1", [workspaceId])
    ).rows;
  } finally {
    await tx.query("rollback");
    tx.release();
  }
}
beforeAll(() => {
  const config = getConfig();
  if (
    config.mode !== "demo" ||
    !["127.0.0.1", "localhost"].includes(
      new URL(config.databaseUrl).hostname,
    ) ||
    !["127.0.0.1", "localhost"].includes(new URL(config.supabaseUrl).hostname)
  )
    throw new Error(
      "Session security tests require isolated local Auth and database.",
    );
  process.env.MEDIAFLOCK_RECOVERY_CODES_ENABLED = "true";
});
afterAll(async () => {
  if (originalCodes === undefined)
    delete process.env.MEDIAFLOCK_RECOVERY_CODES_ENABLED;
  else process.env.MEDIAFLOCK_RECOVERY_CODES_ENABLED = originalCodes;
  await closeDb();
});

describe("Recovery session and publishing security", () => {
  it("revokes stale sessions/tokens and approval grants before the reset call while preserving unrelated and accepted delivery records", async () => {
    const account = await fixture("security-reset"),
      other = await fixture("security-unrelated");
    const old = await signedIn(account),
      otherSession = await signedIn(other);
    expect(
      await directRead(
        account.ctx.userId,
        old.sessionId,
        account.ctx.workspaceId,
      ),
    ).toHaveLength(1);
    await expect(
      validateHumanSession(db(), account.ctx.userId, otherSession.sessionId),
    ).rejects.toMatchObject({ code: "authentication_required" });
    const token = await createToken(account.ctx, {
      name: "Isolated reset token",
      scopes: ["read"],
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    });
    const oldTokenContext = await tokenContext(token.secret);
    const unrelatedToken = await createToken(other.ctx, {
      name: "Isolated unrelated token",
      scopes: ["read"],
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    });
    const queued = await delivery(account.ctx, account.account.id);
    const accepted = await delivery(account.ctx, account.account.id);
    const published = await delivery(account.ctx, account.account.id);
    const untouched = await delivery(other.ctx, other.account.id);
    await db().query(
      "update publish_jobs set state='scheduled',provider_job_id=$2,scheduling_owner='provider' where id=$1",
      [accepted.job!.id, "isolated-provider-" + randomUUID()],
    );
    await db().query(
      "update publish_jobs set state='published',published_at=now(),platform_post_id=$2 where id=$1",
      [published.job!.id, "isolated-post-" + randomUUID()],
    );
    const code = await rotateRecoveryCode(old.ctx, old.user, account.password);
    await resetWithRecoveryCode(
      {
        email: account.email,
        recoveryCode: code,
        newPassword: "Isolated-new-password-2026!",
      },
      async (userId) => {
        expect(userId).toBe(account.ctx.userId);
        await expect(tokenContext(token.secret)).rejects.toMatchObject({
          code: "invalid_token",
        });
        await expect(
          validateHumanSession(db(), account.ctx.userId, old.sessionId),
        ).rejects.toMatchObject({ code: "authentication_required" });
        expect(
          (
            await db().query(
              "select state from account_security_state where user_id=$1",
              [userId],
            )
          ).rows[0].state,
        ).toBe("resetting");
        expect(
          (
            await db().query("select status from approvals where id=$1", [
              queued.approval!.id,
            ])
          ).rows[0].status,
        ).toBe("revoked");
        return "success";
      },
    );
    await expect(
      scoped(old.ctx, async () => "unauthorized"),
    ).rejects.toMatchObject({ code: "authentication_required" });
    await expect(
      scoped(oldTokenContext, async () => "unauthorized"),
    ).rejects.toMatchObject({ code: "invalid_token" });
    expect(
      await directRead(
        account.ctx.userId,
        old.sessionId,
        account.ctx.workspaceId,
      ),
    ).toHaveLength(0);
    const jobs = (
      await db().query(
        "select id,state,cancel_requested from publish_jobs where id=any($1::uuid[])",
        [
          [
            queued.job!.id,
            accepted.job!.id,
            published.job!.id,
            untouched.job!.id,
          ],
        ],
      )
    ).rows;
    expect(jobs.find((job) => job.id === queued.job!.id)).toMatchObject({
      state: "queued",
      cancel_requested: true,
    });
    expect(jobs.find((job) => job.id === accepted.job!.id)).toMatchObject({
      state: "scheduled",
      cancel_requested: true,
    });
    expect(jobs.find((job) => job.id === published.job!.id)).toMatchObject({
      state: "published",
      cancel_requested: false,
    });
    expect(jobs.find((job) => job.id === untouched.job!.id)).toMatchObject({
      state: "queued",
      cancel_requested: false,
    });
    expect((await tokenContext(unrelatedToken.secret)).userId).toBe(
      other.ctx.userId,
    );
    expect(
      (
        await db().query("select status from approvals where id=$1", [
          untouched.approval!.id,
        ])
      ).rows[0].status,
    ).toBe("approved");
    const fresh = await signedIn(account);
    await validateHumanSession(db(), account.ctx.userId, fresh.sessionId);
    expect(
      await scoped(
        fresh.ctx,
        async (tx) =>
          (
            await tx.query("select id from workspaces where id=$1", [
              account.ctx.workspaceId,
            ])
          ).rows,
      ),
    ).toHaveLength(1);
    expect(
      await directRead(
        account.ctx.userId,
        fresh.sessionId,
        account.ctx.workspaceId,
      ),
    ).toHaveLength(1);
  });

  it("keeps uncertain recovery paused even for a newly authenticated session, without another provider write", async () => {
    const account = await fixture("security-uncertain");
    const old = await signedIn(account);
    const code = await rotateRecoveryCode(old.ctx, old.user, account.password);
    let calls = 0;
    const input = {
      email: account.email,
      recoveryCode: code,
      newPassword: "Isolated-new-password-2026!",
    };
    const provider = async () => {
      calls++;
      return "uncertain" as const;
    };
    await expect(resetWithRecoveryCode(input, provider)).rejects.toMatchObject({
      code: "recovery_unresolved",
    });
    await expect(
      scoped(old.ctx, async () => "unauthorized"),
    ).rejects.toMatchObject({ code: "authentication_required" });
    const fresh = await signedIn(account);
    await expect(
      validateHumanSession(db(), account.ctx.userId, fresh.sessionId),
    ).rejects.toMatchObject({ code: "recovery_unresolved", status: 503 });
    expect(
      await directRead(
        account.ctx.userId,
        fresh.sessionId,
        account.ctx.workspaceId,
      ),
    ).toHaveLength(0);
    await expect(resetWithRecoveryCode(input, provider)).rejects.toMatchObject({
      code: "recovery_denied",
    });
    expect(calls).toBe(1);
    expect(
      (
        await db().query(
          "select state from account_security_state where user_id=$1",
          [account.ctx.userId],
        )
      ).rows[0].state,
    ).toBe("uncertain");
  });
});
