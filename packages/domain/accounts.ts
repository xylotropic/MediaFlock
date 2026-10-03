import { randomBytes } from "node:crypto";
import { z } from "zod";
import { scoped, one, audit, type Context } from "../db";
import { authorize, humanReviewer, hash } from "./auth";
import { getConfig } from "./config";
import { requireCondition } from "./errors";
import { PostForMeProvider } from "../publishing/postforme";
import {
  resolveIntegration,
  credentialOwner,
  integrationFingerprint,
} from "./integrations";
async function accountProvider(ctx: Context) {
  const c = await resolveIntegration(ctx.workspaceId, "postforme");
  requireCondition(
    c.key && c.enabled,
    "provider_unavailable",
    "Configure Post for Me in Administration.",
    503,
  );
  return new PostForMeProvider(fetch, c.key);
}
export async function updateAccount(
  ctx: Context,
  id: string,
  data: {
    audience?: string;
    writingGuidelines?: string;
    timezone?: string;
    postingPreferences?: Record<string, unknown>;
  },
) {
  authorize(ctx, "draft");
  return scoped(ctx, async (tx) => {
    if (data.timezone)
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: data.timezone });
      } catch {
        throw new Error("Choose a valid IANA timezone.");
      }
    const row = await one(
      tx,
      "update social_accounts set audience=coalesce($1,audience),writing_guidelines=coalesce($2,writing_guidelines),timezone=coalesce($3,timezone),posting_preferences=coalesce($4,posting_preferences) where id=$5 and workspace_id=$6 returning *",
      [
        data.audience || null,
        data.writingGuidelines || null,
        data.timezone || null,
        data.postingPreferences || null,
        id,
        ctx.workspaceId,
      ],
    );
    requireCondition(row, "not_found", "Account not found.", 404);
    await audit(tx, ctx, "account.preferences_updated", "social_account", id);
    return row;
  });
}
export const platformFormats: Record<string, string[]> = {
  youtube: ["video", "short"],
  facebook: ["video", "image", "text"],
  instagram: ["reel", "image", "carousel"],
  tiktok: ["video", "image", "carousel"],
  linkedin: ["video", "image", "text"],
  x: ["video", "image", "text"],
};
const unknownCapabilities = () => ({
  formats: Object.fromEntries(
    ["video", "short", "reel", "image", "text", "carousel"].map((x) => [
      x,
      "unknown",
    ]),
  ),
  operations: { publish: "unknown", feed: "unknown", cancel: "unknown" },
  metrics: Object.fromEntries(
    ["views", "likes", "comments", "shares"].map((x) => [x, "unknown"]),
  ),
});
export async function beginConnection(
  ctx: Context,
  platform: string,
  connectionType?: string,
  provider?: PostForMeProvider,
) {
  humanReviewer(ctx);
  requireCondition(
    getConfig().mode === "live",
    "test_accounts",
    "Account authorization is disabled in this test environment.",
    503,
  );
  const configuration = await resolveIntegration(ctx.workspaceId, "postforme");
  requireCondition(
    configuration.key && configuration.enabled,
    "provider_unavailable",
    "Connect Post for Me in Connections first.",
    503,
  );
  const redirectMode = "project";
  requireCondition(
    configuration.config.connectionCallbackConfigured === true,
    "callback_unavailable",
    "Set the Project Redirect URL in Post for Me to the callback shown in Connections, then confirm it there.",
    503,
  );
  const types: Record<string, string[]> = {
    instagram: ["instagram", "facebook"],
    linkedin: ["organization", "personal"],
    x: ["oauth1", "oauth2"],
  };
  const chosenType =
    connectionType ||
    (
      {
        instagram: "instagram",
        linkedin: "organization",
        x: "oauth2",
      } as Record<string, string>
    )[platform];
  requireCondition(
    !types[platform] || types[platform].includes(chosenType!),
    "connection_type",
    "Choose a supported connection type.",
  );
  requireCondition(
    platform !== "linkedin" ||
      configuration.config.credentialMode === "own" ||
      chosenType === "organization",
    "connection_type",
    "Quickstart LinkedIn connections require the organization flow, including personal profiles.",
  );
  const state = randomBytes(32).toString("base64url"),
    binding = "mfconn_" + randomBytes(20).toString("hex");
  const connection = await scoped(ctx, async (tx) => {
    await tx.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [
      ctx.workspaceId + ":" + ctx.userId,
    ]);
    requireCondition(
      !(await one(
        tx,
        "select id from provider_connections where workspace_id=$1 and user_id=$2 and status='pending' and expires_at>now()",
        [ctx.workspaceId, ctx.userId],
      )),
      "connection_active",
      "Finish the current connection or wait for it to expire before starting another.",
      409,
    );
    const row = await one(
      tx,
      "insert into provider_connections(workspace_id,user_id,platform,state_hash,external_binding,expires_at,redirect_mode,connection_type,integration_hash) values($1,$2,$3,$4,$5,now()+interval '15 minutes',$6,$7,$8) returning id",
      [
        ctx.workspaceId,
        ctx.userId,
        platform,
        hash(state),
        binding,
        redirectMode,
        chosenType || null,
        configuration.fingerprint,
      ],
    );
    await audit(
      tx,
      ctx,
      "connection.initiated",
      "provider_connection",
      row!.id,
    );
    return row!;
  });
  try {
    const result = await (provider || (await accountProvider(ctx))).authUrl(
      platform,
      binding,
      undefined,
      chosenType,
    );
    return { connectionId: connection.id, url: result.url, state };
  } catch (error) {
    await scoped(ctx, (tx) =>
      tx.query(
        "update provider_connections set status='failed' where id=$1 and workspace_id=$2",
        [connection.id, ctx.workspaceId],
      ),
    );
    throw error;
  }
}
export async function finishConnection(
  ctx: Context,
  state: string,
  provider?: PostForMeProvider,
  projectCallback = true,
) {
  humanReviewer(ctx);
  const pending = await scoped(ctx, (tx) =>
    one(
      tx,
      "select * from provider_connections where state_hash=$1 and user_id=$2 and workspace_id=$3 and status in ('pending','verified') and expires_at>now()",
      [hash(state), ctx.userId, ctx.workspaceId],
    ),
  );
  requireCondition(
    pending && (!projectCallback || pending.redirect_mode === "project"),
    "oauth_binding",
    "Connection callback is expired, already used, or belongs to another session.",
    403,
  );
  const configuration = await resolveIntegration(ctx.workspaceId, "postforme");
  requireCondition(
    configuration.enabled &&
      configuration.fingerprint === pending.integration_hash,
    "integration_changed",
    "The provider configuration changed. Start a fresh connection.",
    409,
  );
  if (pending.status === "verified")
    return scoped(ctx, async (tx) => {
      const rows = (
        await tx.query(
          "select * from social_accounts where workspace_id=$1 and id=any($2::uuid[])",
          [ctx.workspaceId, pending.imported_ids],
        )
      ).rows;
      return { id: rows[0]?.id, accounts: rows, count: rows.length };
    });
  const accounts = await (
    provider || (await accountProvider(ctx))
  ).accountsByBinding(pending.external_binding);
  const matches = accounts.filter(
    (x) =>
      x.external_id === pending.external_binding &&
      x.platform === pending.platform &&
      x.status === "connected",
  );
  requireCondition(
    matches.length > 0,
    "connection_unverified",
    "No connected account was returned for this authorization. Check your provider connection.",
    409,
  );
  requireCondition(
    matches.length <= 100 &&
      new Set(matches.map((x) => x.id)).size === matches.length,
    "connection_response_invalid",
    "Provider returned an invalid account list.",
    409,
  );
  return scoped(ctx, async (tx) => {
    const locked = await one(
      tx,
      "select * from provider_connections where id=$1 and status in ('pending','verified') and expires_at>now() and workspace_id=$2 for update",
      [pending.id, ctx.workspaceId],
    );
    requireCondition(
      locked,
      "oauth_replay",
      "This callback was already used or expired.",
      409,
    );
    if (locked.status === "verified") {
      const rows = (
        await tx.query(
          "select * from social_accounts where workspace_id=$1 and id=any($2::uuid[])",
          [ctx.workspaceId, locked.imported_ids],
        )
      ).rows;
      return { id: rows[0]?.id, accounts: rows, count: rows.length };
    }
    const integration = await one(
      tx,
      "select * from integration_secrets where workspace_id=$1 and service='postforme' for share",
      [ctx.workspaceId],
    );
    requireCondition(
      integration &&
        integrationFingerprint(integration) === pending.integration_hash,
      "integration_changed",
      "Provider configuration changed during authorization. Start again.",
      409,
    );
    await tx.query(
      "select v.id from platform_variants v join social_accounts a on a.id=v.account_id where a.workspace_id=$1 and a.provider_account_id=any($2::text[]) order by v.id for update of v",
      [ctx.workspaceId, matches.map((x) => x.id)],
    );
    const imported = [];
    for (const account of matches) {
      // The provider confirms connection but does not report granted OAuth scopes.
      // Reauthorization deliberately clears stale capability attestations.
      const row = await one(
        tx,
        "insert into social_accounts(workspace_id,provider_account_id,platform,handle,display_name,account_type,status,capabilities,permissions,last_synced_at,provenance,external_binding) values($1,$2,$3,$4,$5,'unknown','connected',$6,$7,now(),'provider',$8) on conflict(workspace_id,provider_account_id) do update set external_binding=excluded.external_binding,status='connected',account_type='unknown',capabilities=excluded.capabilities,permissions=excluded.permissions,last_synced_at=now(),connection_generation=social_accounts.connection_generation+1,capability_generation=social_accounts.capability_generation+1 returning *",
        [
          ctx.workspaceId,
          account.id,
          account.platform,
          account.username || account.user_id,
          account.username || account.platform,
          unknownCapabilities(),
          pending.requested_permissions,
          pending.external_binding,
        ],
      );
      imported.push(row!);
      await tx.query(
        "update approvals set status='revoked',reason='Account was reauthorized',decided_at=now() where account_id=$1 and workspace_id=$2 and status in ('pending','approved')",
        [row!.id, ctx.workspaceId],
      );
      await tx.query(
        "update publish_jobs set cancel_requested=true,next_run_at=now(),updated_at=now(),error=$3 where account_id=$1 and workspace_id=$2 and state not in ('published','failed','cancelled')",
        [
          row!.id,
          ctx.workspaceId,
          {
            code: "connection_changed",
            message:
              "Account was reauthorized. Existing delivery cancellation must be confirmed.",
          },
        ],
      );
      await audit(tx, ctx, "connection.verified", "social_account", row!.id, {
        providerAccountId: account.id,
        capabilities: "unknown",
        permissions: "requested_only",
      });
    }
    await tx.query(
      "update provider_connections set status='verified',account_id=$1,imported_ids=$4 where id=$2 and workspace_id=$3",
      [imported[0].id, pending.id, ctx.workspaceId, imported.map((x) => x.id)],
    );
    return { id: imported[0].id, accounts: imported, count: imported.length };
  });
}
export const capabilityReview = z.object({
  connectionGeneration: z.number().int().min(1),
  capabilityGeneration: z.number().int().min(0),
  accountType: z.enum([
    "youtube_channel",
    "facebook_page",
    "instagram_professional",
    "tiktok_creator",
    "linkedin_person",
    "linkedin_organization",
    "x_account",
  ]),
  formats: z
    .array(z.enum(["video", "short", "reel", "image", "text", "carousel"]))
    .min(1)
    .max(6),
  publishingGranted: z.literal(true),
  feedsGranted: z.boolean().nullable().default(null),
  evidence: z.string().trim().min(20).max(2000),
});
export async function recordCapabilityReview(
  ctx: Context,
  id: string,
  input: unknown,
  provider?: PostForMeProvider,
) {
  credentialOwner(ctx);
  requireCondition(
    getConfig().mode === "live",
    "live_only",
    "Permission review applies to live accounts.",
    403,
  );
  const data = capabilityReview.parse(input);
  const account = await scoped(ctx, (tx) =>
    one(tx, "select * from social_accounts where id=$1 and workspace_id=$2", [
      id,
      ctx.workspaceId,
    ]),
  );
  requireCondition(
    account?.provenance === "provider",
    "not_found",
    "Connected account not found.",
    404,
  );
  requireCondition(
    data.accountType.startsWith(account.platform + "_") &&
      data.formats.every((x) => platformFormats[account.platform]?.includes(x)),
    "account_type",
    "The account type and formats must match this platform.",
  );
  requireCondition(
    data.connectionGeneration === account.connection_generation &&
      data.capabilityGeneration === account.capability_generation,
    "account_changed",
    "This account changed since the review was opened. Open a fresh review.",
    409,
  );
  const configuration = await resolveIntegration(ctx.workspaceId, "postforme");
  const remote = await (provider || (await accountProvider(ctx))).account(
    account.provider_account_id,
  );
  requireCondition(
    remote.id === account.provider_account_id &&
      remote.platform === account.platform &&
      remote.status === "connected" &&
      remote.external_id === account.external_binding,
    "account_unavailable",
    "The provider has not confirmed this account connection.",
    409,
  );
  const capabilities = unknownCapabilities();
  for (const format of data.formats) capabilities.formats[format] = "supported";
  capabilities.operations.publish = "supported";
  capabilities.operations.feed =
    data.feedsGranted === null
      ? "unknown"
      : data.feedsGranted
        ? "supported"
        : "permission_missing";
  const evidence = {
    source: "owner_attestation",
    expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
    connectionGeneration: account.connection_generation,
    integrationHash: configuration.fingerprint,
    evidence: data.evidence,
    recordedAt: new Date().toISOString(),
    recordedBy: ctx.userId,
    providerAccountId: account.provider_account_id,
  };
  return scoped(ctx, async (tx) => {
    await tx.query(
      "select id from platform_variants where account_id=$1 and workspace_id=$2 order by id for update",
      [id, ctx.workspaceId],
    );
    requireCondition(
      !(await one(
        tx,
        "select id from publish_jobs where account_id=$1 and workspace_id=$2 and state not in ('published','failed','cancelled') limit 1",
        [id, ctx.workspaceId],
      )),
      "delivery_active",
      "Confirm cancellation of pending deliveries before changing this permission review.",
      409,
    );
    const currentConfiguration = await one(
      tx,
      "select * from integration_secrets where workspace_id=$1 and service='postforme' for share",
      [ctx.workspaceId],
    );
    requireCondition(
      currentConfiguration &&
        integrationFingerprint(currentConfiguration) ===
          configuration.fingerprint,
      "integration_changed",
      "Provider configuration changed during review.",
      409,
    );
    const locked = await one(
      tx,
      "select provider_account_id,status,external_binding,connection_generation,capability_generation from social_accounts where id=$1 and workspace_id=$2 for update",
      [id, ctx.workspaceId],
    );
    requireCondition(
      locked?.status === "connected" &&
        locked.provider_account_id === account.provider_account_id &&
        locked.external_binding === account.external_binding &&
        locked.connection_generation === account.connection_generation &&
        locked.capability_generation === account.capability_generation,
      "account_changed",
      "Account connection changed. Review it again.",
      409,
    );
    const row = await one(
      tx,
      "update social_accounts set account_type=$1,capabilities=$2,capability_generation=capability_generation+1,last_synced_at=now() where id=$3 and workspace_id=$4 returning *",
      [
        data.accountType,
        { ...capabilities, verification: evidence },
        id,
        ctx.workspaceId,
      ],
    );
    await tx.query(
      "update approvals set status='revoked',reason='Permission review changed',decided_at=now() where account_id=$1 and workspace_id=$2 and status in ('pending','approved')",
      [id, ctx.workspaceId],
    );
    await audit(tx, ctx, "account.permissions_attested", "social_account", id, {
      accountType: data.accountType,
      formats: data.formats,
      feedsGranted: data.feedsGranted,
      evidenceSource: "owner_attestation",
    });
    return row;
  });
}
export async function disconnectAccount(ctx: Context, id: string) {
  humanReviewer(ctx);
  const account = await scoped(ctx, (tx) =>
    one(tx, "select * from social_accounts where id=$1 and workspace_id=$2", [
      id,
      ctx.workspaceId,
    ]),
  );
  requireCondition(account, "not_found", "Account not found.", 404);
  if (getConfig().mode === "live") {
    await (await accountProvider(ctx)).disconnect(account.provider_account_id);
    const verified = await (
      await accountProvider(ctx)
    ).account(account.provider_account_id);
    requireCondition(
      verified.status === "disconnected",
      "disconnect_unconfirmed",
      "Provider has not confirmed disconnection. Pending posts may still publish.",
      409,
    );
  }
  return scoped(ctx, async (tx) => {
    await tx.query(
      "select id from platform_variants where account_id=$1 and workspace_id=$2 order by id for update",
      [id, ctx.workspaceId],
    );
    const row = await one(
      tx,
      "update social_accounts set status='disconnected',connection_generation=connection_generation+1,capability_generation=capability_generation+1 where id=$1 and workspace_id=$2 returning *",
      [id, ctx.workspaceId],
    );
    await tx.query(
      "update publish_jobs set cancel_requested=true,next_run_at=now(),updated_at=now() where account_id=$1 and workspace_id=$2 and state not in ('published','cancelled','failed')",
      [id, ctx.workspaceId],
    );
    await audit(tx, ctx, "account.disconnected", "social_account", id, {
      provenance: account.provenance,
      pendingDeliveries: "cancellation_requested",
    });
    return row;
  });
}
export async function simulateReconnect(ctx: Context, id: string) {
  humanReviewer(ctx);
  requireCondition(
    getConfig().mode === "demo",
    "demo_only",
    "Simulated reconnection is demo-only.",
    403,
  );
  return scoped(ctx, async (tx) => {
    const row = await one(
      tx,
      "update social_accounts set status='connected',last_synced_at=now() where id=$1 and workspace_id=$2 and provenance='simulated' returning *",
      [id, ctx.workspaceId],
    );
    requireCondition(row, "not_found", "Simulated account not found.", 404);
    await audit(
      tx,
      ctx,
      "account.simulated_reconnection",
      "social_account",
      id,
    );
    return row;
  });
}
