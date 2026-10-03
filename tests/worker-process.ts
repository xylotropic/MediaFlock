import { claimJob, processJob } from "../apps/worker/publishing";
import { closeDb } from "../packages/db";
const job = await claimJob(process.argv[2]);
if (job) await processJob(job);
await closeDb();
