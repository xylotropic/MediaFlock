import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile, symlink } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import {
  DEFAULT_MEDIA_PARSER_IMAGE,
  mediaParserStatus,
  runMediaProcess,
  testParserIsolation,
} from "../packages/media/parser";
import { ffmpegArgs, probeBytes } from "../packages/media";
import { mediaRecipe } from "../packages/schemas";

const dockerExecutable =
  ["/opt/homebrew/bin/docker", "/usr/local/bin/docker", "/usr/bin/docker"].find(
    existsSync,
  ) || "docker";
const dockerContext =
  process.env.MEDIAFLOCK_DOCKER_CONTEXT || "colima-mediaflock";
const dockerImage =
  process.env.MEDIAFLOCK_MEDIA_IMAGE || DEFAULT_MEDIA_PARSER_IMAGE;
const parserAvailable =
  spawnSync(
    dockerExecutable,
    ["--context", dockerContext, "image", "inspect", dockerImage],
    { stdio: "ignore", timeout: 5000 },
  ).status === 0;
// Local demo/CI installs may omit Docker. Skips are explicit in test output.
// Requested Docker checks never become a silent success when unavailable.
const skipDockerTests =
  !parserAvailable && process.env.MEDIAFLOCK_MEDIA_ISOLATION !== "docker";

let dir: string, source: string, originalHash: string, server: Server;
let networkRequests = 0;
const previous = {
  mode: process.env.MEDIAFLOCK_MODE,
  isolation: process.env.MEDIAFLOCK_MEDIA_ISOLATION,
  image: process.env.MEDIAFLOCK_MEDIA_IMAGE,
};
const hash = (buffer: Buffer) =>
  createHash("sha256").update(buffer).digest("hex");

beforeAll(async () => {
  process.env.MEDIAFLOCK_MODE = "demo";
  process.env.MEDIAFLOCK_MEDIA_ISOLATION = "host";
  dir = await mkdtemp(join(tmpdir(), "mediaflock-parser-test-"));
  source = join(dir, "original.mp4");
  // Generate a trusted local fixture before enabling isolation. Every operation
  // on uploaded/decoded bytes below uses the Docker boundary.
  await runMediaProcess("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=320x180:rate=24:duration=2",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=2",
    "-c:v",
    "libx264",
    "-threads",
    "2",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-shortest",
    source,
  ]);
  originalHash = hash(await readFile(source));
  process.env.MEDIAFLOCK_MEDIA_ISOLATION = "docker";
  process.env.MEDIAFLOCK_PARSER_LEAK_CANARY =
    "private-canary-must-not-enter-container";
  server = createServer((_request, response) => {
    networkRequests++;
    response.end("harmless-network-canary");
  });
  await new Promise<void>((resolve) => server.listen(0, "0.0.0.0", resolve));
}, 30000);
afterAll(async () => {
  if (server)
    await new Promise<void>((resolve) => server.close(() => resolve()));
  if (dir) await rm(dir, { recursive: true, force: true });
  delete process.env.MEDIAFLOCK_PARSER_LEAK_CANARY;
  for (const [name, value] of Object.entries({
    MEDIAFLOCK_MODE: previous.mode,
    MEDIAFLOCK_MEDIA_ISOLATION: previous.isolation,
    MEDIAFLOCK_MEDIA_IMAGE: previous.image,
  })) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

function containers() {
  const result = spawnSync(
    "/opt/homebrew/bin/docker",
    [
      "--context",
      dockerContext,
      "ps",
      "-aq",
      "--filter",
      "label=mediaflock.parser=true",
    ],
    { encoding: "utf8" },
  );
  expect(result.status).toBe(0);
  return result.stdout.trim();
}

describe.skipIf(skipDockerTests)("Public media parser isolation", () => {
  it("runs the pinned image as an unprivileged process with fixed resource, filesystem and network limits", async () => {
    const status = await mediaParserStatus();
    expect(status).toMatchObject({ isolation: "docker", ready: true });
    expect(status.imageId).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(status.version).toContain("ffmpeg version 5.1.9");
    const info = await testParserIsolation("inspect");
    expect(info.Config.User).toBe("65532:65532");
    expect(info.HostConfig).toMatchObject({
      NetworkMode: "none",
      ReadonlyRootfs: true,
      CapDrop: ["ALL"],
      SecurityOpt: ["no-new-privileges"],
      Memory: 536870912,
      MemorySwap: 536870912,
      NanoCpus: 2000000000,
      PidsLimit: 64,
    });
    expect(info.HostConfig.Tmpfs).toEqual({
      "/work": "rw,nosuid,nodev,noexec,size=134217728,mode=1777",
      "/tmp": "rw,nosuid,nodev,noexec,size=16777216,mode=1777",
    });
    const bind = info.Mounts.filter((item: any) => item.Type === "bind");
    expect(bind).toHaveLength(1);
    expect(bind[0]).toMatchObject({ Destination: "/input", RW: false });
    expect(bind[0].Source).toMatch(/mediaflock-parser-canary-[^/]+\/inputs$/);
    expect(await testParserIsolation("environment")).not.toContain(
      "private-canary",
    );
    expect(containers()).toBe("");
  });

  it("cannot read an outside host canary or reach a host HTTP fixture", async () => {
    const canary = join(dir, "outside-host-canary.txt");
    await writeFile(canary, "harmless-outside-file-canary");
    await expect(testParserIsolation("outside-file", canary)).rejects.toThrow(
      /No such file/,
    );
    const address = server.address();
    expect(address && typeof address !== "string").toBeTruthy();
    const port = (address as { port: number }).port;
    expect(await (await fetch(`http://127.0.0.1:${port}/canary`)).text()).toBe(
      "harmless-network-canary",
    );
    networkRequests = 0;
    await expect(
      testParserIsolation("network", `http://192.168.5.2:${port}/canary`),
    ).rejects.toThrow();
    await expect(
      testParserIsolation("network", `http://127.0.0.1:${port}/canary`),
    ).rejects.toThrow();
    expect(networkRequests).toBe(0);
    expect(await readFile(canary, "utf8")).toBe("harmless-outside-file-canary");
    expect(containers()).toBe("");
  });

  it("actually caps writable scratch space and removes containers on timeout and output overflow", async () => {
    await expect(testParserIsolation("tmpfs")).rejects.toThrow(
      /No space left on device/,
    );
    expect(containers()).toBe("");
    await expect(testParserIsolation("timeout")).rejects.toThrow(
      /runtime limit/,
    );
    expect(containers()).toBe("");
    await expect(testParserIsolation("output-limit")).rejects.toThrow(
      /output exceeded limit/,
    );
    expect(containers()).toBe("");
  });

  it("rejects oversized and symlink outputs and freezes decoder descendants before extraction", async () => {
    await expect(testParserIsolation("oversize-output")).rejects.toThrow(
      /exceeded 50 MiB/,
    );
    await expect(testParserIsolation("symlink-output")).rejects.toThrow(
      /symbolic links/,
    );
    const diagnostic = await testParserIsolation("descendant");
    expect(diagnostic.output).toBe("trusted-canary");
    expect(diagnostic.status).toMatch(/State:\s+T \(stopped\)/);
    expect(containers()).toBe("");
  });

  it("fails closed without Docker/image availability and rejects host paths and symlink inputs", async () => {
    process.env.MEDIAFLOCK_MODE = "live";
    process.env.MEDIAFLOCK_MEDIA_ISOLATION = "host";
    await expect(runMediaProcess("ffprobe", [source])).rejects.toThrow(
      /requires.*docker/,
    );
    process.env.MEDIAFLOCK_MEDIA_ISOLATION = "docker";
    process.env.MEDIAFLOCK_MEDIA_IMAGE =
      "mediaflock-media-parser:missing-isolation-canary";
    await expect(runMediaProcess("ffprobe", [source])).rejects.toThrow(
      /host parsing is refused/,
    );
    if (previous.image === undefined) delete process.env.MEDIAFLOCK_MEDIA_IMAGE;
    else process.env.MEDIAFLOCK_MEDIA_IMAGE = previous.image;
    const originalContext = process.env.MEDIAFLOCK_DOCKER_CONTEXT;
    process.env.MEDIAFLOCK_DOCKER_CONTEXT = "mediaflock-missing-context-canary";
    await expect(runMediaProcess("ffprobe", [source])).rejects.toThrow(
      /host parsing is refused/,
    );
    if (originalContext === undefined)
      delete process.env.MEDIAFLOCK_DOCKER_CONTEXT;
    else process.env.MEDIAFLOCK_DOCKER_CONTEXT = originalContext;
    process.env.MEDIAFLOCK_MODE = "demo";
    await expect(runMediaProcess("ffprobe", ["/etc/passwd"])).rejects.toThrow(
      /temporary job/,
    );
    const link = join(dir, "linked.mp4");
    await symlink(source, link);
    await expect(runMediaProcess("ffprobe", [link])).rejects.toThrow(
      /regular job input/,
    );
    expect(containers()).toBe("");
    expect(hash(await readFile(source))).toBe(originalHash);
  });

  it("trims, resizes, burns captions, generates a JPEG and decodes complete output through the same isolation boundary", async () => {
    const captions = join(dir, "captions.srt");
    await writeFile(
      captions,
      "1\n00:00:00,000 --> 00:00:00,800\nLocal caption canary\n",
    );
    const recipe = mediaRecipe.parse({
      output: "mp4",
      width: 160,
      height: 160,
      fit: "letterbox",
      trimStart: 0.25,
      trimEnd: 1.25,
    });
    const plain = join(dir, "plain.mp4"),
      captioned = join(dir, "captioned.mp4");
    await runMediaProcess("ffmpeg", ffmpegArgs(source, plain, recipe));
    await runMediaProcess(
      "ffmpeg",
      ffmpegArgs(source, captioned, recipe, captions),
    );
    const meta = await probeBytes(await readFile(captioned));
    expect(meta).toMatchObject({
      width: 160,
      height: 160,
      mimeType: "video/mp4",
    });
    expect(meta.duration).toBeCloseTo(1, 1);
    expect(hash(await readFile(plain))).not.toBe(
      hash(await readFile(captioned)),
    );
    await runMediaProcess("ffmpeg", [
      "-v",
      "error",
      "-xerror",
      "-protocol_whitelist",
      "file,pipe",
      "-i",
      captioned,
      "-f",
      "null",
      "-",
    ]);
    const jpeg = join(dir, "thumbnail.jpg");
    const still = mediaRecipe.parse({
      output: "jpeg",
      width: 120,
      height: 80,
      thumbnailAt: 0.5,
      fit: "crop",
    });
    await runMediaProcess("ffmpeg", ffmpegArgs(source, jpeg, still));
    const stillMeta = await probeBytes(await readFile(jpeg));
    expect(stillMeta).toMatchObject({
      width: 120,
      height: 80,
      mimeType: "image/jpeg",
    });
    expect(hash(await readFile(source))).toBe(originalHash);
    expect(containers()).toBe("");
  }, 30000);
});
