import { mkdir, readFile, writeFile, cp, chmod } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";
import { homedir } from "node:os";
import { parse } from "dotenv";
import { resolve, basename } from "node:path";

if (process.platform !== "darwin")
  throw new Error(
    "This service helper supports macOS. Use a process supervisor on Linux; see docs/deployment.md.",
  );
const source = process.cwd(),
  action = process.argv[2] || "status",
  domain = "gui/" + process.getuid!();
const directory = resolve(homedir(), "Library/LaunchAgents"),
  application = resolve(homedir(), "Library/Application Support/MediaFlock");
const xml = (s: string) =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
function launch(args: string[], optional = false) {
  try {
    return execFileSync("/bin/launchctl", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    if (!optional) throw error;
    return "";
  }
}
let runtime = source;
if (action === "install") {
  if (
    !existsSync(resolve(source, ".env.live")) ||
    !existsSync(resolve(source, "apps/web/.next/BUILD_ID"))
  )
    throw new Error(
      "Create .env.live and run a live pnpm build before installing.",
    );
  for (const name of ["web", "worker"]) {
    const file = resolve(
      directory,
      "org.mediaflock.personal." + name + ".plist",
    );
    if (
      existsSync(file) &&
      !(await readFile(file, "utf8")).includes(xml(source))
    )
      throw new Error("Existing service belongs to another checkout: " + name);
  }
  const buildId = (
    await readFile(resolve(source, "apps/web/.next/BUILD_ID"), "utf8")
  ).trim();
  if (!/^[a-zA-Z0-9_-]+$/.test(buildId))
    throw new Error("Invalid build identity.");
  runtime = resolve(application, "releases", buildId + "-" + Date.now());
  await mkdir(runtime, { recursive: true, mode: 0o700 });
  await chmod(application, 0o700);
  const entries = [
    "apps",
    "packages",
    "scripts",
    "supabase",
    "config",
    "vendor",
    "docs",
    "tools",
    "node_modules",
    "package.json",
    "pnpm-lock.yaml",
    "tsconfig.json",
    "components.json",
  ];
  for (const entry of entries)
    await cp(resolve(source, entry), resolve(runtime, entry), {
      recursive: true,
      dereference: false,
      verbatimSymlinks: true,
      filter: (path) =>
        basename(path) !== ".next-demo" &&
        ![
          resolve(source, "apps/web/.next/cache"),
          resolve(source, "apps/web/.next/dev"),
        ].includes(path) &&
        !path.includes("artifacts/deployment") &&
        !["original-brief.txt", "postforme-openapi.json"].includes(
          basename(path),
        ),
    });
  let env = await readFile(resolve(source, ".env.live"), "utf8");
  const caFile = parse(env).DATABASE_SSL_CA_FILE;
  if (caFile) {
    const copiedCa = resolve(runtime, "config/database-ca.crt");
    await cp(resolve(source, caFile), copiedCa);
    env = env.replace(
      /^DATABASE_SSL_CA_FILE=.+$/m,
      "DATABASE_SSL_CA_FILE=" + copiedCa,
    );
  }
  await writeFile(resolve(runtime, ".env.live"), env, { mode: 0o600 });
  await mkdir(resolve(runtime, "artifacts/logs"), {
    recursive: true,
    mode: 0o700,
  });
  await writeFile(
    resolve(runtime, "release.json"),
    JSON.stringify(
      { buildId, source, installedAt: new Date().toISOString() },
      null,
      2,
    ),
  );
  if (existsSync(resolve(application, "current.json")))
    await cp(
      resolve(application, "current.json"),
      resolve(runtime, "previous.json"),
    );
}
const require = createRequire(resolve(runtime, "package.json"));
const jobs = [
  {
    name: "web",
    args:
      action === "install"
        ? [
            require.resolve("next/dist/bin/next"),
            "start",
            "apps/web",
            "--hostname",
            "127.0.0.1",
            "--port",
            "3210",
          ]
        : [],
  },
  {
    name: "worker",
    args:
      action === "install"
        ? ["--import", require.resolve("tsx"), "apps/worker/main.ts"]
        : [],
  },
];
for (const job of jobs) {
  const label = "org.mediaflock.personal." + job.name,
    file = resolve(directory, label + ".plist"),
    target = domain + "/" + label;
  if (action === "install") {
    const node = execFileSync("/usr/bin/which", ["node"], {
      encoding: "utf8",
    }).trim();
    const plist = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<!-- Managed source: ${xml(source)} -->\n<plist version="1.0"><dict><key>Label</key><string>${label}</string><key>ProgramArguments</key><array>${[node, ...job.args].map((x) => `<string>${xml(x)}</string>`).join("")}</array><key>WorkingDirectory</key><string>${xml(runtime)}</string><key>EnvironmentVariables</key><dict><key>MEDIAFLOCK_ENV_FILE</key><string>${xml(resolve(runtime, ".env.live"))}</string><key>NODE_ENV</key><string>production</string><key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string></dict><key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>10</integer><key>StandardOutPath</key><string>${xml(resolve(runtime, "artifacts/logs/" + job.name + "-service.log"))}</string><key>StandardErrorPath</key><string>${xml(resolve(runtime, "artifacts/logs/" + job.name + "-service-error.log"))}</string></dict></plist>\n`;
    await mkdir(directory, { recursive: true });
    if (existsSync(file))
      await cp(file, resolve(runtime, job.name + ".previous.plist"));
    launch(["bootout", target], true);
    for (let check = 0; check < 150 && launch(["print", target], true); check++)
      await delay(200);
    if (launch(["print", target], true))
      throw new Error("Previous service did not finish shutdown: " + job.name);
    await writeFile(file, plist, { mode: 0o600 });
    // launchd can return before a stopped service has left the domain.
    // Retry only while that label is absent and the validated plist is unchanged.
    let started = false;
    for (let attempt = 0; attempt < 4; attempt++) {
      await delay(500 * (attempt + 1));
      try {
        launch(["bootstrap", domain, file]);
        started = true;
        break;
      } catch (error) {
        if (launch(["print", target], true)) throw error;
        if (attempt === 3) throw error;
      }
    }
    if (!started) throw new Error("Service did not start: " + job.name);
    console.log(job.name + " service installed.");
  } else if (action === "restart") {
    launch(["kickstart", "-k", target]);
    console.log(job.name + " restarting.");
  } else if (action === "stop") {
    launch(["bootout", target], true);
    console.log(job.name + " stopped.");
  } else if (action === "start") {
    launch(["bootstrap", domain, file]);
    console.log(job.name + " started.");
  } else if (action === "status") {
    const status = launch(["print", target], true);
    console.log(
      job.name +
        ": " +
        (status.match(/state = (.+)/)?.[1] || "not loaded") +
        "; pid " +
        (status.match(/pid = (\d+)/)?.[1] || "none"),
    );
  } else throw new Error("Use install, status, restart, stop or start.");
}

if (action === "install")
  await writeFile(
    resolve(application, "current.json"),
    JSON.stringify(
      {
        runtime,
        buildId: (
          await readFile(resolve(runtime, "apps/web/.next/BUILD_ID"), "utf8")
        ).trim(),
        source,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
