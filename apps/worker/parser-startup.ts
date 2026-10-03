import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import {
  cleanupMediaParserContainers,
  mediaParserStatus,
} from "../../packages/media/parser";

const run = promisify(execFile);
export async function prepareMediaWorker() {
  if (process.env.MEDIAFLOCK_MEDIA_ISOLATION !== "docker") {
    if (process.env.MEDIAFLOCK_MODE !== "demo")
      throw new Error("Live media processing requires Docker isolation.");
    return;
  }
  const env: NodeJS.ProcessEnv = {
    PATH: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin",
    HOME: homedir(),
    NODE_ENV: "production",
  };
  const context = process.env.MEDIAFLOCK_DOCKER_CONTEXT || "colima-mediaflock";
  const docker = existsSync("/opt/homebrew/bin/docker")
    ? "/opt/homebrew/bin/docker"
    : "docker";
  try {
    await run(
      docker,
      ["--context", context, "info", "--format", "{{.ServerVersion}}"],
      { timeout: 20000, maxBuffer: 65536, env },
    );
  } catch (error) {
    if (process.platform !== "darwin" || context !== "colima-mediaflock")
      throw error;
    const colima = existsSync("/opt/homebrew/bin/colima")
      ? "/opt/homebrew/bin/colima"
      : "colima";
    await run(
      colima,
      [
        "start",
        "--profile",
        "mediaflock",
        "--cpu",
        "4",
        "--memory",
        "6",
        "--disk",
        "35",
      ],
      { timeout: 180000, maxBuffer: 262144, env },
    );
  }
  await cleanupMediaParserContainers();
  const status = await mediaParserStatus();
  console.log(JSON.stringify({ event: "worker.media_parser", ...status }));
}
