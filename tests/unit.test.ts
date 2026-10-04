import {
  recordedChanges,
  measurementGroups,
  measurementLabel,
  deriveInteractionRatio,
  comparisonIdentity,
  exclusiveUtcDayEnd,
} from "../packages/analytics/metrics";
import { describe, it, expect } from "vitest";
import { contentHash, canonical } from "../packages/domain/auth";
import { localToUtc } from "../packages/domain/time";
import { getConfig } from "../packages/domain/config";
import {
  latestLifetime,
  median,
  normalizeMetrics,
  periodChanges,
} from "../packages/analytics";
import { compareExperiment, type ComparisonRow } from "../packages/experiments";
import {
  boundedBody,
  isPublicAddress,
  validatedUploadTarget,
} from "../packages/security";
import { mediaRecipe } from "../packages/schemas";
import { identifyMime } from "../packages/media";
describe("Deterministic calculations and boundaries", () => {
  it("hashes canonical snapshots without depending on property order", () => {
    expect(contentHash({ b: 2, a: { z: 1, k: 3 } })).toBe(
      contentHash({ a: { k: 3, z: 1 }, b: 2 }),
    );
    expect(canonical([2, 1])).not.toBe(canonical([1, 2]));
  });
  it("handles DST gaps and repeated times explicitly", () => {
    expect(() => localToUtc("2026-03-08T02:30", "America/New_York")).toThrow();
    expect(() => localToUtc("2026-11-01T01:30", "America/New_York")).toThrow();
    expect(localToUtc("2026-11-01T01:30", "America/New_York", "earlier")).toBe(
      "2026-11-01T05:30:00Z",
    );
    expect(localToUtc("2026-11-01T01:30", "America/New_York", "later")).toBe(
      "2026-11-01T06:30:00Z",
    );
  });
  it("preserves missing and unsupported metrics as null", () => {
    const metrics = normalizeMetrics(
      "x",
      { public_metrics: { impression_count: 0, like_count: 18 } },
      {
        metrics: {
          views: "supported",
          likes: "permission_missing",
          comments: "unsupported",
        },
      },
    );
    expect(metrics.map((x) => [x.availability, x.value])).toEqual([
      ["available", 0],
      ["permission_missing", null],
      ["unsupported", null],
      ["unknown", null],
    ]);
  });
  it("reads the current LinkedIn feed counters without inventing missing values", () => {
    const metrics = normalizeMetrics(
      "linkedin",
      { videoView: 55, likeCount: 3, commentCount: 2, shareCount: 1 },
      {
        metrics: {
          views: "supported",
          likes: "supported",
          comments: "supported",
          shares: "supported",
        },
      },
    );
    expect(
      metrics.map((row) => [row.metric, row.value, row.availability]),
    ).toEqual([
      ["views", 55, "available"],
      ["likes", 3, "available"],
      ["comments", 2, "available"],
      ["shares", 1, "available"],
    ]);
    const missing = normalizeMetrics(
      "linkedin",
      { likeCount: 0 },
      { metrics: { views: "supported", likes: "supported" } },
    );
    expect(missing[0].value).toBeNull();
    expect(missing[1].value).toBe(0);
  });
  it("describes X impressions separately from simulated views", () => {
    const live = normalizeMetrics(
      "x",
      { public_metrics: { impression_count: 25 } },
      { metrics: { views: "supported" } },
    )[0];
    expect(live.definition.toLowerCase()).toContain("impressions");
    expect(live.definition.toLowerCase()).not.toContain("video views");
    const demo = normalizeMetrics(
      "x",
      { views: 25 },
      { metrics: { views: "supported" } },
      true,
    )[0];
    expect(demo.definition.toLowerCase()).toContain("simulated");
  });
  it("does not subtract boundary observations with different measurement meanings", () => {
    const rows = [
      {
        job_id: "post",
        account_id: "account",
        format: "video",
        denominator: null,
        metric: "views",
        scope: "lifetime",
        availability: "available",
        observed_at: "2026-01-01",
        value: 10,
        definition: "Video views",
        unit: "count",
        provenance: "provider",
      },
      {
        job_id: "post",
        account_id: "account",
        format: "video",
        denominator: null,
        metric: "views",
        scope: "lifetime",
        availability: "available",
        observed_at: "2026-01-02",
        value: 30,
        definition: "Post impressions",
        unit: "count",
        provenance: "provider",
      },
    ];
    expect(
      periodChanges(rows, "views", "2026-01-01", "2026-01-02"),
    ).toMatchObject([
      {
        jobId: "post",
        change: null,
        availability: "incompatible_boundary_observations",
      },
    ]);
  });
  it("takes one latest lifetime snapshot per post", () => {
    const rows = [
      {
        job_id: "a",
        metric: "views",
        scope: "lifetime",
        observed_at: "2026-01-01",
        value: 10,
      },
      {
        job_id: "a",
        metric: "views",
        scope: "lifetime",
        observed_at: "2026-01-02",
        value: 20,
      },
      {
        job_id: "b",
        metric: "views",
        scope: "lifetime",
        observed_at: "2026-01-02",
        value: 30,
      },
    ];
    expect(latestLifetime(rows, "views").map((x) => x.value)).toEqual([20, 30]);
    expect(median([1, 2, 100, 101])).toBe(51);
    expect(median([])).toBeNull();
    expect(
      periodChanges(
        rows.map((x) => ({
          ...x,
          account_id: "account",
          format: "video",
          definition: "Lifetime video views",
          unit: "count",
          denominator: null,
          provenance: "provider",
          availability: "available",
        })),
        "views",
        "2026-01-01",
        "2026-01-02",
      ),
    ).toMatchObject([
      { jobId: "a", change: 10, availability: "available" },
      {
        jobId: "b",
        change: null,
        availability: "missing_boundary_observation",
      },
    ]);
  });
  it("keeps unlike counters out of comparison groups", () => {
    const base = {
      account_id: "account",
      format: "video",
      metric: "views",
      definition: "Lifetime video views",
      unit: "count",
      scope: "lifetime",
      denominator: null,
      provenance: "provider",
      horizon_hours: 24,
    };
    for (const [field, value] of Object.entries({
      account_id: "other",
      format: "image",
      metric: "likes",
      definition: "Post impressions",
      unit: "ratio",
      scope: "period",
      denominator: "likes",
      provenance: "simulated",
      horizon_hours: 72,
    }))
      expect(
        measurementGroups([base, { ...base, [field]: value }]),
      ).toHaveLength(2);
    expect(comparisonIdentity({ ...base, definition: "" })).toBeNull();
    expect(comparisonIdentity({ metric: "views" })).toBeNull();
  });
  it("requires actual requested boundaries and preserves unavailable posts", () => {
    const base = {
      job_id: "post",
      account_id: "account",
      format: "video",
      metric: "views",
      definition: "Lifetime video views",
      unit: "count",
      scope: "lifetime",
      denominator: null,
      provenance: "provider",
      horizon_hours: 24,
    };
    const rows = [
      {
        ...base,
        id: "old",
        observed_at: "2026-09-01",
        availability: "available",
        value: 100,
      },
      {
        ...base,
        id: "start",
        observed_at: "2026-10-02",
        availability: "permission_missing",
        value: null,
      },
      {
        ...base,
        id: "end",
        observed_at: "2026-10-03",
        availability: "available",
        value: 140,
      },
    ];
    expect(
      periodChanges(rows, "views", "2026-10-02", "2026-10-03")[0],
    ).toMatchObject({
      change: null,
      availability: "unavailable_boundary_observation",
    });
    expect(
      periodChanges([rows[0], rows[2]], "views", "2026-10-02", "2026-10-03")[0]
        .change,
    ).toBeNull();
    expect(
      periodChanges([rows[1]], "views", "2026-10-02", "2026-10-03"),
    ).toHaveLength(1);
    const recorded = recordedChanges(
      [
        { ...rows[1], availability: "available", value: 150, horizon_hours: 1 },
        rows[2],
      ],
      "views",
      "2026-10-02",
      "2026-10-04",
    )[0];
    expect(recorded.change).toBe(-10);
    expect(recorded.interval).toEqual({
      start: "2026-10-02",
      end: "2026-10-03",
      evidenceIds: ["start", "end"],
    });
    const absent = recordedChanges(
      rows,
      "views",
      "2026-10-05",
      "2026-10-06",
    )[0];
    expect(absent.change).toBeNull();
    expect(measurementLabel(absent)).toBe("Views");
    const exclusiveEnd = recordedChanges(
      rows,
      "views",
      "2026-10-02",
      "2026-10-03",
    )[0];
    expect(exclusiveEnd.change).toBeNull();
    expect(exclusiveEnd.interval.end).toBeNull();
  });
  it("keeps derived ratio meanings and input batches intact", () => {
    const at = new Date("2026-10-03T12:00:00.250Z");
    const rows = ["views", "likes", "comments", "shares"].map((metric, i) => ({
      id: String(i),
      job_id: "post",
      account_id: "account",
      horizon_hours: 24,
      observed_at: new Date(at),
      metric,
      definition: "Lifetime " + metric,
      unit: "count",
      scope: "lifetime",
      provenance: "provider",
      availability: "available",
      value: metric === "views" ? 100 : 2,
    }));
    const ratio = deriveInteractionRatio(rows, "views");
    expect(ratio).toMatchObject({
      metric: "engagement_rate",
      unit: "ratio",
      scope: "lifetime",
      value: 0.06,
      availability: "available",
    });
    expect(
      deriveInteractionRatio(
        rows.map((row) =>
          row.metric === "views"
            ? { ...row, definition: "Post impressions" }
            : row,
        ),
        "views",
      ).definition,
    ).not.toBe(ratio.definition);
    expect(
      deriveInteractionRatio(
        rows.map((row) =>
          row.metric === "likes" ? { ...row, provenance: "simulated" } : row,
        ),
        "views",
      ).value,
    ).toBeNull();
    expect(
      deriveInteractionRatio(
        rows.map((row) =>
          row.metric === "views" ? { ...row, value: 0 } : row,
        ),
        "views",
      ).value,
    ).toBeNull();
    expect(
      deriveInteractionRatio(
        rows.map((row) =>
          row.metric === "shares"
            ? { ...row, observed_at: new Date(at.getTime() + 1) }
            : row,
        ),
        "views",
      ).value,
    ).toBeNull();
  });
  it("includes the final second of the selected UTC day", () => {
    expect(Date.parse("2026-10-03T23:59:59.999Z")).toBeLessThan(
      Date.parse(exclusiveUtcDayEnd("2026-10-03")),
    );
    expect(exclusiveUtcDayEnd("2026-10-03")).toBe("2026-10-04T00:00:00.000Z");
  });
  it("requires independent post samples, comparable definitions and balanced arms", () => {
    const rows: ComparisonRow[] = Array.from({ length: 6 }, (_, i) => ({
      snapshotId: String(i),
      jobId: String(i),
      accountId: "account",
      format: "text",
      arm: i < 3 ? "A" : "B",
      value: i < 3 ? 100 + i : 200 + i,
      availability: "available",
      horizonHours: 24,
      definition: "views",
      denominator: null,
      unit: "count",
      scope: "lifetime",
      provenance: "provider",
      publishedAt: "2026-01-01",
      packageId: String(i),
    }));
    expect(compareExperiment(rows, 3).status).toBe("Observational signal");
    expect(
      compareExperiment([...rows.slice(0, 2), ...rows.slice(0, 2)], 3).status,
    ).toBe("Insufficient evidence");
    expect(
      compareExperiment(
        rows.map((x) => ({ ...x, packageId: "one-source" })),
        3,
      ).status,
    ).toBe("Insufficient evidence");
    expect(
      compareExperiment(
        rows.map((x) => ({ ...x, horizonHours: x.arm === "A" ? 1 : 24 })),
        3,
      ).status,
    ).toBe("Insufficient evidence");
  });
  it("rejects mixed live credentials and demo configuration", () => {
    const old = process.env.POSTFORME_API_KEY;
    process.env.POSTFORME_API_KEY = "fixture-no-network";
    try {
      expect(() => getConfig()).toThrow("Demo mode refuses");
    } finally {
      if (old === undefined) delete process.env.POSTFORME_API_KEY;
      else process.env.POSTFORME_API_KEY = old;
    }
  });
  it("blocks private, local, mapped, metadata and mixed DNS destinations", async () => {
    for (const ip of [
      "127.0.0.1",
      "10.0.0.1",
      "169.254.169.254",
      "100.64.1.2",
      "::1",
      "::ffff:127.0.0.1",
      "fc00::1",
      "fe80::1",
    ])
      expect(isPublicAddress(ip)).toBe(false);
    expect(isPublicAddress("8.8.8.8")).toBe(true);
    await expect(
      validatedUploadTarget(
        "https://upload.test/file",
        async () =>
          [
            { address: "8.8.8.8", family: 4 },
            { address: "10.0.0.1", family: 4 },
          ] as any,
      ),
    ).rejects.toThrow();
    await expect(
      validatedUploadTarget("https://127.0.0.1/private"),
    ).rejects.toThrow();
    await expect(
      validatedUploadTarget("https://user:pass@upload.test/file"),
    ).rejects.toThrow();
  });
  it("bounds chunked bodies even without Content-Length", async () => {
    const body = new ReadableStream({
      start(c) {
        c.enqueue(new Uint8Array(8));
        c.enqueue(new Uint8Array(8));
        c.close();
      },
    });
    const req = new Request("http://localhost", {
      method: "POST",
      body,
      duplex: "half",
    } as RequestInit);
    await expect(boundedBody(req, 10)).rejects.toMatchObject({ status: 413 });
  });
  it("validates media types and trim bounds", () => {
    expect(() => identifyMime(Buffer.from("not media"))).toThrow();
    expect(mediaRecipe.safeParse({ trimStart: 10, trimEnd: 5 }).success).toBe(
      false,
    );
  });
});
