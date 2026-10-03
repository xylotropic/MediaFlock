import { scoped, one, audit, type Context } from "../db";
import { authorize, humanReviewer } from "../domain/auth";
import { requireCondition } from "../domain/errors";
import { experimentInput } from "../schemas";
import { median } from "../analytics";
export interface ComparisonRow {
  snapshotId: string;
  jobId: string;
  accountId: string;
  format: string;
  arm: "A" | "B";
  value: number | null;
  availability: string;
  horizonHours: number;
  definition: string;
  denominator: string | null;
  publishedAt: string;
  packageId: string;
}
export function compareExperiment(
  rows: ComparisonRow[],
  plannedSamples: number,
  changedVariable?: string,
) {
  const unique = new Map<string, ComparisonRow>();
  for (const r of rows) if (!unique.has(r.jobId)) unique.set(r.jobId, r);
  const valid = [...unique.values()].filter(
    (x) => x.availability === "available" && x.value !== null,
  );
  const strata = new Map<string, ComparisonRow[]>();
  for (const row of valid) {
    const key = [
      row.accountId,
      changedVariable === "format"
        ? "deliberate-format-comparison"
        : row.format,
      row.horizonHours,
      row.definition,
      row.denominator,
    ].join("|");
    strata.set(key, [...(strata.get(key) || []), row]);
  }
  const groups = [...strata.values()].map((list) => {
    const A = list.filter((x) => x.arm === "A"),
      B = list.filter((x) => x.arm === "B"),
      a = median(A.map((x) => x.value!)),
      b = median(B.map((x) => x.value!));
    const enough = A.length >= plannedSamples && B.length >= plannedSamples;
    const sourceCount = new Set(list.map((x) => x.packageId)).size;
    return {
      accountId: list[0].accountId,
      format:
        changedVariable === "format"
          ? [...new Set(list.map((x) => x.format))].join(" vs ")
          : list[0].format,
      horizonHours: list[0].horizonHours,
      definition: list[0].definition,
      denominator: list[0].denominator,
      A: { count: A.length, median: a },
      B: { count: B.length, median: b },
      difference: a !== null && b !== null ? b - a : null,
      relativeDifference:
        a !== null && b !== null && a > 0 ? (b - a) / a : null,
      status:
        enough && sourceCount >= plannedSamples * 2
          ? "Observational signal"
          : "Insufficient evidence",
      independentSources: sourceCount,
      evidenceIds: list.map((x) => x.snapshotId),
      limitations:
        "Organic audience assignment is uncontrolled. Timing, topic, audience and shared-source dependence can explain differences. This comparison does not establish causation.",
    };
  });
  return {
    groups,
    totalAssignedPosts: unique.size,
    availablePosts: valid.length,
    coverage: unique.size ? valid.length / unique.size : 0,
    status: groups.some((x) => x.status === "Observational signal")
      ? "Observational signal"
      : "Insufficient evidence",
    limitations:
      changedVariable === "format"
        ? "Deliberate format comparison within the same account, metric definition and horizon. Format changes may affect view definitions or audience selection. Organic differences are observational."
        : "Post-level sample counts, matched account/format/metric/horizon only. Views are not independent experimental replications.",
    nextAction: groups.some((x) => x.status === "Observational signal")
      ? "Repeat the changed variable with new source content and balanced posting windows; keep other choices stable."
      : "Collect at least the planned number of distinct source posts per arm at the same observation horizon. No winner can be declared yet.",
  };
}
export async function createExperiment(ctx: Context, input: unknown) {
  authorize(ctx, "draft");
  const data = experimentInput.parse(input);
  requireCondition(
    data.primaryMetric !== "engagement_rate" || !!data.denominator,
    "denominator_required",
    "Choose the denominator for engagement rate.",
  );
  return scoped(ctx, async (tx) => {
    for (const selected of data.accounts)
      requireCondition(
        await one(
          tx,
          "select id from social_accounts where id=$1 and workspace_id=$2",
          [selected.accountId, ctx.workspaceId],
        ),
        "invalid_account",
        "Experiment account belongs to another workspace.",
      );
    const row = await one(
      tx,
      "insert into experiments(workspace_id,name,hypothesis,changed_variable,primary_metric,denominator,horizon_hours,planned_samples,start_at,end_at,end_condition,created_by) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning *",
      [
        ctx.workspaceId,
        data.name,
        data.hypothesis,
        data.changedVariable,
        data.primaryMetric,
        data.denominator,
        data.horizonHours,
        data.plannedSamples,
        data.startAt,
        data.endAt,
        data.endCondition,
        ctx.userId,
      ],
    );
    for (const a of data.accounts)
      await tx.query(
        "insert into experiment_accounts(workspace_id,experiment_id,account_id,formats) values($1,$2,$3,$4)",
        [ctx.workspaceId, row!.id, a.accountId, a.formats],
      );
    await audit(tx, ctx, "experiment.created", "experiment", row!.id);
    return row;
  });
}
export async function assignVariant(
  ctx: Context,
  experimentId: string,
  variantId: string,
  revisionId: string,
  arm: "A" | "B",
) {
  authorize(ctx, "draft");
  requireCondition(
    ["A", "B"].includes(arm),
    "invalid_arm",
    "Choose arm A or B.",
  );
  return scoped(ctx, async (tx) => {
    const experiment = await one(
      tx,
      "select * from experiments where id=$1 and workspace_id=$2 for share",
      [experimentId, ctx.workspaceId],
    );
    requireCondition(experiment, "not_found", "Experiment not found.", 404);
    const variant = await one(
      tx,
      "select * from platform_variants where id=$1 and workspace_id=$2",
      [variantId, ctx.workspaceId],
    );
    requireCondition(
      variant?.current_revision_id === revisionId,
      "invalid_revision",
      "Assign a current revision in this workspace.",
    );
    const account = await one(
      tx,
      "select * from experiment_accounts where experiment_id=$1 and account_id=$2 and workspace_id=$3",
      [experimentId, variant.account_id, ctx.workspaceId],
    );
    requireCondition(
      account?.formats.includes(variant.format),
      "ineligible_variant",
      "Account or format is outside this experiment.",
    );
    const row = await one(
      tx,
      "insert into experiment_assignments(workspace_id,experiment_id,variant_id,revision_id,arm) values($1,$2,$3,$4,$5) returning *",
      [ctx.workspaceId, experimentId, variantId, revisionId, arm],
    );
    await audit(tx, ctx, "experiment.assigned", "experiment", experimentId, {
      variantId,
      revisionId,
      arm,
    });
    return row;
  });
}
export async function listExperiments(ctx: Context) {
  authorize(ctx, "read");
  return scoped(
    ctx,
    async (tx) =>
      (
        await tx.query(
          "select e.*,(select count(*)::int from experiment_assignments a where a.experiment_id=e.id) as assignment_count from experiments e where workspace_id=$1 order by created_at desc",
          [ctx.workspaceId],
        )
      ).rows,
  );
}
export async function experimentResults(ctx: Context, id: string) {
  authorize(ctx, "read");
  return scoped(ctx, async (tx) => {
    const experiment = await one(
      tx,
      "select * from experiments where id=$1 and workspace_id=$2",
      [id, ctx.workspaceId],
    );
    requireCondition(experiment, "not_found", "Experiment not found.", 404);
    const assignments = (
      await tx.query(
        "select ea.*,v.account_id,v.format,v.current_revision_id,a.handle,a.platform,r.payload,p.title,p.id as package_id from experiment_assignments ea join platform_variants v on v.id=ea.variant_id join social_accounts a on a.id=v.account_id join content_revisions r on r.id=ea.revision_id join content_packages p on p.id=v.package_id where ea.experiment_id=$1 and ea.workspace_id=$2",
        [id, ctx.workspaceId],
      )
    ).rows;
    const metrics = (
      await tx.query(
        `select m.*,ea.arm,v.format,v.package_id,j.published_at from experiment_assignments ea join platform_variants v on v.id=ea.variant_id join approvals ap on ap.variant_id=v.id and ap.revision_id=ea.revision_id join publication_targets t on t.approval_id=ap.id join publish_jobs j on j.target_id=t.id and j.state='published' join metric_snapshots m on m.job_id=j.id where ea.experiment_id=$1 and ea.workspace_id=$2 and m.horizon_hours=$3 and ($4='engagement_rate' or m.metric=$4) and ($5::timestamptz is null or j.published_at>=$5) and ($6::timestamptz is null or j.published_at<=$6)`,
        [
          id,
          ctx.workspaceId,
          experiment.horizon_hours,
          experiment.primary_metric,
          experiment.start_at,
          experiment.end_at,
        ],
      )
    ).rows;
    let selected = metrics;
    if (experiment.primary_metric === "engagement_rate") {
      const posts = new Map<string, any[]>();
      metrics.forEach((x) =>
        posts.set(x.job_id, [...(posts.get(x.job_id) || []), x]),
      );
      selected = [...posts.values()].map((list) => {
        const denominator = list.find(
            (x) => x.metric === experiment.denominator,
          ),
          values = ["likes", "comments", "shares"].map((metric) =>
            list.find((x) => x.metric === metric),
          );
        const valid =
          denominator?.availability === "available" &&
          Number(denominator.value) > 0 &&
          values.every((x) => x?.availability === "available");
        return {
          ...list[0],
          value: valid
            ? values.reduce((sum, x) => sum + Number(x.value), 0) /
              Number(denominator.value)
            : null,
          availability: valid ? "available" : "unknown",
          definition: `(likes + comments + shares) / ${experiment.denominator}`,
          denominator: experiment.denominator,
          evidence_ids: list.map((x) => x.id),
        };
      });
    }
    const comparison = compareExperiment(
      selected.map((x) => ({
        snapshotId: x.id,
        jobId: x.job_id,
        accountId: x.account_id,
        format: x.format,
        arm: x.arm,
        value: x.value === null ? null : Number(x.value),
        availability: x.availability,
        horizonHours: x.horizon_hours,
        definition: x.definition,
        denominator: x.denominator,
        publishedAt: x.published_at,
        packageId: x.package_id,
      })),
      experiment.planned_samples,
      experiment.changed_variable,
    );
    return {
      experiment,
      assignments,
      comparison,
      evidence: metrics,
      accounts: (
        await tx.query(
          "select ea.*,a.handle,a.platform from experiment_accounts ea join social_accounts a on a.id=ea.account_id where ea.experiment_id=$1 and ea.workspace_id=$2",
          [id, ctx.workspaceId],
        )
      ).rows,
      insights: (
        await tx.query(
          "select * from insights where experiment_id=$1 and workspace_id=$2 order by evaluated_at desc",
          [id, ctx.workspaceId],
        )
      ).rows,
    };
  });
}
export async function saveRecommendation(ctx: Context, id: string) {
  authorize(ctx, "draft");
  const result = await experimentResults(ctx, id);
  return scoped(ctx, async (tx) => {
    const row = await one(
      tx,
      "insert into insights(workspace_id,experiment_id,title,body,method,limitations,next_action) values($1,$2,$3,$4,$5,$6,$7) returning *",
      [
        ctx.workspaceId,
        id,
        result.comparison.status,
        JSON.stringify(result.comparison.groups),
        "Within-account, format and horizon medians of distinct posts",
        result.comparison.limitations,
        result.comparison.nextAction,
      ],
    );
    for (const evidence of result.evidence)
      await tx.query(
        "insert into insight_evidence(workspace_id,insight_id,snapshot_id) values($1,$2,$3) on conflict do nothing",
        [ctx.workspaceId, row!.id, evidence.id],
      );
    await audit(tx, ctx, "experiment.evaluated", "experiment", id, {
      insightId: row!.id,
      evidenceIds: result.evidence.map((x) => x.id),
    });
    return row;
  });
}
export async function proposeObservation(
  ctx: Context,
  accountId: string,
  insightId: string,
  text: string,
) {
  authorize(ctx, "draft");
  requireCondition(
    text.length > 0 && text.length <= 2000,
    "invalid_observation",
    "Observation text must be 1–2000 characters.",
  );
  return scoped(ctx, async (tx) => {
    const insight = await one(
      tx,
      "select * from insights where id=$1 and workspace_id=$2",
      [insightId, ctx.workspaceId],
    );
    requireCondition(insight, "not_found", "Insight not found.", 404);
    requireCondition(
      await one(
        tx,
        "select m.id from insight_evidence e join metric_snapshots m on m.id=e.snapshot_id where e.insight_id=$1 and m.account_id=$2 and e.workspace_id=$3",
        [insightId, accountId, ctx.workspaceId],
      ),
      "no_evidence",
      "The insight has no supporting observations for this account.",
    );
    const row = await one(
      tx,
      "insert into account_observations(workspace_id,account_id,insight_id,text,method,limitations,evaluation_window) values($1,$2,$3,$4,$5,$6,$7) returning *",
      [
        ctx.workspaceId,
        accountId,
        insightId,
        text,
        insight.method,
        insight.limitations,
        { evaluatedAt: insight.evaluated_at },
      ],
    );
    await audit(
      tx,
      ctx,
      "observation.proposed",
      "account_observation",
      row!.id,
    );
    return row;
  });
}
export async function acceptObservation(ctx: Context, id: string) {
  humanReviewer(ctx);
  return scoped(ctx, async (tx) => {
    const observation = await one(
      tx,
      "select * from account_observations where id=$1 and workspace_id=$2 and status='proposed' for update",
      [id, ctx.workspaceId],
    );
    requireCondition(
      observation,
      "not_found",
      "Proposed observation not found.",
      404,
    );
    const rule = await one(
      tx,
      "insert into account_rules(workspace_id,account_id,text,source,created_by) values($1,$2,$3,'accepted_observation',$4) returning id",
      [ctx.workspaceId, observation.account_id, observation.text, ctx.userId],
    );
    await tx.query(
      "update account_observations set status='accepted',accepted_by=$1,rule_id=$2 where id=$3 and workspace_id=$4",
      [ctx.userId, rule!.id, id, ctx.workspaceId],
    );
    await audit(tx, ctx, "observation.accepted", "account_observation", id, {
      ruleId: rule!.id,
    });
    return { ...observation, status: "accepted", rule_id: rule!.id };
  });
}
