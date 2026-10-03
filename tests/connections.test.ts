import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { db, closeDb, type Context } from "../packages/db";
import { fixture } from "./helpers";
import { getConfig } from "../packages/domain/config";
import {
  beginConnection,
  finishConnection,
  recordCapabilityReview,
} from "../packages/domain/accounts";
import {
  saveIntegration,
  checkIntegration,
  listIntegrations,
} from "../packages/domain/integrations";
import { PostForMeProvider } from "../packages/publishing/postforme";
import { createToken, tokenContext } from "../packages/domain/auth";
import * as domain from "../packages/domain";
import { claimJob, processJob } from "../apps/worker/publishing";
import { writingGuidance } from "../packages/ai/writing-guidance";
let ctx: Context;
const accountId = "fixture-" + randomUUID(),
  secondId = "fixture-" + randomUUID();
let binding = "",
  authBody: any,
  imported: any;
const response = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const account = (id: string) => ({
  id,
  platform: "x",
  external_id: binding,
  status: "connected",
  username: "@" + id,
  user_id: id,
  access_token: "fixture-native-token-never-stored",
});
const provider = new PostForMeProvider(
  async (url, init) => {
    if (url.endsWith("/auth-url")) {
      authBody = JSON.parse(String(init.body));
      binding = authBody.external_id;
      return response({
        url: "https://fixture.invalid/authorize",
        platform: authBody.platform,
      });
    }
    if (url.includes("?external_id="))
      return response({
        data: [
          account(accountId),
          account(secondId),
          { ...account("other-binding"), external_id: "not-ours" },
          { ...account("disconnected"), status: "disconnected" },
        ],
        meta: { next: null },
      });
    return response(
      account(decodeURIComponent(new URL(url).pathname.split("/").pop()!)),
    );
  },
  "fixture-provider-key",
  true,
);
beforeAll(async () => {
  if (
    getConfig().mode !== "demo" ||
    !["localhost", "127.0.0.1"].includes(
      new URL(getConfig().databaseUrl).hostname,
    )
  )
    throw new Error("Connection tests require the isolated local database.");
  const local = await fixture("live connection contracts");
  const workspace = (
    await db().query(
      "insert into workspaces(name,mode) values('Isolated live contract test','live') returning id",
    )
  ).rows[0];
  await db().query(
    "insert into memberships(workspace_id,user_id,role) values($1,$2,'owner')",
    [workspace.id, local.ctx.userId],
  );
  ctx = { ...local.ctx, workspaceId: workspace.id };
  process.env.MEDIAFLOCK_MODE = "live";
  await saveIntegration(ctx, "postforme", {
    apiKey: "fixture-provider-key",
    enabled: true,
    config: { connectionCallbackConfigured: true },
  });
});
afterAll(async () => {
  process.env.MEDIAFLOCK_MODE = "demo";
  await closeDb();
});
describe("Live connection contracts against isolated local persistence and transports", () => {
  it("supports Quickstart callbacks without an unsupported redirect override", async () => {
    const pending = await beginConnection(ctx, "x", "oauth2", provider);
    expect(authBody.permissions).toEqual(["posts", "feeds"]);
    expect(authBody.redirect_url_override).toBeUndefined();
    expect(authBody.platform_data.x.connection_type).toBe("oauth2");
    imported = await finishConnection(ctx, pending.state, provider, true);
    expect(imported.count).toBe(2);
    expect(imported.accounts.map((x: any) => x.provider_account_id)).toEqual([
      accountId,
      secondId,
    ]);
    expect(imported.accounts[0].capabilities.operations.publish).toBe(
      "unknown",
    );
    expect(JSON.stringify(imported)).not.toContain("fixture-native-token");
    const replay = await finishConnection(ctx, pending.state, provider, true);
    expect(replay.count).toBe(2);
    expect(replay.accounts[0].connection_generation).toBe(1);
  });
  it("rejects missing permission evidence and agent-authored permission grants", async () => {
    const token = await createToken(ctx, {
      name: "connection denied",
      scopes: ["read", "draft"],
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    });
    await expect(
      recordCapabilityReview(await tokenContext(token.secret), imported.id, {}),
    ).rejects.toMatchObject({ code: "credential_owner_required" });
    await expect(
      recordCapabilityReview(
        ctx,
        imported.id,
        {
          connectionGeneration: 1,
          capabilityGeneration: 0,
          accountType: "x_account",
          formats: ["text"],
          publishingGranted: true,
          feedsGranted: true,
          evidence: "",
        },
        provider,
      ),
    ).rejects.toThrow();
    await expect(
      recordCapabilityReview(
        ctx,
        imported.id,
        {
          connectionGeneration: 1,
          capabilityGeneration: 0,
          accountType: "instagram_professional",
          formats: ["reel"],
          publishingGranted: true,
          feedsGranted: true,
          evidence: "Checked the exact native account permission page.",
        },
        provider,
      ),
    ).rejects.toMatchObject({ code: "account_type" });
  });
  it("records an explicit owner attestation while preserving unknown metrics", async () => {
    const reviewed = await recordCapabilityReview(
      ctx,
      imported.id,
      {
        connectionGeneration: 1,
        capabilityGeneration: 0,
        accountType: "x_account",
        formats: ["text", "image"],
        publishingGranted: true,
        feedsGranted: false,
        evidence:
          "Checked posts permission for this exact account in its native authorization page.",
      },
      provider,
    );
    expect(reviewed!.capabilities.operations.publish).toBe("supported");
    expect(reviewed!.capabilities.operations.feed).toBe("permission_missing");
    expect(reviewed!.capabilities.metrics.views).toBe("unknown");
    expect(reviewed!.capabilities.verification.source).toBe(
      "owner_attestation",
    );
    expect(reviewed!.capability_generation).toBe(1);
  });
  it("invalidates stale grants when the same provider account is reauthorized", async () => {
    const pending = await beginConnection(ctx, "x", "oauth2", provider);
    const next = await finishConnection(ctx, pending.state, provider, true);
    expect(next.accounts[0].capabilities.operations.publish).toBe("unknown");
    expect(next.accounts[0].connection_generation).toBe(2);
    expect(next.accounts[0].capability_generation).toBe(2);
  });
  it("rejects overlapping starts and an invalid Quickstart LinkedIn flow", async () => {
    await expect(
      beginConnection(ctx, "linkedin", "personal", provider),
    ).rejects.toMatchObject({ code: "connection_type" });
    const pending = await beginConnection(ctx, "x", "oauth2", provider);
    await expect(
      beginConnection(ctx, "x", "oauth2", provider),
    ).rejects.toMatchObject({ code: "connection_active" });
    await finishConnection(ctx, pending.state, provider, true);
  });
  it("rejects stale forms and a permission review that races reauthorization", async () => {
    const row = (
      await db().query("select * from social_accounts where id=$1", [
        imported.id,
      ])
    ).rows[0];
    const input = {
      connectionGeneration: row.connection_generation,
      capabilityGeneration: row.capability_generation,
      accountType: "x_account",
      formats: ["text"],
      publishingGranted: true,
      feedsGranted: null,
      evidence:
        "Owner checked the native permission page for this exact account.",
    };
    await expect(
      recordCapabilityReview(
        ctx,
        row.id,
        { ...input, connectionGeneration: 1 },
        provider,
      ),
    ).rejects.toMatchObject({ code: "account_changed" });
    let release!: () => void, reached!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve)),
      started = new Promise<void>((resolve) => (reached = resolve));
    const paused = new PostForMeProvider(
      async () => {
        reached();
        await held;
        return response(account(row.provider_account_id));
      },
      "fixture-provider-key",
      true,
    );
    const reviewing = recordCapabilityReview(ctx, row.id, input, paused);
    await started;
    await db().query(
      "update social_accounts set connection_generation=connection_generation+1 where id=$1",
      [row.id],
    );
    release();
    await expect(reviewing).rejects.toMatchObject({ code: "account_changed" });
    expect(
      (
        await db().query(
          "select capabilities from social_accounts where id=$1",
          [row.id],
        )
      ).rows[0].capabilities.operations.publish,
    ).toBe("unknown");
  });
  it("rechecks integration enablement and expiring owner evidence before dispatch", async () => {
    process.env.MEDIAFLOCK_LIVE_PUBLISHING_ENABLED = "true";
    try {
      await saveIntegration(ctx, "postforme", {
        enabled: true,
        config: { connectionCallbackConfigured: true, publishingEnabled: true },
      });
      const row = (
        await db().query("select * from social_accounts where id=$1", [
          imported.id,
        ])
      ).rows[0];
      const reviewed = await recordCapabilityReview(
        ctx,
        row.id,
        {
          connectionGeneration: row.connection_generation,
          capabilityGeneration: row.capability_generation,
          accountType: "x_account",
          formats: ["text"],
          publishingGranted: true,
          feedsGranted: null,
          evidence:
            "Owner checked posts permission on this exact native account.",
        },
        provider,
      );
      expect(reviewed!.capabilities.operations.feed).toBe("unknown");
      const pkg = await domain.createPackage(ctx, {
        title: "Dispatch boundary fixture",
      });
      const variant = await domain.createVariant(ctx, {
        packageId: pkg!.id,
        accountId: row.id,
        format: "text",
        payload: { hook: "Verified fixture", caption: "Approved content" },
      });
      const approval = await domain.requestApproval(ctx, {
        variantId: variant.id,
        revisionId: variant.current_revision_id,
        scheduledAt: new Date(Date.now() + 1800000).toISOString(),
      });
      await domain.decideApproval(ctx, approval!.id, "approved");
      const job = await domain.scheduleApproved(ctx, approval!.id);
      await saveIntegration(ctx, "postforme", {
        enabled: false,
        config: { connectionCallbackConfigured: true, publishingEnabled: true },
      });
      const claim = await claimJob(job!.id);
      let submissions = 0;
      const noSend = new PostForMeProvider(
        async () => {
          submissions++;
          throw new Error("Must not submit");
        },
        "fixture-key",
        true,
      );
      await processJob(claim!, noSend);
      expect(submissions).toBe(0);
      expect((await domain.getJob(ctx, job!.id)).state).toBe("failed");
      await saveIntegration(ctx, "postforme", {
        enabled: true,
        config: { connectionCallbackConfigured: true, publishingEnabled: true },
      });
      const now = (
        await db().query("select * from social_accounts where id=$1", [row.id])
      ).rows[0];
      const fresh = await recordCapabilityReview(
        ctx,
        row.id,
        {
          connectionGeneration: now.connection_generation,
          capabilityGeneration: now.capability_generation,
          accountType: "x_account",
          formats: ["text"],
          publishingGranted: true,
          evidence:
            "Owner checked posts permission on this exact native account.",
        },
        provider,
      );
      const ap = await domain.requestApproval(ctx, {
        variantId: variant.id,
        revisionId: variant.current_revision_id,
        scheduledAt: new Date(Date.now() + 1900000).toISOString(),
      });
      await domain.decideApproval(ctx, ap!.id, "approved");
      await db().query(
        "update social_accounts set capabilities=jsonb_set(capabilities,'{verification,expiresAt}',to_jsonb('2000-01-01T00:00:00Z'::text)) where id=$1",
        [fresh!.id],
      );
      await expect(domain.scheduleApproved(ctx, ap!.id)).rejects.toMatchObject({
        code: "permission_review_required",
      });
    } finally {
      delete process.env.MEDIAFLOCK_LIVE_PUBLISHING_ENABLED;
    }
  });
  it("performs actual read-only connection checks and detects a key race", async () => {
    const ready = await checkIntegration(
      ctx,
      "postforme",
      async (url, init) => {
        expect(String(url)).toContain("/v1/social-accounts");
        expect(init?.method).toBeUndefined();
        return response({ data: [], meta: { next: null } });
      },
    );
    expect(ready.status).toBe("connected");
    expect(ready.networkCall).toBe(true);
    const rejected = await checkIntegration(ctx, "postforme", async () =>
      response({}, 401),
    );
    expect(rejected.status).toBe("unavailable");
    await expect(
      checkIntegration(ctx, "postforme", async () => {
        await saveIntegration(ctx, "postforme", {
          apiKey: "fixture-key-rotated",
          enabled: true,
          config: { connectionCallbackConfigured: true },
        });
        return response({ data: [], meta: { next: null } });
      }),
    ).rejects.toMatchObject({ code: "configuration_changed" });
    expect(JSON.stringify(await listIntegrations(ctx))).not.toContain(
      "fixture-key-rotated",
    );
  });
  it("keeps adapted open-source drafting defaults separate from account voice", () => {
    const ig = writingGuidance("instagram", "reel"),
      fb = writingGuidance("facebook", "text");
    expect(ig.principles.join(" ")).toContain("account's explicit rules");
    expect(ig.principles.join(" ")).not.toBe(fb.principles.join(" "));
    expect(ig.provenance).toContain("supplied by the user");
  });
});
