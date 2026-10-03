import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { db, closeDb } from "../../packages/db";
import { getConfig } from "../../packages/domain/config";
import { safeError } from "../../packages/domain/errors";
import { drainPublications } from "./publishing";
import { collectDueMetrics } from "./analytics";
import { processMediaQueue } from "./media";
import { prepareMediaWorker } from "./parser-startup";
import { cleanupMediaParserContainers } from "../../packages/media/parser";
let stopping = false;
process.on("SIGTERM", () => {
  stopping = true;
});
process.on("SIGINT", () => {
  stopping = true;
});
const id = "worker-" + randomUUID().slice(0, 8),
  once = process.argv.includes("--once");
async function main() {
  getConfig();
  await prepareMediaWorker();
  await db().query(
    "insert into worker_health(id,started_at,heartbeat_at,status) values($1,now(),now(),'running')",
    [id],
  );
  console.log(
    JSON.stringify({ event: "worker.started", id, mode: getConfig().mode }),
  );
  let cycles = 0;
  let lastParserCleanupAt = Date.now();
  let heartbeatPending = false;
  const heartbeat = setInterval(() => {
    if (heartbeatPending) return;
    heartbeatPending = true;
    void db()
      .query("update worker_health set heartbeat_at=now() where id=$1", [id])
      .catch(() => console.error("Worker heartbeat could not be saved."))
      .finally(() => {
        heartbeatPending = false;
      });
  }, 10000);
  heartbeat.unref();
  while (!stopping) {
    try {
      if (
        process.env.MEDIAFLOCK_MEDIA_ISOLATION === "docker" &&
        Date.now() - lastParserCleanupAt >= 60000
      ) {
        lastParserCleanupAt = Date.now();
        await cleanupMediaParserContainers();
      }
      const publications = await drainPublications(20),
        media = await processMediaQueue(3),
        metrics = await collectDueMetrics();
      await db().query(
        "update worker_health set heartbeat_at=now(),jobs_processed=jobs_processed+$1,last_error=null where id=$2",
        [publications + media + metrics, id],
      );
      if (publications || media || metrics)
        console.log(
          JSON.stringify({
            event: "worker.cycle",
            publications,
            media,
            metrics,
          }),
        );
    } catch (e) {
      await db().query(
        "update worker_health set heartbeat_at=now(),last_error=$1 where id=$2",
        [safeError(e), id],
      );
      console.error(
        JSON.stringify({ event: "worker.error", message: safeError(e) }),
      );
    }
    if (once && ++cycles >= 4) break;
    await delay(
      Math.min(
        10000,
        Math.max(250, Number(process.env.WORKER_POLL_MS) || 1000),
      ),
    );
  }
  clearInterval(heartbeat);
  await db().query(
    "update worker_health set status='stopped',heartbeat_at=now() where id=$1",
    [id],
  );
  await closeDb();
  console.log(JSON.stringify({ event: "worker.stopped", id }));
}
main().catch((e) => {
  console.error(safeError(e));
  process.exitCode = 1;
});
