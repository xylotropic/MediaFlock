import { getConfig } from "../packages/domain/config";
import { randomUUID } from "node:crypto";
import { db, type Context } from "../packages/db";
import { storageAdmin } from "../packages/domain/auth";
import * as domain from "../packages/domain";
export const scopes = [
  "read",
  "draft",
  "request_approval",
  "schedule",
  "analytics",
];
export async function fixture(label: string) {
  if (getConfig().mode !== "demo")
    throw new Error(
      "Integration fixtures are allowed only in the isolated local test environment.",
    );
  const suffix = randomUUID(),
    email = `test-${suffix}@mediaflock.local`,
    password = "MediaFlock-isolated-test-2026!";
  const { data, error } = await storageAdmin().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user)
    throw new Error("Could not create isolated local test user.");
  const workspace = (
    await db().query(
      "insert into workspaces(name,mode) values($1,'demo') returning id",
      ["Test: " + label + " " + suffix],
    )
  ).rows[0];
  await db().query(
    "insert into memberships(workspace_id,user_id,role) values($1,$2,'owner')",
    [workspace.id, data.user.id],
  );
  const ctx: Context = {
    workspaceId: workspace.id,
    userId: data.user.id,
    role: "owner",
    kind: "human",
    scopes,
  };
  const account = await makeAccount(ctx);
  return { ctx, account, email, password };
}
export async function makeAccount(
  ctx: Context,
  fault?: string,
  platform = "x",
) {
  const id = randomUUID();
  return (
    await db().query(
      "insert into social_accounts(id,workspace_id,provider_account_id,platform,handle,display_name,account_type,status,capabilities,posting_preferences,provenance) values($1,$2,$3,$4,$5,'Isolated fixture','test','connected',$6,$7,'simulated') returning *",
      [
        id,
        ctx.workspaceId,
        "test_provider_" + id,
        platform,
        "@test_" + id.slice(0, 8),
        {
          operations: { publish: "supported", feed: "supported" },
          formats: {
            text: "supported",
            image: "supported",
            video: "supported",
          },
          metrics: {
            views: "supported",
            likes: "supported",
            comments: "supported",
            shares: "supported",
          },
        },
        { demoFault: fault },
      ],
    )
  ).rows[0];
}
export async function draft(
  ctx: Context,
  accountId: string,
  title = "Isolated test",
  media: any[] = [],
) {
  const pkg = await domain.createPackage(ctx, {
    title,
    brief: "Explain the creative process with a clear hook.",
    sourceNotes: "Original isolated fixture",
    assetIds: media.map((x) => x.assetId),
  });
  const variant = await domain.createVariant(ctx, {
    packageId: pkg!.id,
    accountId,
    format: media.length ? "image" : "text",
    payload: {
      hook: "A clear hook",
      caption: "A practical explanation.",
      media,
    },
  });
  return { pkg, variant };
}
export async function approved(
  ctx: Context,
  accountId: string,
  scheduledAt = new Date(Date.now() - 1000).toISOString(),
) {
  const { pkg, variant } = await draft(ctx, accountId);
  const approval = await domain.requestApproval(ctx, {
    variantId: variant.id,
    revisionId: variant.current_revision_id,
    scheduledAt,
  });
  await domain.decideApproval(ctx, approval!.id, "approved");
  return { pkg, variant, approval };
}
export async function delivery(
  ctx: Context,
  accountId: string,
  scheduledAt?: string,
) {
  const data = await approved(ctx, accountId, scheduledAt);
  return {
    ...data,
    job: await domain.scheduleApproved(ctx, data.approval!.id),
  };
}
export async function due(id: string) {
  await db().query(
    "update publish_jobs set next_run_at=now(),lease_expires_at=null where id=$1",
    [id],
  );
}
