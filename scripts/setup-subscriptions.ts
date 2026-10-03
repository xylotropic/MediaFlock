import {
  mkdir,
  chmod,
  lstat,
  readFile,
  writeFile,
  rename,
  rm,
} from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve, dirname } from "node:path";
import {
  bindingSchema,
  localKeyHelper,
  localSubscriptionsDirectory,
  keychainKey,
} from "../packages/chatgpt/local-vault";
import { db, closeDb } from "../packages/db";
import { getConfig } from "../packages/domain/config";

if (
  process.platform !== "darwin" ||
  process.env.VERCEL ||
  getConfig().mode !== "live"
)
  throw new Error(
    "Subscription setup requires the trusted local Mac installation.",
  );
const proofPath = resolve(
  "artifacts/deployment/private/floyd-account-proof.json",
);
const proofInfo = await lstat(proofPath);
if (
  !proofInfo.isFile() ||
  proofInfo.isSymbolicLink() ||
  proofInfo.uid !== process.getuid!() ||
  proofInfo.mode & 0o077
)
  throw new Error(
    "The local installation owner's private provision record is required.",
  );
const proof = JSON.parse(await readFile(proofPath, "utf8"));
const candidate = bindingSchema.parse({
  format: 1,
  userId: proof.userId,
  workspaceId: proof.workspaceId,
  supabaseOrigin: new URL(getConfig().supabaseUrl).origin,
  hostId: "urn:uuid:" + randomUUID(),
  createdAt: new Date().toISOString(),
});
try {
  const owner = (
    await db().query(
      "select m.role,w.mode,u.email from memberships m join workspaces w on w.id=m.workspace_id join auth.users u on u.id=m.user_id where m.user_id=$1 and m.workspace_id=$2",
      [candidate.userId, candidate.workspaceId],
    )
  ).rows[0];
  if (
    owner?.role !== "owner" ||
    owner.mode !== "live" ||
    typeof proof.email !== "string" ||
    owner.email !== proof.email
  )
    throw new Error(
      "The provisioned local owner no longer matches the live workspace.",
    );
  const directory = localSubscriptionsDirectory();
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await lstat(directory);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    info.uid !== process.getuid!()
  )
    throw new Error("Invalid local subscription directory.");
  await chmod(directory, 0o700);
  const bindingPath = resolve(directory, "binding.json");
  let exists = false;
  try {
    const savedInfo = await lstat(bindingPath);
    if (
      !savedInfo.isFile() ||
      savedInfo.isSymbolicLink() ||
      savedInfo.uid !== process.getuid!() ||
      savedInfo.mode & 0o077
    )
      throw new Error("Invalid saved installation permissions.");
    const saved = bindingSchema.parse(
      JSON.parse(await readFile(bindingPath, "utf8")),
    );
    if (
      saved.userId !== candidate.userId ||
      saved.workspaceId !== candidate.workspaceId ||
      saved.supabaseOrigin !== candidate.supabaseOrigin
    )
      throw new Error(
        "A different owner already owns this installation. Existing connections were preserved.",
      );
    exists = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const helper = localKeyHelper();
  await mkdir(dirname(helper), { recursive: true, mode: 0o700 });
  const helperTemporary = helper + "." + randomUUID();
  try {
    execFileSync(
      "/usr/bin/swiftc",
      [resolve("tools/local-keychain.swift"), "-o", helperTemporary],
      { stdio: ["ignore", "pipe", "pipe"], timeout: 30000 },
    );
    execFileSync(
      "/usr/bin/codesign",
      [
        "--force",
        "--sign",
        "-",
        "--identifier",
        "org.mediaflock.local-keychain",
        helperTemporary,
      ],
      { stdio: ["ignore", "pipe", "pipe"], timeout: 10000 },
    );
    await chmod(helperTemporary, 0o700);
    await rename(helperTemporary, helper);
  } finally {
    await rm(helperTemporary, { force: true });
  }
  const key = await keychainKey("ensure");
  key.fill(0);
  if (!exists)
    await writeFile(bindingPath, JSON.stringify(candidate) + "\n", {
      mode: 0o600,
      flag: "wx",
    });
  console.log(
    "Local owner verified. Mac keychain encryption and stable subscription registration are ready. No ChatGPT authorization was started.",
  );
} finally {
  await closeDb();
}
