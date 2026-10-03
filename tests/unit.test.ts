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
        rows.map((x) => ({ ...x, availability: "available" })),
        "views",
        "2026-01-01T12:00Z",
        "2026-01-03",
      ),
    ).toEqual([
      { jobId: "a", change: 10, availability: "available" },
      {
        jobId: "b",
        change: null,
        availability: "missing_boundary_observation",
      },
    ]);
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
