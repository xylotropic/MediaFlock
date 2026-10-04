import { scoped, one, type Context, type Tx } from "../db";
import { authorize } from "../domain/auth";
import { requireCondition } from "../domain/errors";
import {
  periodChanges,
  recordedChanges,
  comparableMeasurements,
  measurementGroups,
  type Metric,
} from "./metrics";
export { normalizeMetrics, periodChanges } from "./metrics";
export type { Metric, Availability } from "./metrics";
export function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b),
    m = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
}
export function latestLifetime(rows: Record<string, any>[], metric: string) {
  const map = new Map<string, Record<string, any>>();
  for (const row of rows.filter(
    (x) => x.metric === metric && x.scope === "lifetime",
  )) {
    const previous = map.get(row.job_id);
    if (!previous || new Date(row.observed_at) > new Date(previous.observed_at))
      map.set(row.job_id, row);
  }
  return [...map.values()];
}
export async function storeMetrics(
  tx: Tx,
  workspaceId: string,
  job: any,
  account: any,
  horizon: number,
  metrics: Metric[],
  raw: unknown,
  observedAt = new Date().toISOString(),
) {
  for (const m of metrics)
    await tx.query(
      `insert into metric_snapshots(workspace_id,account_id,job_id,platform_post_id,metric,definition,value,unit,denominator,scope,availability,horizon_hours,observed_at,provenance,raw) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) on conflict(job_id,metric,horizon_hours) do nothing`,
      [
        workspaceId,
        account.id,
        job.id,
        job.platform_post_id,
        m.metric,
        m.definition,
        m.value,
        m.unit,
        m.denominator || null,
        m.scope,
        m.availability,
        horizon,
        observedAt,
        account.provenance,
        raw,
      ],
    );
}
export async function getAnalytics(
  ctx: Context,
  accountId?: string,
  period?: { start: string; end: string },
) {
  authorize(ctx, "analytics");
  return scoped(ctx, async (tx) => {
    if (accountId)
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
    const rows = (
      await tx.query(
        "select m.*,a.handle,a.platform,v.format,p.title,j.published_at from metric_snapshots m join social_accounts a on a.id=m.account_id join publish_jobs j on j.id=m.job_id join publication_targets t on t.id=j.target_id join approvals ap on ap.id=t.approval_id join platform_variants v on v.id=ap.variant_id join content_packages p on p.id=v.package_id where m.workspace_id=$1 and ($2::uuid is null or m.account_id=$2) order by m.observed_at desc",
        [ctx.workspaceId, accountId || null],
      )
    ).rows;
    const start =
      period?.start || new Date(Date.now() - 30 * 86400000).toISOString();
    const end = period?.end || new Date().toISOString();
    requireCondition(
      Number.isFinite(Date.parse(start)) &&
        Number.isFinite(Date.parse(end)) &&
        Date.parse(start) < Date.parse(end),
      "invalid_period",
      "Choose a valid period with the end after the start.",
    );
    const baselines = rows.map((row) => {
      const peers = rows.filter(
        (x) =>
          x.job_id !== row.job_id &&
          comparableMeasurements(x, row) &&
          x.availability === "available",
      );
      const baseline = median(peers.map((x) => Number(x.value)));
      return {
        ...row,
        baseline: {
          median: baseline,
          count: peers.length,
          difference:
            row.availability === "available" && baseline !== null
              ? Number(row.value) - baseline
              : null,
          evidenceIds: peers.map((x) => x.id),
          method:
            "Other posts from the same account, format, metric definition and observation horizon. Descriptive only.",
        },
      };
    });
    const latest = latestLifetime(rows, "views");
    const periodPosts = latest.filter(
      (x) =>
        x.published_at &&
        Date.parse(x.published_at) >= Date.parse(start) &&
        Date.parse(x.published_at) < Date.parse(end),
    );
    const nameChange = (x: ReturnType<typeof periodChanges>[number]) => ({
      ...x,
      title: rows.find((r) => r.job_id === x.jobId)?.title,
      handle: rows.find((r) => r.job_id === x.jobId)?.handle,
    });
    const changes = periodChanges(rows, "views", start, end).map(nameChange);
    const recorded = recordedChanges(rows, "views", start, end).map(nameChange);
    const available = latest.filter((row) => row.availability === "available");
    const groups = measurementGroups(available);
    return {
      observations: baselines,
      period: {
        start,
        end,
        postPerformance: periodPosts,
        metricChanges: changes,
        recordedChanges: recorded,
        note: "Post performance uses the latest lifetime counter for posts published during this period. Net changes cover only their displayed interval between recorded updates, not the full date range. Missing or incompatible updates remain unavailable.",
      },
      summary: {
        posts: latest.length,
        availablePosts: available.length,
        medianViews:
          groups.length === 1 &&
          groups[0].observations.length === available.length
            ? median(groups[0].observations.map((row) => Number(row.value)))
            : null,
        measurementGroups: groups.map((group) => ({
          key: group.key,
          label: group.label,
          median: median(group.observations.map((row) => Number(row.value))),
          posts: group.observations.length,
        })),
        lastObservedAt:
          rows.find((row) => row.availability === "available")?.observed_at ||
          null,
        lastRecordedAt: rows[0]?.observed_at || null,
      },
      collections: (
        await tx.query(
          "select mc.*,a.handle from metric_collection_jobs mc join publish_jobs j on j.id=mc.job_id join social_accounts a on a.id=j.account_id where mc.workspace_id=$1 and ($2::uuid is null or j.account_id=$2) order by due_at desc",
          [ctx.workspaceId, accountId || null],
        )
      ).rows,
      notes: [
        "Example observations are explicitly labeled simulated in demo mode.",
        "Each post contributes one latest lifetime value; snapshots are never summed.",
        "Cross-platform reach is not deduplicated people.",
        "Missing or permission-blocked metrics are not zero.",
      ],
    };
  });
}
export async function postMetrics(ctx: Context, jobId: string) {
  authorize(ctx, "analytics");
  return scoped(ctx, async (tx) => {
    requireCondition(
      await one(
        tx,
        "select id from publish_jobs where id=$1 and workspace_id=$2",
        [jobId, ctx.workspaceId],
      ),
      "not_found",
      "Publication not found.",
      404,
    );
    return (
      await tx.query(
        "select * from metric_snapshots where job_id=$1 and workspace_id=$2 order by observed_at,metric",
        [jobId, ctx.workspaceId],
      )
    ).rows;
  });
}
export async function collectDemoNow(ctx: Context, jobId: string) {
  authorize(ctx, "analytics");
  requireCondition(
    process.env.MEDIAFLOCK_MODE === "demo",
    "demo_only",
    "Early fixture collection is available only in demo mode.",
    403,
  );
  return scoped(ctx, async (tx) => {
    const job = await one(
      tx,
      "select id from publish_jobs where id=$1 and workspace_id=$2 and state='published'",
      [jobId, ctx.workspaceId],
    );
    requireCondition(
      job,
      "not_published",
      "A confirmed simulated publication is required.",
    );
    const row = await one(
      tx,
      "insert into metric_collection_jobs(workspace_id,job_id,horizon_hours,due_at) values($1,$2,24,now()) on conflict(job_id,horizon_hours) do update set due_at=now(),state='queued' returning *",
      [ctx.workspaceId, jobId],
    );
    return row;
  });
}
