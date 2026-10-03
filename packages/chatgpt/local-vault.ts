import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  readFile,
  writeFile,
  rename,
  mkdir,
  rm,
  lstat,
} from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { getConfig } from "../domain/config";
import { DomainError, requireCondition } from "../domain/errors";

const run = promisify(execFile);
export const localSubscriptionsDirectory = () =>
  resolve(homedir(), "Library/Application Support/MediaFlock/subscriptions");
export const localKeyHelper = () =>
  resolve(
    homedir(),
    "Library/Application Support/MediaFlock/bin/local-keychain",
  );
export function localSubscriptionsEnabled() {
  const args = process.argv;
  const hostname = args[args.indexOf("--hostname") + 1];
  const port = args[args.indexOf("--port") + 1];
  return (
    process.platform === "darwin" &&
    !process.env.VERCEL &&
    process.env.MEDIAFLOCK_LOCAL_SUBSCRIPTIONS === "true" &&
    process.env.MEDIAFLOCK_PROCESS_ROLE === "web" &&
    getConfig().mode === "live" &&
    new URL(getConfig().origin).hostname === "127.0.0.1" &&
    args.includes("--hostname") &&
    hostname === "127.0.0.1" &&
    args.includes("--port") &&
    port === new URL(getConfig().origin).port
  );
}
export const bindingSchema = z.object({
  format: z.literal(1),
  userId: z.uuid(),
  workspaceId: z.uuid(),
  supabaseOrigin: z.url(),
  hostId: z.string().regex(/^urn:uuid:[0-9a-f-]{36}$/),
  createdAt: z.iso.datetime(),
});
export type LocalBinding = z.infer<typeof bindingSchema>;
const credentialsSchema = z.object({
  accessToken: z.string().max(20000),
  refreshToken: z.string().max(20000),
  idToken: z.string().max(20000),
  scopes: z.array(z.string().max(100)).max(30),
  expiresAt: z.number().finite(),
});
const profileSchema = z.object({
  id: z.uuid(),
  clientId: z.string().min(8).max(200),
  subject: z.string().max(200),
  email: z.string().max(320),
  name: z.string().max(200),
  model: z.string().max(100),
  dailyTokenEstimate: z.number().int().min(1000).max(1000000),
  generation: z.number().int().min(0),
  credentials: credentialsSchema.optional(),
  lastVerifiedInference: z.iso.datetime().optional(),
  reconnectRequired: z.boolean().default(false),
  revocationUnconfirmed: z.boolean().default(false),
  lease: z
    .object({
      id: z.uuid(),
      expiresAt: z.number(),
      generation: z.number().int(),
    })
    .optional(),
});
export type Profile = z.infer<typeof profileSchema>;
const stateSchema = z.object({
  format: z.literal(1),
  epoch: z.number().int().min(0),
  selectedId: z.uuid().optional(),
  profiles: z.array(profileSchema).max(20),
});
export type LocalState = z.infer<typeof stateSchema>;
export interface Vault {
  binding(): Promise<LocalBinding>;
  read(): Promise<LocalState>;
  locked<T>(fn: (state: LocalState) => Promise<T>): Promise<T>;
}
export async function keychainKey(action: "ensure" | "read" = "read") {
  try {
    const { stdout } = await run(localKeyHelper(), [action], {
      timeout: 10000,
      maxBuffer: 1024,
    });
    const key = Buffer.from(JSON.parse(stdout).key || "", "base64");
    requireCondition(
      key.length === 32,
      "chatgpt_keychain",
      "MediaFlock could not read its local encryption key.",
      503,
    );
    return key;
  } catch {
    throw new DomainError(
      "chatgpt_keychain",
      "Unlock the Mac login keychain before connecting ChatGPT. MediaFlock does not store this connection without encryption.",
      503,
    );
  }
}
async function privateFile(path: string) {
  const info = await lstat(path);
  requireCondition(
    info.isFile() &&
      !info.isSymbolicLink() &&
      info.uid === process.getuid?.() &&
      (info.mode & 0o077) === 0,
    "chatgpt_storage",
    "Local connection storage permissions are invalid.",
    503,
  );
  requireCondition(
    info.size < 1000000,
    "chatgpt_storage",
    "Local connection storage is oversized.",
    503,
  );
  return readFile(path, "utf8");
}
export class LocalVault implements Vault {
  constructor(
    private directory = localSubscriptionsDirectory(),
    private key = keychainKey,
  ) {}
  async binding() {
    try {
      return bindingSchema.parse(
        JSON.parse(await privateFile(resolve(this.directory, "binding.json"))),
      );
    } catch {
      throw new DomainError(
        "chatgpt_installation",
        "Set up this Mac's subscription connection before signing in with ChatGPT.",
        503,
      );
    }
  }
  private async secureDirectory() {
    const info = await lstat(this.directory);
    requireCondition(
      info.isDirectory() &&
        !info.isSymbolicLink() &&
        info.uid === process.getuid?.() &&
        (info.mode & 0o077) === 0,
      "chatgpt_storage",
      "Local connection storage permissions are invalid.",
      503,
    );
  }
  private async associatedData() {
    const b = await this.binding();
    return Buffer.from(
      JSON.stringify([
        1,
        b.supabaseOrigin,
        b.userId,
        b.workspaceId,
        b.hostId,
        "chatgpt",
      ]),
    );
  }
  async read(): Promise<LocalState> {
    await this.secureDirectory();
    let raw: string;
    try {
      raw = await privateFile(resolve(this.directory, "chatgpt-vault.json"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return { format: 1, epoch: 0, profiles: [] };
      throw error;
    }
    try {
      const envelope = z
        .object({
          format: z.literal(1),
          iv: z.string(),
          tag: z.string(),
          encrypted: z.string(),
        })
        .parse(JSON.parse(raw));
      const decipher = createDecipheriv(
        "aes-256-gcm",
        await this.key("read"),
        Buffer.from(envelope.iv, "base64"),
      );
      decipher.setAAD(await this.associatedData());
      decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
      const plain = Buffer.concat([
        decipher.update(Buffer.from(envelope.encrypted, "base64")),
        decipher.final(),
      ]);
      return stateSchema.parse(JSON.parse(plain.toString("utf8")));
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw new DomainError(
        "chatgpt_storage",
        "The local ChatGPT connection could not be decrypted. Existing files were preserved.",
        503,
      );
    }
  }
  private async save(state: LocalState) {
    const validated = stateSchema.parse(state),
      iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", await this.key("read"), iv);
    cipher.setAAD(await this.associatedData());
    const encrypted = Buffer.concat([
      cipher.update(JSON.stringify(validated), "utf8"),
      cipher.final(),
    ]);
    const temporary = resolve(this.directory, ".vault-" + randomUUID());
    try {
      await writeFile(
        temporary,
        JSON.stringify({
          format: 1,
          iv: iv.toString("base64"),
          tag: cipher.getAuthTag().toString("base64"),
          encrypted: encrypted.toString("base64"),
        }) + "\n",
        { mode: 0o600, flag: "wx" },
      );
      await rename(temporary, resolve(this.directory, "chatgpt-vault.json"));
    } finally {
      await rm(temporary, { force: true });
    }
  }
  async locked<T>(fn: (state: LocalState) => Promise<T>): Promise<T> {
    await this.secureDirectory();
    const lock = resolve(this.directory, "session.lock"),
      started = Date.now();
    for (;;) {
      try {
        await mkdir(lock, { mode: 0o700 });
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        try {
          const owner = JSON.parse(
            await readFile(resolve(lock, "owner.json"), "utf8"),
          );
          try {
            process.kill(owner.pid, 0);
          } catch (e) {
            if ((e as NodeJS.ErrnoException).code === "ESRCH")
              throw new DomainError(
                "chatgpt_stale_lock",
                "A previous connection process stopped unexpectedly. Restart the local connection service before continuing.",
                503,
              );
          }
        } catch (error) {
          if (error instanceof DomainError) throw error;
        }
        if (Date.now() - started > 20000)
          throw new DomainError(
            "chatgpt_busy",
            "The ChatGPT connection is busy. Try again shortly.",
            409,
          );
        await delay(50);
      }
    }
    try {
      await writeFile(
        resolve(lock, "owner.json"),
        JSON.stringify({ pid: process.pid, createdAt: Date.now() }),
        { mode: 0o600, flag: "wx" },
      );
      const state = await this.read(),
        before = JSON.stringify(state),
        result = await fn(state);
      if (JSON.stringify(state) !== before) await this.save(state);
      return result;
    } finally {
      await rm(lock, { recursive: true, force: true });
    }
  }
}
export function publicProfile(profile: Profile) {
  return {
    id: profile.id,
    identityVerified: !!profile.subject,
    revocationUnconfirmed: profile.revocationUnconfirmed,
    label:
      (profile.email ||
        profile.name ||
        (profile.subject ? "ChatGPT account" : "Unfinished connection")) +
      " · " +
      profile.id.slice(0, 8),
    email: profile.email,
    name: profile.name,
    model: profile.model,
    dailyTokenEstimate: profile.dailyTokenEstimate,
    signedIn: !!profile.credentials?.accessToken,
    planPermission:
      !!profile.credentials?.scopes.includes("chatgpt.tokens.use.direct") &&
      !!profile.credentials?.scopes.includes("resource.invoke"),
    renewable: !!profile.credentials?.refreshToken,
    reconnectRequired: profile.reconnectRequired,
    lastVerifiedInference: profile.lastVerifiedInference || null,
    busy: !!profile.lease && profile.lease.expiresAt > Date.now(),
  };
}
