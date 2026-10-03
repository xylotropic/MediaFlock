import { afterAll, beforeAll, describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { db, scoped, closeDb, workerContext } from "../packages/db";
import * as domain from "../packages/domain";
import {
  createToken,
  revokeToken,
  tokenContext,
  hash,
  limit,
} from "../packages/domain/auth";
import { getConfig } from "../packages/domain/config";
import { handleApi } from "../packages/domain/api-router";
import {
  saveIntegration,
  listIntegrations,
  addService,
  removeService,
} from "../packages/domain/integrations";
import { DeterministicDemoProvider } from "../packages/publishing/demo";
import { PostForMeProvider } from "../packages/publishing/postforme";
import {
  claimJob,
  processJob,
  ingestProviderHint,
} from "../apps/worker/publishing";
import { processMediaQueue } from "../apps/worker/media";
import { collectDueMetrics } from "../apps/worker/analytics";
import {
  uploadAsset,
  assetBytes,
  requestDerivative,
  checksum,
} from "../packages/media";
import { collectDemoNow, postMetrics } from "../packages/analytics";
import * as experiments from "../packages/experiments";
import * as ai from "../packages/ai";
import {
  fixture,
  makeAccount,
  draft,
  approved,
  delivery,
  due,
  scopes,
} from "./helpers";
let a: Awaited<ReturnType<typeof fixture>>,
  b: Awaited<ReturnType<typeof fixture>>;
const provider = new DeterministicDemoProvider();
async function tick(id: string) {
  await due(id);
  const claim = await claimJob(id);
  expect(claim).toBeTruthy();
  await processJob(claim!, provider);
  return domain.getJob(a.ctx, id);
}
async function api(
  secret: string,
  path: string,
  method = "GET",
  body?: unknown,
  workspace?: string,
) {
  return handleApi(
    new Request("http://127.0.0.1:3210/api/v1/" + path, {
      method,
      headers: {
        Authorization: "Bearer " + secret,
        ...(workspace ? { "X-Workspace-Id": workspace } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    }),
    path.split("/"),
  );
}
beforeAll(async () => {
  a = await fixture("integration A");
  b = await fixture("integration B");
}, 30000);
afterAll(closeDb);
describe("Real local database, authorization and immutable content", () => {
  it("persists content and immutable edits through new DB connections", async () => {
    const { pkg, variant } = await draft(a.ctx, a.account.id);
    const edited = await domain.editVariant(
      a.ctx,
      variant.id,
      variant.current_revision_id,
      { ...variant.payload, caption: "Persisted revision two" },
    );
    await closeDb();
    const loaded = await domain.getPackage(a.ctx, pkg!.id);
    expect(loaded.variants[0].payload.caption).toBe("Persisted revision two");
    const revisions = await domain.listRevisions(a.ctx, variant.id);
    expect(revisions).toHaveLength(2);
    expect(edited.content_hash).not.toBe(variant.content_hash);
    await expect(
      scoped(a.ctx, (tx) =>
        tx.query("update content_revisions set payload='{}' where id=$1", [
          variant.current_revision_id,
        ]),
      ),
    ).rejects.toThrow();
  });
  it("isolates workspace lookups, references and RLS even without frontend filters", async () => {
    expect(
      (await domain.listAccounts(a.ctx)).every(
        (x) => x.workspace_id === a.ctx.workspaceId,
      ),
    ).toBe(true);
    await expect(domain.getAccount(a.ctx, b.account.id)).rejects.toMatchObject({
      code: "not_found",
    });
    const { pkg } = await draft(a.ctx, a.account.id);
    await expect(
      domain.createVariant(a.ctx, {
        packageId: pkg!.id,
        accountId: b.account.id,
        format: "text",
        payload: { hook: "h", caption: "c" },
      }),
    ).rejects.toMatchObject({ code: "invalid_account" });
    const foreignAsset = (
      await db().query(
        "insert into assets(workspace_id,filename,storage_path,mime_type,bytes,checksum,provenance) values($1,'foreign.png',$2,'image/png',20,'test','fixture') returning id",
        [b.ctx.workspaceId, b.ctx.workspaceId + "/foreign/" + randomUUID()],
      )
    ).rows[0];
    await expect(
      domain.createPackage(a.ctx, {
        title: "Denied asset",
        assetIds: [foreignAsset.id],
      }),
    ).rejects.toMatchObject({ code: "invalid_asset" });
    await expect(
      scoped(a.ctx, (tx) =>
        tx.query(
          "insert into account_rules(workspace_id,account_id,text,source,created_by) values($1,$2,'bad','user',$3)",
          [a.ctx.workspaceId, b.account.id, a.ctx.userId],
        ),
      ),
    ).rejects.toThrow();
    const rls = await scoped(a.ctx, (tx) =>
      tx.query("select id from social_accounts where id=$1", [b.account.id]),
    );
    expect(rls.rows).toHaveLength(0);
    const client = createClient(getConfig().supabaseUrl, getConfig().anonKey, {
      auth: { persistSession: false },
    });
    expect(
      (
        await client.auth.signInWithPassword({
          email: a.email,
          password: a.password,
        })
      ).error,
    ).toBeNull();
    const { data, error } = await client
      .from("social_accounts")
      .select("id,workspace_id");
    expect(error).toBeNull();
    expect(data?.every((x) => x.workspace_id === a.ctx.workspaceId)).toBe(true);
    const denied = await client
      .from("social_accounts")
      .update({ handle: "bad" })
      .eq("id", a.account.id);
    expect(denied.error).toBeTruthy();
    await client.auth.signOut();
  });
  it("isolates API tokens, hashes secrets, rejects revoked, expired and over-scoped tokens", async () => {
    const token = await createToken(a.ctx, {
      name: "API test",
      scopes: ["read", "draft", "request_approval"],
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    });
    expect(token.secret.startsWith("mf_")).toBe(true);
    const saved = (
      await db().query("select token_hash from api_tokens where id=$1", [
        token.id,
      ])
    ).rows[0];
    expect(saved.token_hash).toBe(hash(token.secret));
    expect((await api(token.secret, "accounts")).status).toBe(200);
    expect((await api(token.secret, "accounts/" + b.account.id)).status).toBe(
      404,
    );
    expect(
      (await api(token.secret, "accounts", "GET", undefined, b.ctx.workspaceId))
        .status,
    ).toBe(403);
    expect(
      (
        await api(token.secret, "packages", "POST", {
          title: "HTTP persisted source",
        })
      ).status,
    ).toBe(200);
    await revokeToken(a.ctx, token.id);
    expect((await api(token.secret, "accounts")).status).toBe(401);
    const expiry = await createToken(a.ctx, {
      name: "Expiring",
      scopes: ["read"],
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    });
    const captured = await tokenContext(expiry.secret);
    await db().query(
      "update api_tokens set expires_at=now()-interval '1 second' where id=$1",
      [expiry.id],
    );
    await expect(domain.listAccounts(captured)).rejects.toMatchObject({
      code: "invalid_token",
    });
    await expect(tokenContext(expiry.secret)).rejects.toMatchObject({
      code: "invalid_token",
    });
    await expect(
      createToken(a.ctx, {
        name: "Bad scope",
        scopes: ["approve"],
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      }),
    ).rejects.toThrow();
  });
  it("checks fresh membership roles and rate limits", async () => {
    const f = await fixture("revoked membership");
    await db().query(
      "update memberships set role='viewer' where workspace_id=$1 and user_id=$2",
      [f.ctx.workspaceId, f.ctx.userId],
    );
    await expect(
      domain.createPackage(f.ctx, { title: "Forbidden" }),
    ).rejects.toMatchObject({ code: "membership_changed" });
    await expect(
      domain.createPackage(
        { ...f.ctx, role: "viewer" },
        { title: "Forbidden" },
      ),
    ).rejects.toMatchObject({ code: "role_denied" });
    const key = "test:" + randomUUID();
    await limit(key, 2);
    await limit(key, 2);
    await expect(limit(key, 2)).rejects.toMatchObject({ status: 429 });
  });
  it("keeps audit events append-only and scopes the worker service", async () => {
    const { pkg } = await draft(a.ctx, a.account.id);
    await expect(
      scoped(a.ctx, (tx) =>
        tx.query("delete from audit_events where resource_id=$1", [pkg!.id]),
      ),
    ).rejects.toThrow();
    expect(
      (
        await scoped(workerContext(a.ctx.workspaceId), (tx) =>
          tx.query("select id from social_accounts where id=$1", [
            b.account.id,
          ]),
        )
      ).rows,
    ).toHaveLength(0);
  });
  it("protects originals, private storage and worker-produced derivatives", async () => {
    const bytes = await readFile("artifacts/fixtures/original-motion.mp4");
    const originalHash = checksum(bytes);
    const asset = await uploadAsset(
      a.ctx,
      "../../original-video.mp4",
      bytes,
      [],
      "Original fixture",
    );
    expect((await assetBytes(a.ctx, asset!.id)).checksum).toBe(originalHash);
    await expect(assetBytes(b.ctx, asset!.id)).rejects.toMatchObject({
      code: "not_found",
    });
    const recipe = {
      trimStart: 0,
      trimEnd: 1,
      width: 128,
      height: 128,
      fit: "letterbox",
      output: "mp4",
      subtitles: "1\n00:00:00,000 --> 00:00:00,800\nOriginal test caption\n",
    };
    const derivative = await requestDerivative(a.ctx, asset!.id, recipe);
    await processMediaQueue(1, derivative!.id);
    const row = (
      await db().query("select * from asset_derivatives where id=$1", [
        derivative!.id,
      ])
    ).rows[0];
    expect(row.status).toBe("ready");
    expect(row.metadata.width).toBe(128);
    expect(Number(row.metadata.duration)).toBeCloseTo(1, 1);
    expect((await assetBytes(a.ctx, asset!.id)).checksum).toBe(originalHash);
    expect(checksum(bytes)).toBe(originalHash);
    const denied = await fetch(
      getConfig().supabaseUrl +
        "/storage/v1/object/mediaflock/" +
        asset!.storage_path,
    );
    expect(denied.ok).toBe(false);
  });
  it("keeps account-specific AI context and labels fixture outputs", async () => {
    await domain.addAccountRule(
      a.ctx,
      a.account.id,
      "Use ACCOUNT-A-SPECIFIC-RULE.",
    );
    const other = await makeAccount(a.ctx);
    const { pkg } = await draft(a.ctx, other.id);
    const generated = await ai.generateVariants(a.ctx, pkg!.id, [
      { accountId: other.id, format: "text" },
    ]);
    expect(JSON.stringify(generated)).toContain("Deterministic demo AI");
    expect(JSON.stringify(generated)).not.toContain("ACCOUNT-A-SPECIFIC-RULE");
    await expect(
      ai.suggestHooks(a.ctx, b.account.id, "brief"),
    ).rejects.toMatchObject({ code: "not_found" });
  });
  it("exposes administration with demo keys refused and reference services reversible", async () => {
    await expect(
      saveIntegration(a.ctx, "openai", { key: "fixture-key", enabled: true }),
    ).rejects.toMatchObject({ code: "live_workspace_required" });
    const list = await listIntegrations(a.ctx);
    expect(JSON.stringify(list)).not.toContain(getConfig().serviceKey);
    const service = await addService(a.ctx, {
      name: "Local reference",
      type: "reference",
      url: "https://example.com",
      notes: "No automatic requests",
    });
    await removeService(a.ctx, service!.id);
  });
});
describe("Approval and reliable delivery state machines", () => {
  it("invalidates exact-revision approval after an edit", async () => {
    const { variant, approval } = await approved(a.ctx, a.account.id);
    await domain.editVariant(a.ctx, variant.id, variant.current_revision_id, {
      ...variant.payload,
      caption: "Changed after approval",
    });
    await expect(
      domain.scheduleApproved(a.ctx, approval!.id),
    ).rejects.toMatchObject({ code: "approval_required" });
    expect(
      (await domain.listApprovals(a.ctx)).find((x) => x.id === approval!.id)
        ?.status,
    ).toBe("revoked");
  });
  it("tokens cannot self-approve and concurrent scheduling produces one durable intent", async () => {
    const { variant, approval } = await approved(a.ctx, a.account.id);
    const token = await createToken(a.ctx, {
      name: "Agent",
      scopes,
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    });
    const ctx = await tokenContext(token.secret);
    await expect(
      domain.decideApproval(ctx, approval!.id, "approved"),
    ).rejects.toMatchObject({ code: "human_approval_required" });
    const jobs = await Promise.all(
      Array.from({ length: 6 }, () =>
        domain.scheduleApproved(a.ctx, approval!.id),
      ),
    );
    expect(new Set(jobs.map((x) => x.id)).size).toBe(1);
    const claims = await Promise.all([
      claimJob(jobs[0].id),
      claimJob(jobs[0].id),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    await processJob(claims.find(Boolean)!, provider);
    await expect(
      domain.editVariant(
        a.ctx,
        variant.id,
        variant.current_revision_id,
        variant.payload,
      ),
    ).rejects.toMatchObject({ code: "delivery_active" });
  });
  it("reconciles timeout after acceptance without a duplicate submit", async () => {
    const account = await makeAccount(a.ctx, "timeout_after_acceptance");
    const { job } = await delivery(a.ctx, account.id);
    expect((await tick(job.id)).state).toBe("needs_reconciliation");
    expect((await tick(job.id)).state).toBe("published");
    const calls = (
      await db().query(
        "select count(*)::int n from demo_provider_calls c join publication_targets t on t.local_key=c.local_key where t.id=$1 and c.operation='submit'",
        [job.target_id],
      )
    ).rows[0].n;
    expect(calls).toBe(1);
  });
  it("recovers in a separate process after acceptance and a lost local receipt", async () => {
    const account = await makeAccount(a.ctx);
    const { job } = await delivery(a.ctx, account.id);
    const claim = await claimJob(job.id);
    const details = await domain.getJob(a.ctx, job.id);
    await db().query(
      "insert into publish_attempts(workspace_id,job_id,operation,lease_token) values($1,$2,'submit',$3)",
      [a.ctx.workspaceId, job.id, claim!.lease_token],
    );
    await db().query(
      "update publish_jobs set state='submitting',lease_expires_at=now()-interval '1 second' where id=$1",
      [job.id],
    );
    await provider.submit(
      details.snapshot,
      details.local_key,
      details.snapshot_hash,
    );
    await promisify(execFile)(
      process.execPath,
      ["node_modules/tsx/dist/cli.mjs", "tests/worker-process.ts", job.id],
      { cwd: process.cwd(), timeout: 20000 },
    );
    expect((await domain.getJob(a.ctx, job.id)).state).toBe("published");
    const calls = (
      await db().query(
        "select count(*)::int n from demo_provider_calls where local_key=$1",
        [details.local_key],
      )
    ).rows[0].n;
    expect(calls).toBe(1);
  });
  it("uses fenced late receipt IDs for status reads instead of a second submit", async () => {
    const account = await makeAccount(a.ctx);
    const { job } = await delivery(a.ctx, account.id);
    const claim = await claimJob(job.id);
    await processJob(claim!, {
      ...provider,
      submit: async (e, k, h) => {
        const receipt = await provider.submit(e, k, h);
        await db().query(
          "update publish_jobs set lease_token=$1,lease_expires_at=now()-interval '1 second' where id=$2",
          [randomUUID(), job.id],
        );
        return receipt;
      },
      status: provider.status.bind(provider),
      reconcile: async () => {
        throw new Error("Late ID should use status");
      },
      cancel: provider.cancel.bind(provider),
      feed: provider.feed.bind(provider),
    });
    const late = await domain.getJob(a.ctx, job.id);
    expect(late.state).toBe("submitting");
    await tick(job.id);
    expect((await domain.getJob(a.ctx, job.id)).state).toBe("published");
    expect(
      (await domain.getJob(a.ctx, job.id)).attempts.filter(
        (x: any) => x.operation === "submit",
      ),
    ).toHaveLength(1);
  });
  it("records duplicate/out-of-order provider hints without changing terminal state", async () => {
    const account = await makeAccount(a.ctx);
    const { job } = await delivery(a.ctx, account.id);
    await tick(job.id);
    await tick(job.id);
    const first = await ingestProviderHint(
      workerContext(a.ctx.workspaceId),
      "event-" + job.id,
      job.id,
      { status: "failed" },
    );
    expect(first).toBeTruthy();
    expect(
      await ingestProviderHint(
        workerContext(a.ctx.workspaceId),
        "event-" + job.id,
        job.id,
        { status: "scheduled" },
      ),
    ).toBeNull();
    expect((await domain.getJob(a.ctx, job.id)).state).toBe("published");
  });
  it("honors rate-limit backoff and only retries documented safe rejections", async () => {
    const account = await makeAccount(a.ctx, "rate_limit_once");
    const { job } = await delivery(a.ctx, account.id);
    const retry = await tick(job.id);
    expect(retry.state).toBe("queued");
    expect(new Date(retry.next_run_at).getTime()).toBeGreaterThan(Date.now());
    expect(retry.attempts[0].outcome).toBe("safe_rejection");
    await tick(job.id);
    await tick(job.id);
    expect((await domain.getJob(a.ctx, job.id)).state).toBe("published");
  });
  it("preserves independent partial destination failures", async () => {
    const good = await makeAccount(a.ctx),
      bad = await makeAccount(a.ctx, "partial_failure");
    const x = await delivery(a.ctx, good.id),
      y = await delivery(a.ctx, bad.id);
    await tick(x.job.id);
    await tick(y.job.id);
    expect((await tick(x.job.id)).state).toBe("published");
    expect((await tick(y.job.id)).state).toBe("failed");
  });
  it("requires confirmed cancellation before rescheduling and reports publication races", async () => {
    const future = new Date(Date.now() + 3600000).toISOString(),
      account = await makeAccount(a.ctx);
    const { job } = await delivery(a.ctx, account.id, future);
    await tick(job.id);
    await expect(
      domain.rescheduleJob(
        a.ctx,
        job.id,
        new Date(Date.now() + 7200000).toISOString(),
      ),
    ).rejects.toMatchObject({ code: "cancel_first" });
    await domain.cancelJob(a.ctx, job.id);
    expect((await tick(job.id)).state).toBe("cancelled");
    const replacement = await domain.rescheduleJob(
      a.ctx,
      job.id,
      new Date(Date.now() + 7200000).toISOString(),
    );
    expect(replacement!.status).toBe("pending");
    const raceAccount = await makeAccount(a.ctx),
      race = await delivery(a.ctx, raceAccount.id);
    await tick(race.job.id);
    await domain.cancelJob(a.ctx, race.job.id);
    const raced = await tick(race.job.id);
    expect(raced.state).toBe("published");
    expect(raced.error.classification).toBe("cancellation_race");
  });
  it("rechecks disconnection and approval revocation before submitting", async () => {
    const account = await makeAccount(a.ctx);
    const { job } = await delivery(a.ctx, account.id);
    await db().query(
      "update social_accounts set status='disconnected' where id=$1",
      [account.id],
    );
    expect((await tick(job.id)).state).toBe("failed");
    expect((await domain.getJob(a.ctx, job.id)).attempts).toHaveLength(0);
  });
  it("keeps demo records out of the live adapter", async () => {
    const { job } = await delivery(a.ctx, (await makeAccount(a.ctx)).id);
    const data = await domain.getJob(a.ctx, job.id);
    const offline = new PostForMeProvider(
      async () => {
        throw new Error("Transport must never be called");
      },
      "fixture",
      true,
    );
    await expect(
      offline.submit(data.snapshot, data.local_key, data.snapshot_hash),
    ).rejects.toMatchObject({ classification: "validation" });
    await domain.cancelJob(a.ctx, job.id);
  });
});
describe("Experiment, analytics and MCP vertical slices", () => {
  it("publishes six distinct assigned posts, collects observations and saves traceable recommendations", async () => {
    const account = await makeAccount(a.ctx);
    const exp = await experiments.createExperiment(a.ctx, {
      name: "Isolated full loop",
      hypothesis: "A concrete opening may be associated with higher views.",
      changedVariable: "hook",
      primaryMetric: "views",
      horizonHours: 24,
      plannedSamples: 3,
      accounts: [{ accountId: account.id, formats: ["text"] }],
    });
    expect(
      (await experiments.experimentResults(a.ctx, exp!.id)).comparison.status,
    ).toBe("Insufficient evidence");
    for (let i = 0; i < 6; i++) {
      const data = await delivery(a.ctx, account.id);
      await experiments.assignVariant(
        a.ctx,
        exp!.id,
        data.variant.id,
        data.variant.current_revision_id,
        i < 3 ? "A" : "B",
      );
      await tick(data.job.id);
      await tick(data.job.id);
      await collectDemoNow(a.ctx, data.job.id);
      await collectDueMetrics(provider, 1, data.job.id);
      expect(
        (await postMetrics(a.ctx, data.job.id)).every(
          (x) => x.provenance === "simulated",
        ),
      ).toBe(true);
    }
    const result = await experiments.experimentResults(a.ctx, exp!.id);
    expect(result.comparison.status).toBe("Observational signal");
    expect(result.comparison.groups[0].A.count).toBe(3);
    expect(result.comparison.groups[0].B.count).toBe(3);
    const insight = await experiments.saveRecommendation(a.ctx, exp!.id);
    const observation = await experiments.proposeObservation(
      a.ctx,
      account.id,
      insight!.id,
      "Repeat with new sources before adopting a rule.",
    );
    expect((await domain.accountContext(a.ctx, account.id)).rules).toHaveLength(
      0,
    );
    await experiments.acceptObservation(a.ctx, observation!.id);
    expect((await domain.accountContext(a.ctx, account.id)).rules).toHaveLength(
      1,
    );
  });
  it("runs the actual MCP stdio protocol and blocks human approval and revoked tokens", async () => {
    const token = await createToken(a.ctx, {
      name: "MCP protocol",
      scopes: ["read", "draft", "request_approval"],
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["node_modules/tsx/dist/cli.mjs", "apps/mcp/main.ts"],
      cwd: process.cwd(),
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter(
            (x): x is [string, string] => x[1] !== undefined,
          ),
        ),
        MEDIAFLOCK_API_TOKEN: token.secret,
      },
      stderr: "pipe",
    });
    const client = new Client({ name: "mediaflock-test", version: "1.0.0" });
    try {
      await client.connect(transport);
      const tools = await client.listTools();
      expect(tools.tools).toHaveLength(10);
      expect(
        tools.tools.some(
          (x) =>
            /approve/.test(x.name) && x.name !== "schedule_approved_variant",
        ),
      ).toBe(false);
      expect(
        (await client.callTool({ name: "list_accounts", arguments: {} }))
          .isError,
      ).not.toBe(true);
      const created = await client.callTool({
        name: "create_content_package",
        arguments: { title: "MCP persisted package" },
      });
      expect(created.isError).not.toBe(true);
      expect(
        (await client.callTool({ name: "approve", arguments: {} })).isError,
      ).toBe(true);
      await revokeToken(a.ctx, token.id);
      expect(
        (await client.callTool({ name: "list_accounts", arguments: {} }))
          .isError,
      ).toBe(true);
    } finally {
      await client.close();
      await transport.close();
    }
  });
});
