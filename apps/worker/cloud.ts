import { randomUUID, timingSafeEqual } from "node:crypto";
import { performance } from "node:perf_hooks";
import { db, withWorkerDatabase } from "../../packages/db";
import { getConfig } from "../../packages/domain/config";
import { WorkerDeadline, withWorkerBudget } from "../../packages/worker/budget";
import { drainPublications } from "./publishing";
import { collectDueMetrics } from "./analytics";

type Lane = "metrics" | "publishing";
type Tasks = Record<Lane, () => Promise<number>>;
const tasks: Tasks = {
  publishing: () => drainPublications(1),
  metrics: () => collectDueMetrics(undefined, 1),
};
const taskBudget = 55000;
const cycleBudget = 100000;
// Infrastructure status is visible across workspaces. Keep provider messages in
// their existing workspace records, never in this shared health summary.
const cloudFailure = (error: unknown) =>
  error instanceof WorkerDeadline
    ? "Cloud operation reached its time limit. Retained work needs recovery."
    : "Cloud work could not complete. Review delivery and measurement status.";
export function cloudAuthorization(
  header: string | null,
  secret: string | undefined,
) {
  if (
    !secret ||
    !/^[A-Za-z0-9_-]{43}$/.test(secret) ||
    Buffer.from(secret, "base64url").length !== 32 ||
    Buffer.from(secret, "base64url").toString("base64url") !== secret
  )
    return false;
  const supplied = header?.startsWith("Bearer ") ? header.slice(7) : "";
  const expected = Buffer.from(secret);
  const actual = Buffer.from(supplied);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// The request cannot select work or acquire approval. These adapters are replaced
// only by isolated tests; the production route always uses the shared workers.
export async function runCloudTick(adapters: Tasks = tasks) {
  return withWorkerBudget({ provider: 95000, database: 110000 }, () =>
    withWorkerDatabase(() => performCloudTick(adapters)),
  );
}
async function performCloudTick(adapters: Tasks) {
  const started = performance.now();
  const mode = getConfig().mode;
  const token = randomUUID();
  const deployment = process.env.VERCEL_DEPLOYMENT_ID || "local-isolated";
  const claim = (
    await db().query(
      `update cloud_worker_control set lease_token=$2,lease_expires_at=clock_timestamp()+interval '150 seconds',admitted_minute=date_trunc('minute',clock_timestamp()),last_started_at=clock_timestamp(),next_lane=case when next_lane='metrics' then 'publishing' else 'metrics' end,deployment_id=$3
      where mode=$1 and enabled and (lease_expires_at is null or lease_expires_at<clock_timestamp()) and admitted_minute is distinct from date_trunc('minute',clock_timestamp())
      returning work_enabled,case when next_lane='metrics' then 'publishing' else 'metrics' end as first_lane`,
      [mode, token, deployment],
    )
  ).rows[0];
  if (!claim) return { status: "skipped" as const };
  await db().query(
    "insert into cloud_worker_runs(id,mode,deployment_id) values($1,$2,$3)",
    [token, mode, deployment],
  );
  const results: {
    lane: Lane;
    outcome: string;
    reportedCount?: number;
    error?: string;
  }[] = [];
  let error: string | null = null;
  try {
    const order: Lane[] =
      claim.first_lane === "metrics"
        ? ["metrics", "publishing"]
        : ["publishing", "metrics"];
    for (const lane of order) {
      const gate = (
        await db().query(
          "select enabled,work_enabled from cloud_worker_control where mode=$1 and lease_token=$2 and lease_expires_at>clock_timestamp()",
          [mode, token],
        )
      ).rows[0];
      if (!gate?.enabled || !gate.work_enabled) {
        results.push({ lane, outcome: "disabled" });
        continue;
      }
      if (cycleBudget - (performance.now() - started) < taskBudget + 5000) {
        results.push({ lane, outcome: "budget_skipped" });
        continue;
      }
      try {
        const reportedCount = await withWorkerBudget(
          { provider: 45000, database: taskBudget },
          () => withWorkerDatabase(adapters[lane]),
        );
        results.push({
          lane,
          outcome: "checked",
          reportedCount,
        });
      } catch (e) {
        const message = cloudFailure(e);
        results.push({ lane, outcome: "failed", error: message });
        error = message;
      }
    }
    await db().query(
      "update cloud_worker_runs set completed_at=clock_timestamp(),outcome=$2,lanes=$3 where id=$1 and exists(select 1 from cloud_worker_control where mode=$4 and lease_token=$1 and lease_expires_at>clock_timestamp())",
      [token, error ? "failed" : "completed", JSON.stringify(results), mode],
    );
    const completed = await db().query(
      "update cloud_worker_control set last_completed_at=clock_timestamp(),last_result=$3,lease_token=null,lease_expires_at=null,last_work_error=coalesce($4,last_work_error),last_work_error_at=case when $4::text is null then last_work_error_at else clock_timestamp() end where mode=$1 and lease_token=$2 and lease_expires_at>clock_timestamp()",
      [mode, token, JSON.stringify(results), error],
    );
    if (completed.rowCount !== 1) return { status: "skipped" as const };
    await db().query(
      "delete from cloud_worker_runs where mode=$1 and started_at<clock_timestamp()-interval '7 days'",
      [mode],
    );
    return { status: error ? ("failed" as const) : ("completed" as const) };
  } catch (e) {
    const message = cloudFailure(e);
    await db().query(
      "update cloud_worker_control set last_work_error=$3,last_work_error_at=clock_timestamp(),lease_token=null,lease_expires_at=null where mode=$1 and lease_token=$2 and lease_expires_at>clock_timestamp()",
      [mode, token, message],
    );
    return { status: "failed" as const };
  }
}

export async function cloudTickRequest(request: Request) {
  const reply = (status: number, result: string) =>
    Response.json(
      { status: result },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  if (
    !["POST", "GET"].includes(request.method) ||
    process.env.MEDIAFLOCK_MODE !== "live" ||
    !cloudAuthorization(
      request.headers.get("authorization"),
      process.env.CRON_SECRET,
    )
  )
    return reply(401, "unauthorized");
  if (new URL(request.url).search) return reply(400, "invalid_request");
  if (request.method === "GET") {
    if (request.body) return reply(400, "invalid_request");
    try {
      const result = await runCloudTick();
      return reply(result.status === "failed" ? 503 : 200, result.status);
    } catch {
      return reply(503, "unavailable");
    }
  }
  if (
    request.headers.get("content-type")?.split(";")[0] !== "application/json" ||
    request.headers.get("content-length") !== "2"
  )
    return reply(400, "invalid_request");
  const reader = request.body?.getReader();
  if (!reader) return reply(400, "invalid_request");
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    void reader.cancel().catch(() => {});
  }, 2000);
  try {
    const bytes: number[] = [];
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      if (part.value.byteLength > 2 - bytes.length) {
        await reader.cancel();
        return reply(400, "invalid_request");
      }
      bytes.push(...part.value);
    }
    if (timedOut || Buffer.from(bytes).toString() !== "{}")
      return reply(400, "invalid_request");
  } catch {
    return reply(400, "invalid_request");
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }
  try {
    const result = await runCloudTick();
    return reply(result.status === "failed" ? 503 : 200, result.status);
  } catch {
    return reply(503, "unavailable");
  }
}
