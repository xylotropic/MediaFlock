import { spawn } from "node:child_process";
import { existsSync, constants } from "node:fs";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  writeFile,
  readdir,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, extname, isAbsolute, join } from "node:path";
import { randomUUID } from "node:crypto";

const MAX_FILE_BYTES = 50 * 1024 * 1024;
export const DEFAULT_MEDIA_PARSER_IMAGE =
  "mediaflock-media-parser:debian-bookworm-v1-dee25505aaaf";
const CONTAINER_LABEL = "mediaflock.parser";
const activeContainers = new Set<string>();
const activeStagingRoots = new Set<string>();
const stagingBase = join(
  homedir(),
  "Library",
  "Caches",
  "Mediaflock",
  "parser",
);
async function stagingRoot(prefix: string) {
  await mkdir(stagingBase, { recursive: true, mode: 0o700 });
  const info = await lstat(stagingBase);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    (process.getuid && info.uid !== process.getuid()) ||
    (await realpath(stagingBase)) !== stagingBase
  )
    throw new Error("Media parser staging directory is not private.");
  await chmod(stagingBase, 0o700);
  const root = await mkdtemp(join(stagingBase, prefix));
  activeStagingRoots.add(root);
  return root;
}
async function removeStagingRoot(root: string) {
  try {
    await rm(root, { recursive: true, force: true });
  } finally {
    activeStagingRoots.delete(root);
  }
}
let lastOrphanCleanup = 0;

function isolationMode() {
  const mode = process.env.MEDIAFLOCK_MEDIA_ISOLATION;
  if (mode === "docker") return "docker";
  if (mode && mode !== "host")
    throw new Error("Unknown media parser isolation mode.");
  // A live or unspecified mode can never silently execute an uploaded parser on
  // the Mac. Explicit host mode exists only for local demo fixture generation.
  if (process.env.MEDIAFLOCK_MODE !== "demo")
    throw new Error(
      "Public media processing requires MEDIAFLOCK_MEDIA_ISOLATION=docker.",
    );
  return "host";
}
function dockerSettings() {
  const context = process.env.MEDIAFLOCK_DOCKER_CONTEXT || "colima-mediaflock";
  const image =
    process.env.MEDIAFLOCK_MEDIA_IMAGE || DEFAULT_MEDIA_PARSER_IMAGE;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,80}$/.test(context))
    throw new Error("Invalid media Docker context.");
  if (
    !/^sha256:[a-f0-9]{64}$/.test(image) &&
    !/^mediaflock-media-parser:[a-z0-9][a-z0-9_.-]{0,100}$/.test(image)
  )
    throw new Error(
      "Use an installed, versioned Mediaflock parser image or its immutable image ID.",
    );
  const executable =
    [
      "/opt/homebrew/bin/docker",
      "/usr/local/bin/docker",
      "/usr/bin/docker",
    ].find(existsSync) || "docker";
  return { context, image, executable };
}

function boundedProcess(
  executable: string,
  args: string[],
  timeout: number,
  maxOutput: number,
  binary: true,
): Promise<Buffer>;
function boundedProcess(
  executable: string,
  args: string[],
  timeout: number,
  maxOutput: number,
  binary?: false,
): Promise<string>;
async function boundedProcess(
  executable: string,
  args: string[],
  timeout: number,
  maxOutput: number,
  binary = false,
) {
  return new Promise<string | Buffer>((resolveResult, reject) => {
    const child = spawn(executable, args, {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      // Docker CLI needs its own context configuration; no application, Storage,
      // database, provider, session, or inherited Docker override is passed.
      env: {
        PATH: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin",
        HOME: homedir(),
        NODE_ENV: "production",
      },
    });
    const stdout: Buffer[] = [];
    let stderr = "",
      bytes = 0,
      failure: Error | undefined;
    const stop = (error: Error) => {
      failure ||= error;
      child.kill("SIGKILL");
    };
    const timer = setTimeout(
      () => stop(new Error("Media process exceeded runtime limit.")),
      timeout,
    );
    const collect = (chunk: Buffer, output: boolean) => {
      bytes += chunk.length;
      if (bytes > maxOutput) stop(new Error("Media output exceeded limit."));
      else if (output) stdout.push(chunk);
      else stderr += chunk.toString();
    };
    child.stdout.on("data", (chunk: Buffer) => collect(chunk, true));
    child.stderr.on("data", (chunk: Buffer) => collect(chunk, false));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (failure) reject(failure);
      else if (code === 0)
        resolveResult(
          binary ? Buffer.concat(stdout) : Buffer.concat(stdout).toString(),
        );
      else
        reject(
          new Error(
            `Media processing failed (exit ${code}): ${stderr.slice(-600)}`,
          ),
        );
    });
  });
}
async function docker(
  args: string[],
  timeout = 20000,
  maxOutput = 2 * 1024 * 1024,
) {
  const config = dockerSettings();
  return boundedProcess(
    config.executable,
    ["--context", config.context, ...args],
    timeout,
    maxOutput,
  );
}

async function dockerBinary(
  args: string[],
  timeout: number,
  maxOutput: number,
) {
  const config = dockerSettings();
  return boundedProcess(
    config.executable,
    ["--context", config.context, ...args],
    timeout,
    maxOutput,
    true,
  );
}

export async function cleanupMediaParserContainers() {
  const ids = (
    await docker(["ps", "-aq", "--filter", `label=${CONTAINER_LABEL}=true`])
  )
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  for (const id of ids) {
    if (!/^[a-f0-9]{12,64}$/.test(id) || activeContainers.has(id)) continue;
    const [item] = JSON.parse(await docker(["inspect", id]));
    const labels = item.Config?.Labels || {};
    if (
      labels[CONTAINER_LABEL] !== "true" ||
      labels[`${CONTAINER_LABEL}.version`] !== "1" ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
        labels[`${CONTAINER_LABEL}.job`] || "",
      ) ||
      item.Name !== `/mediaflock-parser-${labels[`${CONTAINER_LABEL}.job`]}` ||
      !["demo", "live"].includes(labels[`${CONTAINER_LABEL}.mode`]) ||
      !Number.isFinite(Date.parse(item.Created)) ||
      Date.now() - Date.parse(item.Created) < 5 * 60 * 1000
    )
      continue;
    await docker(["rm", "-f", id]);
  }
  if (existsSync(stagingBase)) {
    const baseInfo = await lstat(stagingBase);
    if (
      !baseInfo.isDirectory() ||
      baseInfo.isSymbolicLink() ||
      (await realpath(stagingBase)) !== stagingBase ||
      (process.getuid && baseInfo.uid !== process.getuid())
    )
      throw new Error(
        "Media parser staging cleanup refused a foreign directory.",
      );
    for (const entry of await readdir(stagingBase, { withFileTypes: true })) {
      if (
        !entry.isDirectory() ||
        !/^mediaflock-parser-[a-zA-Z0-9_-]+$/.test(entry.name)
      )
        continue;
      const root = join(stagingBase, entry.name);
      const info = await lstat(root);
      if (
        !activeStagingRoots.has(root) &&
        Date.now() - info.mtimeMs >= 5 * 60 * 1000
      )
        await rm(root, { recursive: true, force: true });
    }
  }
  lastOrphanCleanup = Date.now();
}

async function installedImage() {
  const { image } = dockerSettings();
  try {
    const [item] = JSON.parse(await docker(["image", "inspect", image]));
    if (
      !/^sha256:[a-f0-9]{64}$/.test(item.Id || "") ||
      item.Config?.Labels?.[CONTAINER_LABEL] !== "true" ||
      item.Config?.User !== "65532:65532" ||
      Object.keys(item.Config?.Volumes || {}).length
    )
      throw new Error(
        "Parser image does not match the trusted image configuration.",
      );
    return item.Id as string;
  } catch (error) {
    throw new Error(
      "Media parser isolation is unavailable. Start the dedicated Colima profile and install the pinned parser image; host parsing is refused.",
      { cause: error },
    );
  }
}

async function withContainer<T>(
  inputDirectory: string,
  operation: (id: string) => Promise<T>,
) {
  const imageId = await installedImage();
  if (Date.now() - lastOrphanCleanup > 60 * 1000)
    await cleanupMediaParserContainers();
  const job = randomUUID(),
    name = `mediaflock-parser-${job}`;
  let id: string | undefined;
  try {
    // The host input is a freshly staged directory containing only this job's
    // required files. Writable locations live entirely inside bounded tmpfs.
    id = (
      await docker([
        "create",
        "--pull=never",
        "--name",
        name,
        "--label",
        `${CONTAINER_LABEL}=true`,
        "--label",
        `${CONTAINER_LABEL}.version=1`,
        "--label",
        `${CONTAINER_LABEL}.job=${job}`,
        "--label",
        `${CONTAINER_LABEL}.mode=${process.env.MEDIAFLOCK_MODE === "demo" ? "demo" : "live"}`,
        "--network",
        "none",
        "--read-only",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges",
        "--user",
        "65532:65532",
        "--memory",
        "512m",
        "--memory-swap",
        "512m",
        "--cpus",
        "2",
        "--pids-limit",
        "64",
        "--ulimit",
        "nofile=256:256",
        "--ulimit",
        "core=0:0",
        "--tmpfs",
        "/work:rw,nosuid,nodev,noexec,size=134217728,mode=1777",
        "--tmpfs",
        "/tmp:rw,nosuid,nodev,noexec,size=16777216,mode=1777",
        "--mount",
        `type=bind,src=${inputDirectory},dst=/input,readonly,bind-propagation=rprivate`,
        "--env",
        "HOME=/tmp",
        "--env",
        "LANG=C.UTF-8",
        "--entrypoint",
        "/bin/sleep",
        imageId,
        "infinity",
      ])
    ).trim();
    if (!/^[a-f0-9]{64}$/.test(id))
      throw new Error("Invalid parser container identity.");
    activeContainers.add(id);
    await docker(["start", id]);
    return await operation(id);
  } finally {
    // Killing only `docker exec` would leave the parser running in the daemon.
    // Delete the known job container itself on success, rejection, or timeout.
    if (id) {
      try {
        await docker(["rm", "-f", id], 20000);
      } finally {
        activeContainers.delete(id);
      }
    } else {
      // If create completed after a CLI timeout, its unique preselected name is
      // still ours. This cannot target any unrelated container.
      await docker(["rm", "-f", name], 20000).catch(() => undefined);
    }
  }
}

async function temporaryJobDirectory(path: string) {
  if (!isAbsolute(path))
    throw new Error("Isolated media requires an absolute temporary job path.");
  const parent = dirname(path),
    canonical = await realpath(parent);
  const temporaryRoot = await realpath(tmpdir());
  const info = await lstat(parent);
  if (
    dirname(canonical) !== temporaryRoot ||
    !/^mediaflock-[a-zA-Z0-9_-]+$/.test(basename(canonical)) ||
    !info.isDirectory() ||
    (info.mode & 0o777) !== 0o700 ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}$/.test(basename(path))
  )
    throw new Error(
      "Media parser paths must belong to a private Mediaflock temporary job directory.",
    );
}

async function isolateArguments(
  bin: "ffmpeg" | "ffprobe",
  args: string[],
  inputDirectory: string,
) {
  const mapped = [...args],
    staged = new Map<string, string>();
  let totalBytes = 0;
  const stage = async (path: string) => {
    if (staged.has(path)) return staged.get(path)!;
    await temporaryJobDirectory(path);
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_FILE_BYTES)
      throw new Error(
        "Only bounded regular job input files can enter the media parser.",
      );
    totalBytes += info.size;
    if (totalBytes > MAX_FILE_BYTES + 1024 * 1024)
      throw new Error("Media parser input exceeded limit.");
    const extension = extname(path);
    const filename = `input-${staged.size}${/^[.a-zA-Z0-9]{0,10}$/.test(extension) ? extension : ""}`;
    const destination = join(inputDirectory, filename);
    await copyFile(path, destination, constants.COPYFILE_EXCL);
    await chmod(destination, 0o444);
    const inside = `/input/${filename}`;
    staged.set(path, inside);
    return inside;
  };
  if (bin === "ffprobe") {
    if (!args.length) throw new Error("A media probe requires its input path.");
    mapped[mapped.length - 1] = await stage(args[args.length - 1]);
    return { args: mapped, output: undefined };
  }
  let format = "";
  for (let i = 0; i < mapped.length - 1; i++) {
    if (mapped[i] === "-f") format = mapped[++i];
    else if (mapped[i] === "-i") {
      const value = mapped[++i];
      if (format !== "lavfi") mapped[i] = await stage(value);
      format = "";
    } else if (mapped[i] === "-vf") {
      const value = mapped[++i];
      const subtitle = /subtitles=filename='((?:\\.|[^'])*)'/.exec(value);
      if (subtitle) {
        const path = subtitle[1].replace(/\\(['\\:])/g, "$1");
        const inside = await stage(path);
        mapped[i] = value.replace(
          subtitle[0],
          `subtitles=filename='${inside}'`,
        );
      }
    }
  }
  const output = args[args.length - 1];
  if (output === "-") return { args: mapped, output: undefined };
  await temporaryJobDirectory(output);
  if (!/\.(mp4|png|jpe?g|webp)$/.test(output))
    throw new Error("Unsupported media output path.");
  try {
    await lstat(output);
    throw new Error("Media parser output must be a new file.");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const inside = `/work/result${extname(output)}`;
  mapped[mapped.length - 1] = inside;
  return { args: mapped, output: { host: output, inside } };
}

export async function runMediaProcess(
  bin: string,
  args: string[],
  timeout = 120000,
  maxOutput = 2 * 1024 * 1024,
) {
  if (!["ffmpeg", "ffprobe"].includes(bin))
    throw new Error("Only FFmpeg and ffprobe are supported media parsers.");
  if (
    !Number.isFinite(timeout) ||
    timeout <= 0 ||
    timeout > 120000 ||
    !Number.isFinite(maxOutput) ||
    maxOutput <= 0 ||
    maxOutput > 4 * 1024 * 1024
  )
    throw new Error("Invalid media parser execution limits.");
  if (isolationMode() === "host") {
    const configured =
      bin === "ffmpeg" ? process.env.FFMPEG_BIN : process.env.FFPROBE_BIN;
    const installed = `/opt/homebrew/opt/ffmpeg-full/bin/${bin}`;
    return boundedProcess(
      configured || (existsSync(installed) ? installed : bin),
      args,
      timeout,
      maxOutput,
    );
  }
  const root = await stagingRoot("mediaflock-parser-");
  try {
    const inputs = join(root, "inputs");
    await mkdir(inputs, { mode: 0o755 });
    const plan = await isolateArguments(
      bin as "ffmpeg" | "ffprobe",
      args,
      inputs,
    );
    return await withContainer(inputs, async (id) => {
      const output = await docker(
        ["exec", id, `/usr/bin/${bin}`, ...plan.args],
        timeout,
        maxOutput,
      );
      if (plan.output) {
        // Docker's archive API cannot copy this daemon's tmpfs files. A trusted
        // fixed helper stops decoder descendants, rejects symlinks/oversize,
        // and streams only this exact output through a bounded binary pipe.
        const bytes = await dockerBinary(
          [
            "exec",
            id,
            "/usr/local/bin/mediaflock-export-output",
            plan.output.inside,
          ],
          20000,
          MAX_FILE_BYTES,
        );
        const stagedOutput = join(root, "output");
        await writeFile(stagedOutput, bytes, { flag: "wx", mode: 0o600 });
        await copyFile(stagedOutput, plan.output.host, constants.COPYFILE_EXCL);
        await chmod(plan.output.host, 0o600);
      }
      return output;
    });
  } finally {
    await removeStagingRoot(root);
  }
}

export async function mediaParserStatus() {
  const isolation = isolationMode();
  if (isolation === "host")
    return { isolation, ready: true, imageId: null, version: null };
  const imageId = await installedImage();
  const root = await stagingRoot("mediaflock-parser-health-");
  try {
    const inputs = join(root, "inputs");
    await mkdir(inputs, { mode: 0o755 });
    const version = await withContainer(inputs, (id) =>
      docker(["exec", id, "/usr/bin/ffmpeg", "-version"]),
    );
    return { isolation, ready: true, imageId, version: version.split("\n")[0] };
  } finally {
    await removeStagingRoot(root);
  }
}

// Fixed diagnostic actions, imported directly by local tests only. No API route
// accepts a command or exposes this hook, and live environments cannot use it.
export async function testParserIsolation(
  action:
    | "inspect"
    | "outside-file"
    | "network"
    | "tmpfs"
    | "timeout"
    | "output-limit"
    | "environment"
    | "oversize-output"
    | "symlink-output"
    | "descendant",
  value = "",
) {
  if (
    process.env.NODE_ENV !== "test" ||
    process.env.MEDIAFLOCK_MODE !== "demo" ||
    isolationMode() !== "docker"
  )
    throw new Error(
      "Parser diagnostics require an isolated local test environment.",
    );
  const root = await stagingRoot("mediaflock-parser-canary-");
  try {
    const inputs = join(root, "inputs");
    await mkdir(inputs, { mode: 0o755 });
    return await withContainer(inputs, async (id) => {
      if (action === "inspect")
        return JSON.parse(await docker(["inspect", id]))[0];
      if (action === "oversize-output") {
        await docker([
          "exec",
          id,
          "/bin/dd",
          "if=/dev/zero",
          "of=/work/result.mp4",
          "bs=1048576",
          "count=51",
        ]);
        return dockerBinary(
          [
            "exec",
            id,
            "/usr/local/bin/mediaflock-export-output",
            "/work/result.mp4",
          ],
          20000,
          MAX_FILE_BYTES,
        );
      }
      if (action === "symlink-output") {
        await docker([
          "exec",
          id,
          "/bin/ln",
          "-s",
          "/etc/passwd",
          "/work/result.mp4",
        ]);
        return dockerBinary(
          [
            "exec",
            id,
            "/usr/local/bin/mediaflock-export-output",
            "/work/result.mp4",
          ],
          20000,
          MAX_FILE_BYTES,
        );
      }
      if (action === "descendant") {
        const pid = (
          await docker([
            "exec",
            id,
            "/usr/bin/python3",
            "-c",
            "import subprocess; open('/work/result.mp4','wb').write(b'trusted-canary'); p=subprocess.Popen(['/bin/sleep','30'],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL); print(p.pid)",
          ])
        ).trim();
        if (!/^\d+$/.test(pid))
          throw new Error("Invalid diagnostic child process.");
        const output = await dockerBinary(
          [
            "exec",
            id,
            "/usr/local/bin/mediaflock-export-output",
            "/work/result.mp4",
          ],
          20000,
          MAX_FILE_BYTES,
        );
        const status = await docker([
          "exec",
          id,
          "/bin/cat",
          `/proc/${pid}/status`,
        ]);
        return { output: output.toString(), status };
      }
      if (action === "outside-file")
        return docker(["exec", id, "/bin/cat", value]);
      if (action === "network")
        return docker(
          [
            "exec",
            id,
            "/usr/bin/ffprobe",
            "-v",
            "error",
            "-rw_timeout",
            "1000000",
            "-i",
            value,
          ],
          3000,
        );
      if (action === "tmpfs")
        return docker(
          [
            "exec",
            id,
            "/bin/dd",
            "if=/dev/zero",
            "of=/work/quota-canary",
            "bs=1048576",
            "count=129",
          ],
          10000,
        );
      if (action === "timeout")
        return docker(["exec", id, "/bin/sleep", "30"], 100);
      if (action === "output-limit")
        return docker(
          ["exec", id, "/usr/bin/head", "-c", "4096", "/dev/zero"],
          3000,
          100,
        );
      return docker(["exec", id, "/usr/bin/env"]);
    });
  } finally {
    await removeStagingRoot(root);
  }
}
