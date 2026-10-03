import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { readFile, writeFile, chmod, mkdir } from "node:fs/promises";
import { randomBytes } from "node:crypto";
function run(command: string, args: string[], quiet = false) {
  const executable =
    command === "ffmpeg"
      ? process.env.FFMPEG_BIN ||
        (existsSync("/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg")
          ? "/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg"
          : "ffmpeg")
      : command === "ffprobe"
        ? process.env.FFPROBE_BIN ||
          (existsSync("/opt/homebrew/opt/ffmpeg-full/bin/ffprobe")
            ? "/opt/homebrew/opt/ffmpeg-full/bin/ffprobe"
            : "ffprobe")
        : command;
  const r = spawnSync(executable, args, {
    encoding: "utf8",
    env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1" },
    stdio: quiet ? "pipe" : "inherit",
  });
  if (r.error || r.status !== 0)
    throw new Error(
      `${command} ${args.join(" ")} failed. ${r.error?.message || ""}`,
    );
  return r.stdout;
}
try {
  for (const [bin, args] of [
    ["node", ["--version"]],
    ["pnpm", ["--version"]],
    ["docker", ["info"]],
    ["ffmpeg", ["-version"]],
    ["ffprobe", ["-version"]],
  ] as [string, string[]][]) {
    try {
      run(bin, args, true);
    } catch {
      throw new Error(
        `Missing or unavailable prerequisite: ${bin}. Install Node 22+, pnpm, FFmpeg, and a Docker-compatible runtime. On this Mac use: colima start --profile mediaflock --cpu 4 --memory 6 --disk 35`,
      );
    }
  }
  if (!run("ffmpeg", ["-hide_banner", "-filters"], true).includes("subtitles"))
    throw new Error(
      "Subtitle processing requires FFmpeg with libass. On macOS install the free keg-only runtime with brew install ffmpeg-full; on Linux install FFmpeg with libass. Set FFMPEG_BIN and FFPROBE_BIN for a custom runtime.",
    );
  console.log(
    "Prerequisites available. Starting isolated local Supabase (ports 55321/55322).",
  );
  run(
    "pnpm",
    [
      "supabase",
      "start",
      "-x",
      "studio,realtime,edge-runtime,logflare,vector,supavisor,imgproxy",
    ],
    true,
  );
  run("pnpm", ["supabase", "migration", "up", "--local"], true);
  const output = run("pnpm", ["supabase", "status", "--output", "json"], true);
  const data = JSON.parse(output.slice(output.indexOf("{")));
  let existing = "";
  try {
    existing = await readFile(".env.demo", "utf8");
  } catch {}
  if (existing && !existing.includes("MEDIAFLOCK_MODE=demo"))
    throw new Error(
      "Existing non-demo .env.demo found. Refusing to overwrite it. Use a separate local directory.",
    );
  const csrf =
    existing.match(/^CSRF_SECRET=(.+)$/m)?.[1] ||
    randomBytes(32).toString("hex");
  const encryption =
    existing.match(/^CREDENTIAL_ENCRYPTION_KEY=(.+)$/m)?.[1] ||
    randomBytes(32).toString("base64");
  const env = `MEDIAFLOCK_MODE=demo\nAPP_ORIGIN=http://127.0.0.1:3211\nDATABASE_URL=${data.DB_URL}\nSUPABASE_URL=${data.API_URL}\nSUPABASE_ANON_KEY=${data.ANON_KEY}\nSUPABASE_SERVICE_ROLE_KEY=${data.SERVICE_ROLE_KEY}\nCSRF_SECRET=${csrf}\nCREDENTIAL_ENCRYPTION_KEY=${encryption}\nWORKER_POLL_MS=1000\nMETRIC_HORIZONS=1,24,72,168\n`;
  if (!data.ANON_KEY || !data.SERVICE_ROLE_KEY)
    throw new Error(
      "Local Supabase status did not return expected authentication keys. See docs/local-demo.md.",
    );
  await writeFile(".env.demo", env, { mode: 0o600 });
  await chmod(".env.demo", 0o600);
  await mkdir("artifacts/logs", { recursive: true });
  process.env.MEDIAFLOCK_ENV_FILE = ".env.demo";
  run("pnpm", ["seed"]);
  console.log(
    "MediaFlock local setup complete. Run pnpm dev:demo and pnpm worker:demo. Demo sign-in: floyd@mediaflock.local / MediaFlock-demo-2026! (local only)",
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
