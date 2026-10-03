import { scoped, db, one, audit, type Context } from "../db";
import { authorize, humanReviewer } from "./auth";
import { getConfig } from "./config";
import { requireCondition } from "./errors";
import { listJobs } from "./approvals";
export async function overview(ctx: Context) {
  authorize(ctx, "read");
  return scoped(ctx, async (tx) => {
    const workspace = await one(tx, "select * from workspaces where id=$1", [
      ctx.workspaceId,
    ]);
    const pending = await one(
      tx,
      "select count(*)::int as n from approvals where workspace_id=$1 and status='pending'",
      [ctx.workspaceId],
    );
    const totals = (
      await tx.query(
        "select state,count(*)::int as count from publish_jobs where workspace_id=$1 group by state",
        [ctx.workspaceId],
      )
    ).rows;
    const upcoming = (
      await tx.query(
        "select j.id,j.state,a.handle,a.platform,ap.scheduled_at,p.title from publish_jobs j join publication_targets t on t.id=j.target_id join approvals ap on ap.id=t.approval_id join social_accounts a on a.id=j.account_id join platform_variants v on v.id=ap.variant_id join content_packages p on p.id=v.package_id where j.workspace_id=$1 and j.state in ('queued','scheduled','processing','submitting','needs_reconciliation') order by ap.scheduled_at limit 8",
        [ctx.workspaceId],
      )
    ).rows;
    return {
      workspace,
      pendingApprovals: pending!.n,
      pending: (
        await tx.query(
          "select ap.id,p.title,a.handle,ap.scheduled_at from approvals ap join platform_variants v on v.id=ap.variant_id join content_packages p on p.id=v.package_id join social_accounts a on a.id=ap.account_id where ap.workspace_id=$1 and ap.status='pending' order by ap.created_at limit 5",
          [ctx.workspaceId],
        )
      ).rows,
      totals,
      upcoming,
      connectionProblems: (
        await tx.query(
          "select id,platform,handle,status from social_accounts where workspace_id=$1 and status<>'connected'",
          [ctx.workspaceId],
        )
      ).rows,
      recentResults: (
        await tx.query(
          "select j.id,j.state,j.published_at,j.updated_at,a.handle,a.platform,j.error from publish_jobs j join social_accounts a on a.id=j.account_id where j.workspace_id=$1 and j.state in ('published','failed','cancelled') order by j.updated_at desc limit 5",
          [ctx.workspaceId],
        )
      ).rows,
      experiments: (
        await tx.query(
          "select id,name,hypothesis,status from experiments where workspace_id=$1 and status='active' order by created_at desc limit 5",
          [ctx.workspaceId],
        )
      ).rows,
    };
  });
}
export async function activity(ctx: Context) {
  authorize(ctx, "read");
  return scoped(
    ctx,
    async (tx) =>
      (
        await tx.query(
          "select * from audit_events where workspace_id=$1 order by created_at desc limit 200",
          [ctx.workspaceId],
        )
      ).rows,
  );
}
export async function settings(ctx: Context) {
  authorize(ctx, "read");
  const data = await scoped(ctx, async (tx) => ({
    workspace: await one(tx, "select * from workspaces where id=$1", [
      ctx.workspaceId,
    ]),
    tokens:
      ctx.kind === "human" && ["owner", "reviewer"].includes(ctx.role)
        ? (
            await tx.query(
              "select id,name,prefix,scopes,expires_at,revoked_at,created_at from api_tokens where workspace_id=$1 order by created_at desc",
              [ctx.workspaceId],
            )
          ).rows
        : [],
  }));
  const c = getConfig();
  return {
    ...data,
    worker: (
      await db().query(
        "select id,started_at,heartbeat_at,status,jobs_processed,last_error,(status='running' and heartbeat_at>now()-interval '60 seconds') as healthy from worker_health order by heartbeat_at desc limit 3",
      )
    ).rows,
    integrations: {
      mode: c.mode,
      publishing:
        c.mode === "demo"
          ? "Simulated provider ready"
          : process.env.POSTFORME_API_KEY
            ? c.livePublishing
              ? "Configured · live verification required"
              : "API key configured · live publishing disabled"
            : "Missing Post for Me API key",
      ai:
        c.mode === "demo"
          ? "Deterministic fixture AI ready"
          : process.env.OPENAI_API_KEY && process.env.OPENAI_MODEL
            ? "Configured · live verification required"
            : "Unavailable · manual editing available",
      storage: "Private Supabase Storage",
      connection:
        c.mode === "demo"
          ? "Isolated fixture accounts"
          : process.env.POSTFORME_CONNECTION_REDIRECT_ENABLED === "true"
            ? "Callback configured · verify account permissions"
            : "Configure provider callback redirect",
      webhooks: "Disabled; authenticated provider mechanism is not documented",
    },
    commands: { web: "pnpm dev", worker: "pnpm worker", mcp: "pnpm mcp" },
  };
}
export async function updateWorkspace(
  ctx: Context,
  name: string,
  timezone: string,
) {
  humanReviewer(ctx);
  requireCondition(
    name.trim().length > 0 && name.length <= 100,
    "invalid_name",
    "Workspace name must be 1–100 characters.",
  );
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
  } catch {
    requireCondition(
      false,
      "invalid_timezone",
      "Choose a valid IANA timezone.",
    );
  }
  return scoped(ctx, async (tx) => {
    const row = await one(
      tx,
      "update workspaces set name=$1,timezone=$2 where id=$3 returning *",
      [name, timezone, ctx.workspaceId],
    );
    await audit(tx, ctx, "workspace.updated", "workspace", ctx.workspaceId, {
      name,
      timezone,
    });
    return row;
  });
}
export async function requestReconciliation(ctx: Context, id: string) {
  authorize(ctx, "schedule");
  return scoped(ctx, async (tx) => {
    const row = await one(
      tx,
      "update publish_jobs set next_run_at=now() where id=$1 and workspace_id=$2 and state='needs_reconciliation' returning id",
      [id, ctx.workspaceId],
    );
    requireCondition(
      row,
      "invalid_state",
      "Only uncertain deliveries need reconciliation.",
    );
    await audit(
      tx,
      ctx,
      "delivery.reconciliation_requested",
      "publish_job",
      id,
    );
    return row;
  });
}
export async function rescheduleJob(
  ctx: Context,
  id: string,
  scheduledAt: string,
) {
  authorize(ctx, "schedule");
  const jobs = await listJobs(ctx),
    job = jobs.find((x) => x.id === id);
  requireCondition(job, "not_found", "Publication not found.", 404);
  requireCondition(
    job.state === "cancelled",
    "cancel_first",
    "Cancel the old delivery and wait for confirmed cancellation before requesting a new schedule.",
    409,
  );
  const { requestApproval } = await import("./approvals");
  return requestApproval(ctx, {
    variantId: job.snapshot.variantId,
    revisionId: job.snapshot.revisionId,
    scheduledAt,
  });
}
