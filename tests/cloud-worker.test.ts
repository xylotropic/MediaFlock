import { randomBytes, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { beforeAll, beforeEach, afterAll, describe, it, expect } from "vitest";
import { db, closeDb, withWorkerDatabase } from "../packages/db";
import { getConfig } from "../packages/domain/config";
import {
  remainingWorkerTime,
  withWorkerBudget,
} from "../packages/worker/budget";
import {
  cloudAuthorization,
  cloudTickRequest,
  runCloudTick,
} from "../apps/worker/cloud";
import { PostForMeProvider } from "../packages/publishing/postforme";
import { claimJob, processJob } from "../apps/worker/publishing";
import { fixture, delivery } from "./helpers";
import * as domain from "../packages/domain";

const empty = { metrics: async () => 0, publishing: async () => 0 };
const secret = randomBytes(32).toString("base64url");
const originalCronSecret = process.env.CRON_SECRET;
const originalMode = process.env.MEDIAFLOCK_MODE;
function restoreEnvironment() {
  if (originalCronSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = originalCronSecret;
  if (originalMode === undefined) delete process.env.MEDIAFLOCK_MODE;
  else process.env.MEDIAFLOCK_MODE = originalMode;
}
beforeAll(async () => {
  if (
    getConfig().mode !== "demo" ||
    !["localhost", "127.0.0.1"].includes(
      new URL(getConfig().databaseUrl).hostname,
    )
  )
    throw Error("Isolated local database required.");
  if (
    !(
      await db().query(
        "select to_regclass('public.cloud_worker_control') present",
      )
    ).rows[0].present
  )
    throw Error(
      "Apply the cloud-worker migration to the isolated database first.",
    );
});
beforeEach(async () => {
  await db().query(
    "update cloud_worker_control set enabled=true,work_enabled=true,next_lane='metrics',lease_token=null,lease_expires_at=null,admitted_minute=now()-interval '2 minutes',last_completed_at=null,last_result=null,last_work_error=null,last_work_error_at=null where mode='demo'",
  );
});
afterAll(async () => {
  restoreEnvironment();
  await db().query(
    "update cloud_worker_control set enabled=false,work_enabled=false,lease_token=null,lease_expires_at=null",
  );
  await closeDb();
});
describe("Bounded cloud execution", () => {
  it("rejects absent, malformed and unrelated credentials", () => {
    expect(cloudAuthorization(null, secret)).toBe(false);
    expect(cloudAuthorization("Bearer " + secret, undefined)).toBe(false);
    expect(cloudAuthorization("Bearer " + secret, "too-short")).toBe(false);
    expect(cloudAuthorization("Bearer unrelated", secret)).toBe(false);
    expect(cloudAuthorization("Bearer " + secret + " ", secret)).toBe(false);
    expect(cloudAuthorization("Bearer " + secret, secret)).toBe(true);
  });
  it("admits one concurrent cycle and keeps its minute closed after completion", async () => {
    let release!: () => void, entered!: () => void;
    const hold = new Promise<void>((r) => (release = r)),
      started = new Promise<void>((r) => (entered = r));
    const first = runCloudTick({
      ...empty,
      metrics: async () => {
        entered();
        await hold;
        return 0;
      },
    });
    await started;
    expect((await runCloudTick(empty)).status).toBe("skipped");
    release();
    expect((await first).status).toBe("completed");
    expect((await runCloudTick(empty)).status).toBe("skipped");
    expect(
      (
        await db().query(
          "select lease_token from cloud_worker_control where mode='demo'",
        )
      ).rows[0].lease_token,
    ).toBeNull();
  });
  it("alternates the first lane durably and services metrics after a publication failure", async () => {
    const order: string[] = [];
    const adapters = {
      metrics: async () => {
        order.push("metrics");
        return 0;
      },
      publishing: async () => {
        order.push("publishing");
        throw Error("Isolated provider failure");
      },
    };
    expect((await runCloudTick(adapters)).status).toBe("failed");
    await db().query(
      "update cloud_worker_control set admitted_minute=now()-interval '2 minutes' where mode='demo'",
    );
    expect((await runCloudTick(adapters)).status).toBe("failed");
    expect(order).toEqual(["metrics", "publishing", "publishing", "metrics"]);
    await db().query(
      "update cloud_worker_control set admitted_minute=now()-interval '2 minutes',work_enabled=false where mode='demo'",
    );
    expect((await runCloudTick(empty)).status).toBe("completed");
    expect(
      (
        await db().query(
          "select last_work_error from cloud_worker_control where mode='demo'",
        )
      ).rows[0].last_work_error,
    ).toBe(
      "Cloud work could not complete. Review delivery and measurement status.",
    );
  });
  it("does not clear a replacement admission lease when an old cycle returns", async () => {
    let release!: () => void, entered!: () => void;
    const hold = new Promise<void>((r) => (release = r)),
      started = new Promise<void>((r) => (entered = r));
    const first = runCloudTick({
      ...empty,
      metrics: async () => {
        entered();
        await hold;
        return 0;
      },
    });
    await started;
    const replacement = randomUUID();
    await db().query(
      "update cloud_worker_control set lease_token=$1,lease_expires_at=now()+interval '150 seconds' where mode='demo'",
      [replacement],
    );
    release();
    expect((await first).status).toBe("skipped");
    const row = (
      await db().query(
        "select lease_token,last_completed_at from cloud_worker_control where mode='demo'",
      )
    ).rows[0];
    expect(row.lease_token).toBe(replacement);
    expect(row.last_completed_at).toBeNull();
  });
  it("rechecks the durable stop gate before another task", async () => {
    let publications = 0;
    await runCloudTick({
      metrics: async () => {
        await db().query(
          "update cloud_worker_control set enabled=false where mode='demo'",
        );
        return 0;
      },
      publishing: async () => {
        publications++;
        return 0;
      },
    });
    expect(publications).toBe(0);
    expect((await runCloudTick(empty)).status).toBe("skipped");
  });
  it("keeps a closed work gate separate from the authenticated empty heartbeat", async () => {
    await db().query(
      "update cloud_worker_control set work_enabled=false where mode='demo'",
    );
    const never = async () => {
      throw Error("A heartbeat must not construct a provider");
    };
    expect(
      (await runCloudTick({ metrics: never, publishing: never })).status,
    ).toBe("completed");
    const row = (
      await db().query(
        "select last_result,last_completed_at from cloud_worker_control where mode='demo'",
      )
    ).rows[0];
    expect(
      row.last_result.every((lane: any) => lane.outcome === "disabled"),
    ).toBe(true);
    expect(row.last_completed_at).not.toBeNull();
  });
  it("bounds a database operation on a private connection without changing normal app timeouts", async () => {
    const before = (await db().query("show statement_timeout")).rows[0]
      .statement_timeout;
    const name = "Isolated timeout " + randomUUID();
    const started = performance.now();
    await expect(
      withWorkerBudget({ provider: 150, database: 200 }, () =>
        withWorkerDatabase(() =>
          db().query(
            "insert into workspaces(name,mode) select $1,'demo' from (select pg_sleep(0.5)) delay",
            [name],
          ),
        ),
      ),
    ).rejects.toThrow();
    expect(performance.now() - started).toBeLessThan(1500);
    expect(
      (await db().query("select id from workspaces where name=$1", [name]))
        .rows,
    ).toHaveLength(0);
    expect(
      (await db().query("show statement_timeout")).rows[0].statement_timeout,
    ).toBe(before);
  });
  it("never extends an enclosing deadline when entering another task", async () => {
    await withWorkerBudget({ provider: 100, database: 150 }, async () => {
      const provider = remainingWorkerTime("provider")!;
      const database = remainingWorkerTime("database")!;
      await withWorkerBudget({ provider: 1000, database: 1000 }, async () => {
        expect(remainingWorkerTime("provider")).toBeLessThanOrEqual(provider);
        expect(remainingWorkerTime("database")).toBeLessThanOrEqual(database);
      });
    });
  });
  it("bounds the full provider response body and preserves an ambiguous read", async () => {
    let aborted = false;
    const provider = new PostForMeProvider(
      async (_url, init) =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('{"data":'));
              init!.signal!.addEventListener(
                "abort",
                () => {
                  aborted = true;
                  controller.error(Error("Isolated body timeout"));
                },
                { once: true },
              );
            },
          }),
          { headers: { "Content-Type": "application/json" } },
        ),
      "isolated-provider-key",
      true,
    );
    const started = performance.now();
    await expect(
      withWorkerBudget({ provider: 100, database: 200 }, () =>
        provider.feed("isolated-account", "isolated-post"),
      ),
    ).rejects.toMatchObject({ classification: "ambiguous" });
    expect(aborted).toBe(true);
    expect(performance.now() - started).toBeLessThan(1000);
  });
  it("uses the existing final approval fence through a cloud publication adapter", async () => {
    const f = await fixture("Cloud owner approval fence"),
      data = await delivery(f.ctx, f.account.id);
    await domain.revokeApproval(
      f.ctx,
      data.approval!.id,
      "Owner withdrew the exact content.",
    );
    let submissions = 0;
    const provider = {
      submit: async () => {
        submissions++;
        throw Error("Must not submit");
      },
      status: async () => {
        throw Error("Unused");
      },
      reconcile: async () => null,
      cancel: async () => {
        throw Error("Unused");
      },
      feed: async () => [],
    };
    await runCloudTick({
      ...empty,
      publishing: async () => {
        const claim = await claimJob(data.job.id);
        if (claim) await processJob(claim, provider);
        return claim ? 1 : 0;
      },
    });
    expect(submissions).toBe(0);
    expect((await domain.getJob(f.ctx, data.job.id)).state).toBe("cancelled");
  });
  it("exposes no user-cookie or caller-selected work fallback in the HTTP entrypoint", async () => {
    process.env.MEDIAFLOCK_MODE = "live";
    process.env.CRON_SECRET = secret;
    try {
      const request = (url: string, header?: string, method = "POST") =>
        new Request(url, {
          method,
          headers: {
            ...(header ? { Authorization: header } : {}),
            "Content-Type": "application/json",
            "Content-Length": "2",
            Cookie: "owner-session-fixture",
          },
          ...(method === "POST" ? { body: "{}" } : {}),
        });
      expect(
        (
          await cloudTickRequest(
            request("https://fixture.invalid/api/internal/worker/tick"),
          )
        ).status,
      ).toBe(401);
      expect(
        (
          await cloudTickRequest(
            request(
              "https://fixture.invalid/api/internal/worker/tick?jobId=caller-controlled",
              "Bearer " + secret,
            ),
          )
        ).status,
      ).toBe(400);
      expect(
        (
          await cloudTickRequest(
            request(
              "https://fixture.invalid/api/internal/worker/tick",
              undefined,
              "GET",
            ),
          )
        ).status,
      ).toBe(401);
      await db().query(
        "update cloud_worker_control set enabled=true,work_enabled=false,admitted_minute=null,lease_token=null,lease_expires_at=null where mode='live'",
      );
      const response = await cloudTickRequest(
        request(
          "https://fixture.invalid/api/internal/worker/tick",
          "Bearer " + secret,
        ),
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual({ status: "completed" });
      await db().query(
        "update cloud_worker_control set admitted_minute=null where mode='live'",
      );
      const cronResponse = await cloudTickRequest(
        request(
          "https://fixture.invalid/api/internal/worker/tick",
          "Bearer " + secret,
          "GET",
        ),
      );
      expect(cronResponse.status).toBe(200);
      expect(await cronResponse.json()).toEqual({ status: "completed" });
    } finally {
      restoreEnvironment();
    }
  });
});
