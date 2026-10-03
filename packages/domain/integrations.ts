import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
} from "node:crypto";
import { z } from "zod";
import { scoped, one, audit, workerContext, type Context } from "../db";
import { getConfig } from "./config";
import { requireCondition } from "./errors";
export function integrationFingerprint(row: Record<string, any>) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        row.ciphertext,
        row.iv,
        row.tag,
        row.enabled,
        row.config,
      ]),
    )
    .digest("hex");
}
export function credentialOwner(ctx: Context) {
  requireCondition(
    ctx.kind === "human" && ctx.role === "owner",
    "credential_owner_required",
    "Only an authenticated workspace owner can manage integrations and secrets.",
    403,
  );
}
function vaultKey() {
  const secret = process.env.CREDENTIAL_ENCRYPTION_KEY || "";
  let key: Buffer;
  try {
    key = Buffer.from(secret, "base64");
  } catch {
    key = Buffer.alloc(0);
  }
  requireCondition(
    key.length === 32,
    "vault_key_unavailable",
    "Set CREDENTIAL_ENCRYPTION_KEY to 32 random bytes encoded as base64. Keep it outside source control.",
    503,
  );
  return key;
}
export function encryptCredential(
  secret: string,
  workspaceId: string,
  service: string,
) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", vaultKey(), iv);
  cipher.setAAD(Buffer.from(workspaceId + ":" + service));
  const bytes = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return {
    ciphertext: bytes.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}
export function decryptCredential(row: any) {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    vaultKey(),
    Buffer.from(row.iv, "base64"),
  );
  decipher.setAAD(Buffer.from(row.workspace_id + ":" + row.service));
  decipher.setAuthTag(Buffer.from(row.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(row.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
export const integrationInput = z.object({
  apiKey: z.string().min(8).max(1000).optional(),
  enabled: z.boolean().default(false),
  config: z
    .object({
      model: z.string().max(100).optional(),
      dailyTokenCeiling: z.number().int().min(1000).max(1000000).optional(),
      maxOutputTokens: z.number().int().min(256).max(4000).optional(),
      credentialMode: z.enum(["quickstart", "own"]).optional(),
      connectionCallbackConfigured: z.boolean().optional(),
      publishingEnabled: z.boolean().optional(),
    })
    .default({}),
});
export async function listIntegrations(ctx: Context) {
  credentialOwner(ctx);
  return scoped(ctx, async (tx) => {
    const rows = (
      await tx.query(
        "select id,service,enabled,config,status,last_checked_at,updated_at,(ciphertext is not null) as has_key from integration_secrets where workspace_id=$1 order by service",
        [ctx.workspaceId],
      )
    ).rows;
    return {
      entries: rows,
      vaultReady: !!process.env.CREDENTIAL_ENCRYPTION_KEY,
      mode: getConfig().mode,
      services: (
        await tx.query(
          "select * from workspace_services where workspace_id=$1 order by created_at",
          [ctx.workspaceId],
        )
      ).rows,
    };
  });
}
export async function saveIntegration(
  ctx: Context,
  service: "openai" | "postforme",
  input: unknown,
) {
  credentialOwner(ctx);
  requireCondition(
    getConfig().mode === "live",
    "live_workspace_required",
    "Live API keys belong in a separate live workspace. Demo mode never stores or activates live credentials.",
    403,
  );
  const data = integrationInput.parse(input);
  return scoped(ctx, async (tx) => {
    const existing = await one(
      tx,
      "select * from integration_secrets where workspace_id=$1 and service=$2 for update",
      [ctx.workspaceId, service],
    );
    const encrypted = data.apiKey
      ? encryptCredential(data.apiKey, ctx.workspaceId, service)
      : existing;
    requireCondition(
      encrypted?.ciphertext,
      "key_required",
      "Provide a new API key before enabling this integration.",
    );
    if (service === "openai")
      requireCondition(
        data.config.model || existing?.config.model,
        "model_required",
        "Choose the OpenAI model explicitly.",
      );
    const row = await one(
      tx,
      "insert into integration_secrets(workspace_id,service,ciphertext,iv,tag,config,enabled,status,updated_by) values($1,$2,$3,$4,$5,$6,$7,'configured',$8) on conflict(workspace_id,service) do update set ciphertext=excluded.ciphertext,iv=excluded.iv,tag=excluded.tag,config=excluded.config,enabled=excluded.enabled,status='configured',updated_by=excluded.updated_by,updated_at=now() returning id,service,enabled,config,status,updated_at",
      [
        ctx.workspaceId,
        service,
        encrypted.ciphertext,
        encrypted.iv,
        encrypted.tag,
        data.config,
        data.enabled,
        ctx.userId,
      ],
    );
    await audit(
      tx,
      ctx,
      data.apiKey ? "integration.key_rotated" : "integration.configured",
      "integration",
      row!.id,
      { service, enabled: data.enabled, configKeys: Object.keys(data.config) },
    );
    return row;
  });
}
export async function removeIntegration(ctx: Context, service: string) {
  credentialOwner(ctx);
  return scoped(ctx, async (tx) => {
    const row = await one(
      tx,
      "update integration_secrets set ciphertext=null,iv=null,tag=null,enabled=false,status='revoked',updated_by=$1,updated_at=now() where workspace_id=$2 and service=$3 returning id,service,status",
      [ctx.userId, ctx.workspaceId, service],
    );
    requireCondition(row, "not_found", "Integration key not found.", 404);
    await audit(tx, ctx, "integration.key_revoked", "integration", row.id, {
      service,
    });
    return row;
  });
}
// Trusted server/worker composition only. Never exposed by API or MCP.
export async function resolveIntegration(
  workspaceId: string,
  service: "openai" | "postforme",
) {
  const c = getConfig();
  if (c.mode === "demo")
    return {
      key: "",
      enabled: false,
      config: {} as Record<string, any>,
      source: "demo",
      fingerprint: "demo",
    };
  const row = await scoped(workerContext(workspaceId), (tx) =>
    one(
      tx,
      "select * from integration_secrets where workspace_id=$1 and service=$2",
      [workspaceId, service],
    ),
  );
  if (row)
    return {
      key: row.enabled && row.ciphertext ? decryptCredential(row) : "",
      enabled: row.enabled,
      config: row.config as Record<string, any>,
      source: "vault",
      fingerprint: integrationFingerprint(row),
    };
  return {
    key:
      service === "openai"
        ? process.env.OPENAI_API_KEY || ""
        : process.env.POSTFORME_API_KEY || "",
    enabled:
      service === "openai" ? !!process.env.OPENAI_API_KEY : c.livePublishing,
    config:
      service === "openai"
        ? {
            model: process.env.OPENAI_MODEL,
            dailyTokenCeiling:
              Number(process.env.AI_DAILY_TOKEN_CEILING) || 20000,
            maxOutputTokens: Number(process.env.AI_MAX_OUTPUT_TOKENS) || 1500,
          }
        : {
            credentialMode:
              process.env.POSTFORME_CREDENTIAL_MODE || "quickstart",
            connectionCallbackConfigured:
              process.env.POSTFORME_CONNECTION_CALLBACK_CONFIGURED === "true",
          },
    source: "environment",
    fingerprint: createHash("sha256")
      .update(process.env.POSTFORME_API_KEY || "")
      .digest("hex"),
  };
}
export async function checkIntegration(
  ctx: Context,
  service: string,
  transport: typeof fetch = fetch,
) {
  credentialOwner(ctx);
  requireCondition(
    ["postforme", "openai"].includes(service),
    "unknown_service",
    "Unknown integration.",
  );
  const row = await scoped(ctx, (tx) =>
    one(
      tx,
      "select * from integration_secrets where workspace_id=$1 and service=$2",
      [ctx.workspaceId, service],
    ),
  );
  let status = "unavailable",
    message = "Add a key and enable the integration first.",
    networkCall = false;
  if (getConfig().mode === "demo") {
    status = "test_only";
    message = "External connections are disabled in this test environment.";
  } else if (row?.enabled && row.ciphertext) {
    networkCall = true;
    const url =
      service === "postforme"
        ? "https://api.postforme.dev/v1/social-accounts?limit=1"
        : "https://api.openai.com/v1/models/" +
          encodeURIComponent(row.config.model || "");
    try {
      const response = await transport(url, {
        headers: { Authorization: "Bearer " + decryptCredential(row) },
        signal: AbortSignal.timeout(15000),
        redirect: "error",
      });
      const body = response.ok ? await response.json() : null;
      const valid =
        service === "postforme"
          ? Array.isArray(body?.data) && typeof body?.meta === "object"
          : body?.id === row.config.model;
      if (response.ok && valid) {
        status = "connected";
        message =
          service === "postforme"
            ? "Provider connection confirmed. You can now authorize your social accounts."
            : "Model access confirmed. AI drafts use your API account and its usage limits.";
      } else
        message =
          "Connection check failed" +
          (response.status ? " (HTTP " + response.status + ")" : "") +
          ". Check the key and service permissions.";
    } catch {
      message =
        "The service could not be reached. Check your connection and try again.";
    }
  }
  return scoped(ctx, async (tx) => {
    if (row) {
      const locked = await one(
        tx,
        "select updated_at from integration_secrets where id=$1 and workspace_id=$2 for update",
        [row.id, ctx.workspaceId],
      );
      requireCondition(
        locked &&
          new Date(locked.updated_at).getTime() ===
            new Date(row.updated_at).getTime(),
        "configuration_changed",
        "The key changed during this check. Run the check again.",
        409,
      );
      await tx.query(
        "update integration_secrets set status=$1,last_checked_at=now() where id=$2 and workspace_id=$3",
        [status, row.id, ctx.workspaceId],
      );
    }
    await audit(
      tx,
      ctx,
      "integration.connection_checked",
      "integration",
      row?.id || null,
      { service, status, networkCall },
    );
    return { service, status, networkCall, message };
  });
}
export const serviceInput = z.object({
  name: z.string().min(1).max(100),
  type: z.enum([
    "reference",
    "storage",
    "publishing",
    "analytics",
    "automation",
  ]),
  url: z
    .url()
    .refine(
      (x) => ["https:", "http:"].includes(new URL(x).protocol),
      "Use an HTTP(S) URL.",
    ),
  notes: z.string().max(3000).default(""),
});
export async function addService(ctx: Context, input: unknown) {
  credentialOwner(ctx);
  const data = serviceInput.parse(input);
  return scoped(ctx, async (tx) => {
    const row = await one(
      tx,
      "insert into workspace_services(workspace_id,name,type,url,notes,created_by) values($1,$2,$3,$4,$5,$6) returning *",
      [ctx.workspaceId, data.name, data.type, data.url, data.notes, ctx.userId],
    );
    await audit(tx, ctx, "service.registered", "workspace_service", row!.id, {
      type: data.type,
    });
    return row;
  });
}
export async function removeService(ctx: Context, id: string) {
  credentialOwner(ctx);
  return scoped(ctx, async (tx) => {
    const row = await one(
      tx,
      "delete from workspace_services where id=$1 and workspace_id=$2 returning id",
      [id, ctx.workspaceId],
    );
    requireCondition(row, "not_found", "Service not found.", 404);
    await audit(tx, ctx, "service.removed", "workspace_service", id);
    return row;
  });
}
