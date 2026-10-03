import { scoped, one, audit, type Context, type Tx } from "../db";
import { authorize, contentHash } from "./auth";
import { requireCondition } from "./errors";
import {
  packageInput,
  variantInput,
  revisionPayload,
  type RevisionPayload,
} from "../schemas";
export async function listAccounts(ctx: Context) {
  authorize(ctx, "read");
  return scoped(
    ctx,
    async (tx) =>
      (
        await tx.query(
          "select * from social_accounts where workspace_id=$1 order by platform,handle",
          [ctx.workspaceId],
        )
      ).rows,
  );
}
export async function getAccount(ctx: Context, id: string) {
  authorize(ctx, "read");
  return scoped(ctx, async (tx) => {
    const a = await one(
      tx,
      "select * from social_accounts where id=$1 and workspace_id=$2",
      [id, ctx.workspaceId],
    );
    requireCondition(a, "not_found", "Account not found.", 404);
    return a;
  });
}
export async function listPackages(ctx: Context) {
  authorize(ctx, "read");
  return scoped(
    ctx,
    async (tx) =>
      (
        await tx.query(
          `select p.*,(select count(*)::int from platform_variants v where v.package_id=p.id) as variant_count,(select array_agg(asset_id order by position) from content_assets a where a.package_id=p.id) as asset_ids from content_packages p where p.workspace_id=$1 order by p.updated_at desc`,
          [ctx.workspaceId],
        )
      ).rows,
  );
}
export async function createPackage(ctx: Context, input: unknown) {
  authorize(ctx, "draft");
  const data = packageInput.parse(input);
  return scoped(ctx, async (tx) => {
    const row = await one(
      tx,
      "insert into content_packages(workspace_id,title,source_notes,brief,tags,created_by) values($1,$2,$3,$4,$5,$6) returning *",
      [
        ctx.workspaceId,
        data.title,
        data.sourceNotes,
        data.brief,
        data.tags,
        ctx.userId,
      ],
    );
    for (const [position, id] of data.assetIds.entries()) {
      requireCondition(
        await one(tx, "select id from assets where id=$1 and workspace_id=$2", [
          id,
          ctx.workspaceId,
        ]),
        "invalid_asset",
        "Asset belongs to another workspace or does not exist.",
      );
      await tx.query(
        "insert into content_assets(workspace_id,package_id,asset_id,position) values($1,$2,$3,$4)",
        [ctx.workspaceId, row!.id, id, position],
      );
    }
    await tx.query(
      "insert into content_revisions(workspace_id,package_id,revision,payload,content_hash,created_by,provenance) values($1,$2,1,$3,$4,$5,'manual')",
      [ctx.workspaceId, row!.id, data, contentHash(data), ctx.userId],
    );
    await audit(tx, ctx, "package.created", "content_package", row!.id);
    return row;
  });
}
export async function updatePackage(ctx: Context, id: string, input: unknown) {
  authorize(ctx, "draft");
  const data = packageInput.parse(input);
  return scoped(ctx, async (tx) => {
    const row = await one(
      tx,
      "select * from content_packages where id=$1 and workspace_id=$2 for update",
      [id, ctx.workspaceId],
    );
    requireCondition(row, "not_found", "Package not found.", 404);
    for (const assetId of data.assetIds)
      requireCondition(
        await one(tx, "select id from assets where id=$1 and workspace_id=$2", [
          assetId,
          ctx.workspaceId,
        ]),
        "invalid_asset",
        "Asset belongs to another workspace.",
      );
    await tx.query(
      "delete from content_assets where package_id=$1 and workspace_id=$2",
      [id, ctx.workspaceId],
    );
    for (const [position, assetId] of data.assetIds.entries())
      await tx.query(
        "insert into content_assets(workspace_id,package_id,asset_id,position) values($1,$2,$3,$4)",
        [ctx.workspaceId, id, assetId, position],
      );
    const count = await one(
      tx,
      "select coalesce(max(revision),0)+1 as n from content_revisions where package_id=$1 and variant_id is null",
      [id],
    );
    await tx.query(
      "insert into content_revisions(workspace_id,package_id,revision,payload,content_hash,created_by,provenance) values($1,$2,$3,$4,$5,$6,'manual')",
      [ctx.workspaceId, id, count!.n, data, contentHash(data), ctx.userId],
    );
    await tx.query(
      "update content_packages set title=$1,source_notes=$2,brief=$3,tags=$4,updated_at=now() where id=$5 and workspace_id=$6",
      [
        data.title,
        data.sourceNotes,
        data.brief,
        data.tags,
        id,
        ctx.workspaceId,
      ],
    );
    await audit(tx, ctx, "package.updated", "content_package", id);
    return { ...row, ...data };
  });
}
export async function getPackage(
  ctx: Context,
  id: string,
): Promise<
  Record<string, any> & { id: string; variants: any[]; assets: any[] }
> {
  authorize(ctx, "read");
  return scoped(ctx, async (tx) => {
    const row = await one(
      tx,
      "select * from content_packages where id=$1 and workspace_id=$2",
      [id, ctx.workspaceId],
    );
    requireCondition(row, "not_found", "Content package not found.", 404);
    const variants = (
      await tx.query(
        `select v.*,a.platform,a.handle,a.display_name,r.payload,r.content_hash,r.revision,r.provenance from platform_variants v join social_accounts a on a.id=v.account_id join content_revisions r on r.id=v.current_revision_id where v.package_id=$1 and v.workspace_id=$2 order by v.created_at`,
        [id, ctx.workspaceId],
      )
    ).rows;
    const assets = (
      await tx.query(
        "select a.* from content_assets ca join assets a on a.id=ca.asset_id where ca.package_id=$1 and ca.workspace_id=$2 order by ca.position",
        [id, ctx.workspaceId],
      )
    ).rows;
    return { ...row!, variants, assets };
  });
}
async function insertRevision(
  tx: Tx,
  ctx: Context,
  variant: Record<string, any>,
  payload: RevisionPayload,
  provenance: string,
) {
  const metadata = [];
  for (const m of payload.media) {
    const asset = await one(
      tx,
      "select * from assets where id=$1 and workspace_id=$2",
      [m.assetId, ctx.workspaceId],
    );
    requireCondition(
      asset,
      "invalid_asset",
      "Media asset is not accessible in this workspace.",
    );
    let derivative;
    if (m.derivativeId) {
      derivative = await one(
        tx,
        "select * from asset_derivatives where id=$1 and asset_id=$2 and workspace_id=$3 and status='ready'",
        [m.derivativeId, m.assetId, ctx.workspaceId],
      );
      requireCondition(
        derivative,
        "invalid_derivative",
        "Choose a completed derivative of the selected asset.",
      );
    }
    metadata.push({
      assetId: asset.id,
      checksum: asset.checksum,
      derivativeId: derivative?.id || null,
      derivativeChecksum: derivative?.checksum || null,
    });
  }
  const max = await one(
    tx,
    "select coalesce(max(revision),0)+1 as n from content_revisions where variant_id=$1",
    [variant.id],
  );
  const revision = await one(
    tx,
    "insert into content_revisions(workspace_id,package_id,variant_id,revision,payload,content_hash,created_by,provenance) values($1,$2,$3,$4,$5,$6,$7,$8) returning *",
    [
      ctx.workspaceId,
      variant.package_id,
      variant.id,
      max!.n,
      payload,
      contentHash({
        accountId: variant.account_id,
        format: variant.format,
        payload,
        media: metadata,
      }),
      ctx.userId,
      provenance,
    ],
  );
  for (const [position, m] of payload.media.entries())
    await tx.query(
      "insert into revision_assets(workspace_id,revision_id,asset_id,derivative_id,position) values($1,$2,$3,$4,$5)",
      [ctx.workspaceId, revision!.id, m.assetId, m.derivativeId, position],
    );
  await tx.query(
    "update platform_variants set current_revision_id=$1 where id=$2 and workspace_id=$3",
    [revision!.id, variant.id, ctx.workspaceId],
  );
  return revision!;
}
export async function createVariant(
  ctx: Context,
  input: unknown,
  provenance = "manual",
) {
  authorize(ctx, "draft");
  const data = variantInput.parse(input);
  return scoped(ctx, async (tx) => {
    requireCondition(
      await one(
        tx,
        "select id from content_packages where id=$1 and workspace_id=$2",
        [data.packageId, ctx.workspaceId],
      ),
      "invalid_package",
      "Content package not found in this workspace.",
    );
    const account = await one(
      tx,
      "select * from social_accounts where id=$1 and workspace_id=$2",
      [data.accountId, ctx.workspaceId],
    );
    requireCondition(
      account,
      "invalid_account",
      "Account not found in this workspace.",
    );
    requireCondition(
      account.capabilities.formats?.[data.format] === "supported",
      "unsupported_format",
      "Selected account has no verified support for this format.",
    );
    const variant = await one(
      tx,
      "insert into platform_variants(workspace_id,package_id,account_id,format) values($1,$2,$3,$4) returning *",
      [ctx.workspaceId, data.packageId, data.accountId, data.format],
    );
    const revision = await insertRevision(
      tx,
      ctx,
      variant!,
      data.payload,
      provenance,
    );
    await audit(tx, ctx, "variant.created", "variant", variant!.id, {
      revisionId: revision.id,
      provenance,
    });
    return {
      ...variant!,
      current_revision_id: revision.id,
      payload: revision.payload,
      revision: revision.revision,
      content_hash: revision.content_hash,
    };
  });
}
export async function editVariant(
  ctx: Context,
  id: string,
  expectedRevisionId: string,
  input: unknown,
) {
  authorize(ctx, "draft");
  const payload = revisionPayload.parse(input);
  return scoped(ctx, async (tx) => {
    const variant = await one(
      tx,
      "select * from platform_variants where id=$1 and workspace_id=$2 for update",
      [id, ctx.workspaceId],
    );
    requireCondition(variant, "not_found", "Variant not found.", 404);
    requireCondition(
      variant.current_revision_id === expectedRevisionId,
      "revision_conflict",
      "This variant changed. Refresh before editing.",
      409,
    );
    const pending = await one(
      tx,
      `select j.id from publish_jobs j join publication_targets t on t.id=j.target_id join approvals a on a.id=t.approval_id where a.variant_id=$1 and j.state not in ('failed','cancelled','published') limit 1`,
      [id],
    );
    requireCondition(
      !pending,
      "delivery_active",
      "Cancel the existing delivery and wait for confirmation before editing this variant.",
      409,
    );
    const revision = await insertRevision(tx, ctx, variant, payload, "manual");
    await tx.query(
      "update approvals set status='revoked',decided_at=now(),reason='Content changed after approval request' where variant_id=$1 and workspace_id=$2 and status in ('pending','approved')",
      [id, ctx.workspaceId],
    );
    await audit(tx, ctx, "variant.revised", "variant", id, {
      previousRevisionId: expectedRevisionId,
      revisionId: revision.id,
    });
    return {
      ...variant!,
      current_revision_id: revision.id,
      payload: revision.payload,
      revision: revision.revision,
      content_hash: revision.content_hash,
    };
  });
}
export async function listRevisions(ctx: Context, id: string) {
  authorize(ctx, "read");
  return scoped(
    ctx,
    async (tx) =>
      (
        await tx.query(
          "select * from content_revisions where variant_id=$1 and workspace_id=$2 order by revision desc",
          [id, ctx.workspaceId],
        )
      ).rows,
  );
}
export async function addAccountRule(
  ctx: Context,
  accountId: string,
  text: string,
) {
  authorize(ctx, "draft");
  requireCondition(
    text.trim().length > 0 && text.length <= 2000,
    "invalid_rule",
    "Rule must be 1–2000 characters.",
  );
  return scoped(ctx, async (tx) => {
    requireCondition(
      await one(
        tx,
        "select id from social_accounts where id=$1 and workspace_id=$2",
        [accountId, ctx.workspaceId],
      ),
      "not_found",
      "Account not found.",
      404,
    );
    const row = await one(
      tx,
      "insert into account_rules(workspace_id,account_id,text,source,created_by) values($1,$2,$3,'user',$4) returning *",
      [ctx.workspaceId, accountId, text, ctx.userId],
    );
    await audit(tx, ctx, "rule.created", "account_rule", row!.id);
    return row;
  });
}
export async function accountContext(ctx: Context, accountId: string) {
  authorize(ctx, "read");
  return scoped(ctx, async (tx) => {
    const account = await one(
      tx,
      "select * from social_accounts where id=$1 and workspace_id=$2",
      [accountId, ctx.workspaceId],
    );
    requireCondition(account, "not_found", "Account not found.", 404);
    return {
      account,
      rules: (
        await tx.query(
          "select * from account_rules where account_id=$1 and workspace_id=$2 and active order by created_at",
          [accountId, ctx.workspaceId],
        )
      ).rows,
      observations: (
        await tx.query(
          "select * from account_observations where account_id=$1 and workspace_id=$2 order by last_evaluated_at desc",
          [accountId, ctx.workspaceId],
        )
      ).rows,
    };
  });
}
