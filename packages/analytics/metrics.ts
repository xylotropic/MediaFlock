// Pure measurement semantics shared by the server and browser. "views" is a
// legacy storage key; the immutable definition determines its actual meaning.
export const metricNames = ["views", "likes", "comments", "shares"] as const;
export type MetricName = (typeof metricNames)[number];
export type Availability =
  "available" | "unsupported" | "unknown" | "permission_missing" | "missed";
export interface Metric {
  metric: string;
  value: number | null;
  availability: Availability;
  definition: string;
  unit: string;
  scope: "lifetime" | "period";
  denominator?: string;
}
const paths: Record<string, Record<MetricName, string>> = {
  youtube: {
    views: "views",
    likes: "likes",
    comments: "comments",
    shares: "shares",
  },
  tiktok: {
    views: "view_count",
    likes: "like_count",
    comments: "comment_count",
    shares: "share_count",
  },
  instagram: {
    views: "views",
    likes: "likes",
    comments: "comments",
    shares: "shares",
  },
  facebook: {
    views: "video_views",
    likes: "reactions_like",
    comments: "comments",
    shares: "shares",
  },
  x: {
    views: "public_metrics.impression_count",
    likes: "public_metrics.like_count",
    comments: "public_metrics.reply_count",
    shares: "public_metrics.retweet_count",
  },
  linkedin: {
    views: "videoView",
    likes: "likeCount",
    comments: "commentCount",
    shares: "shareCount",
  },
};
const viewDefinitions: Record<string, string> = {
  youtube: "YouTube lifetime video views as reported by the platform.",
  tiktok: "TikTok lifetime video views as reported by the platform.",
  instagram: "Instagram lifetime media views as reported by the platform.",
  facebook: "Facebook lifetime video views lasting at least 3 seconds.",
  x: "X lifetime post impressions; repeated displays can be counted.",
  linkedin:
    "LinkedIn lifetime video views lasting at least 3 seconds; automatic loops do not add views.",
};
const countDefinitions: Record<MetricName, string> = {
  views: "Lifetime views; the platform's definition must be checked.",
  likes: "Lifetime likes (Facebook: like reactions).",
  comments: "Lifetime comments or replies.",
  shares: "Lifetime shares or reposts.",
};
export function normalizeMetrics(
  platform: string,
  raw: Record<string, unknown>,
  capabilities: Record<string, any>,
  demo = false,
): Metric[] {
  return metricNames.map((metric) => {
    const path = demo ? metric : paths[platform]?.[metric];
    const value = path
      ?.split(".")
      .reduce<any>((value, key) => value?.[key], raw);
    const state = capabilities.metrics?.[metric] || "unknown";
    const valid =
      typeof value === "number" && Number.isFinite(value) && value >= 0;
    const availability: Availability =
      state === "permission_missing"
        ? "permission_missing"
        : state === "unsupported"
          ? "unsupported"
          : valid
            ? "available"
            : "unknown";
    return {
      metric,
      value: availability === "available" ? value : null,
      availability,
      definition: demo
        ? `Simulated lifetime ${metric}.`
        : metric === "views"
          ? viewDefinitions[platform] || countDefinitions.views
          : countDefinitions[metric],
      unit: "count",
      scope: "lifetime",
    };
  });
}
export function measurementLabel(row: Record<string, any>) {
  if (typeof row.metric !== "string") return "Unknown measurement";
  if (row.provenance === "simulated")
    return `Simulated ${row.metric.replace(/_/g, " ")}`;
  if (row.metric === "views") {
    if (row.definition === viewDefinitions.x) return "Impressions";
    if (
      row.platform === "x" &&
      row.provenance === "provider" &&
      row.definition ===
        "Lifetime video views; platform-specific view threshold. Compare within account and format only."
    )
      return "Impressions (legacy description)";
    return "Views";
  }
  return row.metric === "engagement_rate"
    ? "Interaction ratio"
    : row.metric.replace(/_/g, " ");
}

export function comparisonIdentity(row: Record<string, any>, horizon = true) {
  if (
    ![
      "account_id",
      "format",
      "metric",
      "definition",
      "unit",
      "scope",
      "provenance",
    ].every((key) => typeof row[key] === "string" && row[key].trim().length > 0)
  )
    return null;
  if (
    row.denominator !== null &&
    !(typeof row.denominator === "string" && row.denominator.trim().length > 0)
  )
    return null;
  if (
    horizon &&
    (!Number.isFinite(Number(row.horizon_hours)) ||
      Number(row.horizon_hours) <= 0)
  )
    return null;
  return JSON.stringify([
    row.account_id,
    row.format,
    row.metric,
    row.definition,
    row.unit,
    row.scope,
    row.denominator,
    row.provenance,
    ...(horizon ? [Number(row.horizon_hours)] : []),
  ]);
}
export function comparableMeasurements(
  a: Record<string, any>,
  b: Record<string, any>,
  horizon = true,
) {
  const identity = comparisonIdentity(a, horizon);
  return identity !== null && identity === comparisonIdentity(b, horizon);
}
export function measurementGroups<T extends Record<string, any>>(rows: T[]) {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = comparisonIdentity(row);
    if (key) groups.set(key, [...(groups.get(key) || []), row]);
  }
  return [...groups].map(([key, observations]) => ({
    key,
    observations,
    label: measurementLabel(observations[0]),
  }));
}

function measurementTime(value: string | Date) {
  return value instanceof Date ? value.getTime() : Date.parse(value);
}
function changeBetween(
  jobId: string,
  before?: Record<string, any>,
  after?: Record<string, any>,
  fallback?: Record<string, any>,
) {
  const evidence = {
    start: before?.observed_at || null,
    end: after?.observed_at || null,
    evidenceIds: [before?.id, after?.id].filter(Boolean),
  };
  const descriptor = after || before || fallback || {};
  const semantics = Object.fromEntries(
    [
      "metric",
      "definition",
      "unit",
      "scope",
      "denominator",
      "provenance",
      "platform",
      "account_id",
      "format",
    ].map((key) => [key, descriptor[key]]),
  );
  const available =
    before?.availability === "available" && after?.availability === "available";
  const compatible =
    before && after && comparableMeasurements(before, after, false);
  return {
    jobId,
    ...semantics,
    interval: evidence,
    change:
      available && compatible
        ? Number(after.value) - Number(before.value)
        : null,
    availability:
      !before || !after
        ? "missing_boundary_observation"
        : !available
          ? "unavailable_boundary_observation"
          : !compatible
            ? "incompatible_boundary_observations"
            : "available",
  };
}
export function periodChanges(
  rows: Record<string, any>[],
  metric: string,
  start: string,
  end: string,
) {
  const posts = new Map<string, Record<string, any>[]>();
  for (const row of rows.filter((row) => row.metric === metric))
    posts.set(row.job_id, [...(posts.get(row.job_id) || []), row]);
  return [...posts].map(([jobId, list]) =>
    changeBetween(
      jobId,
      list.find(
        (row) => measurementTime(row.observed_at) === Date.parse(start),
      ),
      list.find((row) => measurementTime(row.observed_at) === Date.parse(end)),
      list[0],
    ),
  );
}
// A useful separate readout: the signed change between real updates inside a
// date range. Its actual endpoints are always returned; it is not period growth.
export function recordedChanges(
  rows: Record<string, any>[],
  metric: string,
  start: string,
  end: string,
) {
  const posts = new Map<string, Record<string, any>[]>();
  for (const row of rows.filter((row) => row.metric === metric))
    posts.set(row.job_id, [...(posts.get(row.job_id) || []), row]);
  return [...posts].map(([jobId, list]) => {
    const within = list
      .filter(
        (row) =>
          measurementTime(row.observed_at) >= Date.parse(start) &&
          measurementTime(row.observed_at) < Date.parse(end),
      )
      .sort(
        (a, b) =>
          measurementTime(a.observed_at) - measurementTime(b.observed_at),
      );
    return changeBetween(
      jobId,
      within[0],
      within.length > 1 ? within.at(-1) : undefined,
      list[0],
    );
  });
}
export function observationWindow(
  publishedAt: string | Date,
  horizonHours: number,
  collectedAt: Date,
) {
  const intended = measurementTime(publishedAt) + horizonHours * 3600000;
  if (!Number.isFinite(intended) || horizonHours <= 0)
    throw Error(
      "Confirmed publication time or observation horizon is unavailable.",
    );
  return {
    intendedAt: new Date(intended).toISOString(),
    missed: collectedAt.getTime() - intended > 15 * 60000,
  };
}
export function exclusiveUtcDayEnd(day: string) {
  const value = Date.parse(day + "T00:00:00Z");
  return Number.isFinite(value) ? new Date(value + 86400000).toISOString() : "";
}

export function deriveInteractionRatio(
  rows: Record<string, any>[],
  denominatorKey: string,
) {
  const base = rows[0] || {};
  const denominator = rows.find((row) => row.metric === denominatorKey);
  const numerator = ["likes", "comments", "shares"].map((metric) =>
    rows.find((row) => row.metric === metric),
  );
  const ingredients = [denominator, ...numerator];
  const coherent = ingredients.every(
    (row) =>
      row &&
      row.availability === "available" &&
      row.value !== null &&
      Number.isFinite(Number(row.value)) &&
      Number(row.value) >= 0 &&
      row.job_id === base.job_id &&
      row.account_id === base.account_id &&
      row.horizon_hours === base.horizon_hours &&
      measurementTime(row.observed_at) === measurementTime(base.observed_at) &&
      row.provenance === base.provenance &&
      row.scope === "lifetime" &&
      row.unit === "count" &&
      typeof row.definition === "string" &&
      row.definition.trim().length > 0,
  );
  const valid = coherent && denominator && Number(denominator.value) > 0;
  return {
    ...base,
    metric: "engagement_rate",
    unit: "ratio",
    scope: "lifetime",
    denominator: denominatorKey,
    value: valid
      ? numerator.reduce((sum, row) => sum + Number(row!.value), 0) /
        Number(denominator.value)
      : null,
    availability: valid ? "available" : "unknown",
    definition:
      `Interaction ratio v1: (likes + comments + shares) / ${denominator ? measurementLabel(denominator) : denominatorKey}. ` +
      `Numerator definitions: ${numerator.map((row) => row?.definition || "Unknown").join("; ")}. ` +
      `Denominator definition: ${denominator?.definition || "Unknown"}.`,
    evidence_ids: ingredients.map((row) => row?.id).filter(Boolean),
  };
}
