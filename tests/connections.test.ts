import { collectDueMetrics } from "../apps/worker/analytics";
import { getAnalytics } from "../packages/analytics";
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
  removeIntegration,
} from "../packages/domain/integrations";
import { PostForMeProvider } from "../packages/publishing/postforme";
import {
  ProviderError,
  type PublishingProvider,
} from "../packages/publishing/provider";
import { createToken, tokenContext } from "../packages/domain/auth";
import * as domain from "../packages/domain";
import { claimJob, processJob } from "../apps/worker/publishing";
import { writingGuidance } from "../packages/ai/writing-guidance";
import { due } from "./helpers";
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
async function preparedLiveDelivery() {
  await saveIntegration(ctx, "postforme", {
    apiKey: "fixture-provider-key",
    enabled: true,
    config: { connectionCallbackConfigured: true, publishingEnabled: true },
  });
  const providerAccountId = "fixture-delivery-" + randomUUID();
  let deliveryBinding = "";
  const connectionProvider = new PostForMeProvider(
    async (url, init) => {
      if (url.endsWith("/auth-url")) {
        const body = JSON.parse(String(init.body));
        deliveryBinding = body.external_id;
        return response({
          url: "https://fixture.invalid/authorize",
          platform: body.platform,
        });
      }
      const row = {
        ...account(providerAccountId),
        external_id: deliveryBinding,
      };
      return response(
        url.includes("?external_id=")
          ? { data: [row], meta: { next: null } }
          : row,
      );
    },
    "fixture-provider-key",
    true,
  );
  const pending = await beginConnection(ctx, "x", "oauth2", connectionProvider);
  const connected = await finishConnection(
    ctx,
    pending.state,
    connectionProvider,
    true,
  );
  const current = connected.accounts[0];
  await recordCapabilityReview(
    ctx,
    current.id,
    {
      connectionGeneration: current.connection_generation,
      capabilityGeneration: current.capability_generation,
      accountType: "x_account",
      formats: ["text"],
      publishingGranted: true,
      feedsGranted: true,
      evidence: "Owner checked permissions for this isolated provider fixture.",
    },
    connectionProvider,
  );
  const pkg = await domain.createPackage(ctx, {
    title: "Accepted delivery fixture",
  });
  const variant = await domain.createVariant(ctx, {
    packageId: pkg!.id,
    accountId: current.id,
    format: "text",
    payload: {
      hook: "Approved fixture",
      caption: "Exact owner-approved content",
    },
  });
  const approval = await domain.requestApproval(ctx, {
    variantId: variant.id,
    revisionId: variant.current_revision_id,
    scheduledAt: new Date(Date.now() + 3600000).toISOString(),
  });
  await domain.decideApproval(ctx, approval!.id, "approved");
  const job = await domain.scheduleApproved(ctx, approval!.id);
  return { variant, approval, job };
}
const acceptedFixture: PublishingProvider = {
  submit: async (envelope) => ({
    state: "scheduled",
    authoritative: true,
    raw: {},
    providerJobId: "fixture-accepted-" + envelope.variantId,
  }),
  status: async (id) => ({
    state: "scheduled",
    authoritative: true,
    raw: {},
    providerJobId: id,
  }),
  reconcile: async (_localKey, _snapshotHash, envelope) => ({
    state: "scheduled",
    authoritative: true,
    raw: {},
    providerJobId: "fixture-accepted-" + envelope.variantId,
  }),
  cancel: async (id) => ({
    state: "uncertain",
    authoritative: false,
    raw: {},
    providerJobId: id,
  }),
  feed: async () => [],
};
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
  it("keeps an accepted schedule active when its credentials are disabled", async () => {
    process.env.MEDIAFLOCK_LIVE_PUBLISHING_ENABLED = "true";
    try {
      const { variant, approval, job } = await preparedLiveDelivery();
      await processJob((await claimJob(job!.id))!, acceptedFixture);
      expect((await domain.getJob(ctx, job!.id)).state).toBe("scheduled");
      await saveIntegration(ctx, "postforme", { enabled: false });
      await due(job!.id);
      await processJob((await claimJob(job!.id))!);
      const unresolved = await domain.getJob(ctx, job!.id);
      expect(unresolved.state).toBe("needs_reconciliation");
      expect(unresolved.provider_job_id).toBe("fixture-accepted-" + variant.id);
      expect(unresolved.snapshot_hash).toBe(approval!.snapshot_hash);
      expect(
        unresolved.attempts.filter((a: any) => a.operation === "submit"),
      ).toHaveLength(1);
      await expect(
        domain.editVariant(ctx, variant.id, variant.current_revision_id, {
          ...variant.payload,
          caption: "Replacement must remain blocked",
        }),
      ).rejects.toMatchObject({ code: "delivery_active" });
      await expect(
        domain.rescheduleJob(
          ctx,
          job!.id,
          new Date(Date.now() + 7200000).toISOString(),
        ),
      ).rejects.toMatchObject({ code: "cancel_first" });
    } finally {
      delete process.env.MEDIAFLOCK_LIVE_PUBLISHING_ENABLED;
    }
  });
  it("preserves an uncertain submission without a provider ID when credentials are removed", async () => {
    process.env.MEDIAFLOCK_LIVE_PUBLISHING_ENABLED = "true";
    try {
      const { variant, job } = await preparedLiveDelivery();
      await processJob((await claimJob(job!.id))!, {
        ...acceptedFixture,
        submit: async () => {
          throw new ProviderError(
            "ambiguous",
            "Fixture lost the accepted response",
          );
        },
      });
      expect((await domain.getJob(ctx, job!.id)).state).toBe(
        "needs_reconciliation",
      );
      await removeIntegration(ctx, "postforme");
      await due(job!.id);
      await processJob((await claimJob(job!.id))!);
      const unresolved = await domain.getJob(ctx, job!.id);
      expect(unresolved.state).toBe("needs_reconciliation");
      expect(unresolved.provider_job_id).toBeNull();
      expect(
        unresolved.attempts.filter((a: any) => a.operation === "submit"),
      ).toHaveLength(1);
      await expect(
        domain.editVariant(
          ctx,
          variant.id,
          variant.current_revision_id,
          variant.payload,
        ),
      ).rejects.toMatchObject({ code: "delivery_active" });
    } finally {
      delete process.env.MEDIAFLOCK_LIVE_PUBLISHING_ENABLED;
    }
  });
  it("does not record a false preparation failure after another lease takes over", async () => {
    process.env.MEDIAFLOCK_LIVE_PUBLISHING_ENABLED = "true";
    try {
      const { job } = await preparedLiveDelivery();
      await processJob((await claimJob(job!.id))!, acceptedFixture);
      await saveIntegration(ctx, "postforme", { enabled: false });
      await due(job!.id);
      const stale = (await claimJob(job!.id))!;
      const newerLease = randomUUID();
      await db().query("update publish_jobs set lease_token=$1 where id=$2", [
        newerLease,
        job!.id,
      ]);
      const before = (
        await db().query(
          "select count(*)::int n from audit_events where resource_id=$1",
          [job!.id],
        )
      ).rows[0].n;
      await processJob(stale);
      const after = await domain.getJob(ctx, job!.id);
      expect(after.state).toBe("scheduled");
      expect(after.lease_token).toBe(newerLease);
      expect(
        (
          await db().query(
            "select count(*)::int n from audit_events where resource_id=$1",
            [job!.id],
          )
        ).rows[0].n,
      ).toBe(before);
    } finally {
      delete process.env.MEDIAFLOCK_LIVE_PUBLISHING_ENABLED;
    }
  });
  it.each([
    { name: "no submission", outcomes: [], cancel: false, expected: "failed" },
    {
      name: "only final safe rejections",
      outcomes: ["safe_rejection", "safe_rejection"],
      cancel: false,
      expected: "failed",
    },
    {
      name: "safe then unknown",
      outcomes: ["safe_rejection", "uncertain"],
      cancel: false,
      expected: "needs_reconciliation",
    },
    {
      name: "unknown then safe",
      outcomes: ["uncertain", "safe_rejection"],
      cancel: false,
      expected: "needs_reconciliation",
    },
    {
      name: "unfinished reservation",
      outcomes: ["started"],
      cancel: false,
      expected: "needs_reconciliation",
    },
    {
      name: "late receipt contradicts safe rejection",
      outcomes: ["safe_rejection"],
      receipt: true,
      cancel: false,
      expected: "needs_reconciliation",
    },
    {
      name: "cancel before any attempt",
      outcomes: [],
      cancel: true,
      expected: "cancelled",
    },
    {
      name: "cancel after safe rejection",
      outcomes: ["safe_rejection"],
      cancel: true,
      expected: "cancelled",
    },
    {
      name: "cancel after unknown response",
      outcomes: ["uncertain"],
      cancel: true,
      expected: "needs_reconciliation",
    },
  ])(
    "preserves historical publication evidence: $name",
    async ({ outcomes, cancel, expected, receipt }) => {
      process.env.MEDIAFLOCK_LIVE_PUBLISHING_ENABLED = "true";
      try {
        const { variant, job } = await preparedLiveDelivery();
        for (const outcome of outcomes)
          await db().query(
            "insert into publish_attempts(workspace_id,job_id,operation,lease_token,outcome,finished_at,provider_response) values($1,$2,'submit',$3,$4,case when $4='started' then null else now() end,$5)",
            [
              ctx.workspaceId,
              job!.id,
              randomUUID(),
              outcome,
              receipt
                ? {
                    providerJobId: "fixture-late-" + variant.id,
                    state: "scheduled",
                    authoritative: true,
                    raw: {},
                  }
                : null,
            ],
          );
        await saveIntegration(ctx, "postforme", { enabled: false });
        const claim = (await claimJob(job!.id))!;
        // Cancellation may change generation while the current lease still owns work.
        if (cancel)
          await db().query(
            "update publish_jobs set cancel_requested=true,generation=generation+1 where id=$1",
            [job!.id],
          );
        await processJob(claim);
        const result = await domain.getJob(ctx, job!.id);
        expect(result.state).toBe(expected);
        expect(result.cancel_requested).toBe(cancel);
        expect(result.lease_token).toBeNull();
        expect(result.attempts).toHaveLength(outcomes.length);
        expect(result.error.publicationUncertain).toBe(
          expected === "needs_reconciliation",
        );
        if (expected === "needs_reconciliation") {
          expect(new Date(result.next_run_at).getTime()).toBeGreaterThan(
            Date.now() + 30000,
          );
          await expect(
            domain.editVariant(
              ctx,
              variant.id,
              variant.current_revision_id,
              variant.payload,
            ),
          ).rejects.toMatchObject({ code: "delivery_active" });
          // Restoring setup allows reconciliation, never another submit.
          let submissions = 0;
          await due(job!.id);
          await processJob((await claimJob(job!.id))!, {
            ...acceptedFixture,
            submit: async (envelope) => {
              submissions++;
              return acceptedFixture.submit(envelope, "unused", "unused");
            },
          });
          expect(submissions).toBe(0);
          expect(
            (await domain.getJob(ctx, job!.id)).attempts.filter(
              (attempt: any) => attempt.operation === "submit",
            ),
          ).toHaveLength(outcomes.length);
        }
      } finally {
        delete process.env.MEDIAFLOCK_LIVE_PUBLISHING_ENABLED;
      }
    },
  );
  it("ignores an expired preparation lease without changing state or auditing failure", async () => {
    process.env.MEDIAFLOCK_LIVE_PUBLISHING_ENABLED = "true";
    try {
      const { job } = await preparedLiveDelivery();
      await saveIntegration(ctx, "postforme", { enabled: false });
      const claim = (await claimJob(job!.id))!;
      await db().query(
        "update publish_jobs set lease_expires_at=now()-interval '1 second' where id=$1",
        [job!.id],
      );
      const before = (
        await db().query(
          "select count(*)::int n from audit_events where resource_id=$1",
          [job!.id],
        )
      ).rows[0].n;
      await processJob(claim);
      const result = await domain.getJob(ctx, job!.id);
      expect(result.state).toBe("queued");
      expect(result.lease_token).toBe(claim.lease_token);
      expect(
        (
          await db().query(
            "select count(*)::int n from audit_events where resource_id=$1",
            [job!.id],
          )
        ).rows[0].n,
      ).toBe(before);
    } finally {
      delete process.env.MEDIAFLOCK_LIVE_PUBLISHING_ENABLED;
    }
  });
  it("does not let a metrics retry move the original observation horizon", async () => {
    process.env.MEDIAFLOCK_LIVE_PUBLISHING_ENABLED = "true";
    try {
      const { job } = await preparedLiveDelivery();
      await db().query(
        "update publish_jobs set state='published',platform_post_id=$2,published_at=now()-interval '2 hours' where id=$1",
        [job!.id, "fixture-native-" + job!.id],
      );
      const collection = (
        await db().query(
          "insert into metric_collection_jobs(workspace_id,job_id,horizon_hours,due_at,retry_count) values($1,$2,1,now(),1) returning id",
          [ctx.workspaceId, job!.id],
        )
      ).rows[0];
      let reads = 0;
      await collectDueMetrics(
        {
          ...acceptedFixture,
          feed: async () => {
            reads++;
            return [];
          },
        },
        1,
        job!.id,
      );
      expect(
        (
          await db().query(
            "select state from metric_collection_jobs where id=$1",
            [collection.id],
          )
        ).rows[0].state,
      ).toBe("missed");
      expect(reads).toBe(0);
      const observations = (
        await db().query(
          "select availability,value from metric_snapshots where job_id=$1",
          [job!.id],
        )
      ).rows;
      expect(observations).toHaveLength(4);
      expect(
        observations.every(
          (row) => row.availability === "missed" && row.value === null,
        ),
      ).toBe(true);
    } finally {
      delete process.env.MEDIAFLOCK_LIVE_PUBLISHING_ENABLED;
    }
  });
  it.each(["cutoff", "replaced lease", "expired lease"])(
    "discards a metrics response after its %s",
    async (caseName) => {
      process.env.MEDIAFLOCK_LIVE_PUBLISHING_ENABLED = "true";
      try {
        const { job } = await preparedLiveDelivery();
        const publishedAt = new Date(Date.now() - 3600000);
        await db().query(
          "update publish_jobs set state='published',platform_post_id=$2,published_at=$3 where id=$1",
          [job!.id, "fixture-native-" + job!.id, publishedAt],
        );
        const collection = (
          await db().query(
            "insert into metric_collection_jobs(workspace_id,job_id,horizon_hours,due_at) values($1,$2,1,now()) returning id",
            [ctx.workspaceId, job!.id],
          )
        ).rows[0];
        let observedAt = new Date(publishedAt.getTime() + 3600000 + 899000);
        const replacement = randomUUID();
        const collected = await collectDueMetrics(
          {
            ...acceptedFixture,
            feed: async () => {
              if (caseName === "cutoff")
                observedAt = new Date(publishedAt.getTime() + 3600000 + 901000);
              else if (caseName === "replaced lease")
                await db().query(
                  "update metric_collection_jobs set lease_token=$1 where id=$2",
                  [replacement, collection.id],
                );
              else
                await db().query(
                  "update metric_collection_jobs set lease_expires_at=now()-interval '1 second' where id=$1",
                  [collection.id],
                );
              return [
                {
                  platformPostId: "fixture-native-" + job!.id,
                  metrics: { public_metrics: { impression_count: 500 } },
                  raw: { fixture: true },
                },
              ];
            },
          },
          1,
          job!.id,
          () => observedAt,
        );
        expect(collected).toBe(0);
        const result = (
          await db().query("select * from metric_collection_jobs where id=$1", [
            collection.id,
          ])
        ).rows[0];
        const metrics = (
          await db().query("select * from metric_snapshots where job_id=$1", [
            job!.id,
          ])
        ).rows;
        expect(result.state).toBe(caseName === "cutoff" ? "missed" : "running");
        if (caseName === "cutoff") {
          expect(metrics).toHaveLength(4);
          expect(
            metrics.every(
              (row) => row.value === null && row.availability === "missed",
            ),
          ).toBe(true);
          expect(metrics[0].raw.intendedAt).toBe(
            new Date(publishedAt.getTime() + 3600000).toISOString(),
          );
        } else {
          expect(metrics).toHaveLength(0);
          if (caseName === "replaced lease")
            expect(result.lease_token).toBe(replacement);
        }
        expect(
          (
            await db().query(
              "select id from audit_events where resource_id=$1 and action='metrics.collected'",
              [job!.id],
            )
          ).rows,
        ).toHaveLength(0);
      } finally {
        delete process.env.MEDIAFLOCK_LIVE_PUBLISHING_ENABLED;
      }
    },
  );
  it("keeps a real zero and the exact retrieval time separate from later missed records", async () => {
    process.env.MEDIAFLOCK_LIVE_PUBLISHING_ENABLED = "true";
    try {
      const { job } = await preparedLiveDelivery();
      const collectedAt = new Date();
      await db().query(
        "update publish_jobs set state='published',platform_post_id=$2,published_at=$3 where id=$1",
        [
          job!.id,
          "fixture-native-" + job!.id,
          new Date(collectedAt.getTime() - 3600000),
        ],
      );
      await db().query(
        "insert into metric_collection_jobs(workspace_id,job_id,horizon_hours,due_at) values($1,$2,1,now())",
        [ctx.workspaceId, job!.id],
      );
      expect(
        await collectDueMetrics(
          {
            ...acceptedFixture,
            feed: async () => [
              {
                platformPostId: "fixture-native-" + job!.id,
                metrics: { public_metrics: { impression_count: 0 } },
                raw: { fixture: true },
              },
            ],
          },
          1,
          job!.id,
          () => collectedAt,
        ),
      ).toBe(1);
      let result = await getAnalytics(ctx, job!.account_id);
      expect(result.summary.medianViews).toBe(0);
      expect(new Date(result.summary.lastObservedAt!).getTime()).toBe(
        collectedAt.getTime(),
      );
      await db().query(
        "insert into metric_snapshots(workspace_id,account_id,job_id,platform_post_id,metric,definition,value,unit,scope,availability,horizon_hours,observed_at,provenance,raw) values($1,$2,$3,$4,'views','Unavailable later observation',null,'count','lifetime','missed',24,$5,'provider','{}')",
        [
          ctx.workspaceId,
          job!.account_id,
          job!.id,
          "fixture-native-" + job!.id,
          new Date(collectedAt.getTime() + 60000),
        ],
      );
      result = await getAnalytics(ctx, job!.account_id);
      expect(new Date(result.summary.lastObservedAt!).getTime()).toBe(
        collectedAt.getTime(),
      );
      expect(new Date(result.summary.lastRecordedAt!).getTime()).toBe(
        collectedAt.getTime() + 60000,
      );
      expect(result.summary.medianViews).toBeNull();
      expect(result.summary.availablePosts).toBe(0);
    } finally {
      delete process.env.MEDIAFLOCK_LIVE_PUBLISHING_ENABLED;
    }
  });
  it("keeps adapted open-source drafting defaults separate from account voice", () => {
    const ig = writingGuidance("instagram", "reel"),
      fb = writingGuidance("facebook", "text");
    expect(ig.principles.join(" ")).toContain("account's explicit rules");
    expect(ig.principles.join(" ")).not.toBe(fb.principles.join(" "));
    expect(ig.provenance).toContain("supplied by the user");
  });
});
