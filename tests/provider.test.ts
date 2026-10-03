import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import {
  PostForMeProvider,
  providerPayload,
} from "../packages/publishing/postforme";
import type { DeliveryEnvelope } from "../packages/publishing/provider";
import { effectiveSettings } from "../packages/publishing/validation";
import {
  encryptCredential,
  decryptCredential,
} from "../packages/domain/integrations";
const envelope: DeliveryEnvelope = {
  version: 1,
  adapterVersion: "postforme-v1-20261002",
  workspaceId: randomUUID(),
  accountId: randomUUID(),
  providerAccountId: "provider-account",
  platform: "x",
  format: "text",
  variantId: randomUUID(),
  revisionId: randomUUID(),
  contentHash: "hash",
  payload: {
    hook: "Hook",
    caption: "Caption",
    title: "",
    description: "",
    cta: "CTA",
    visibility: "public",
    settings: {},
  },
  media: [],
  scheduledAt: "2026-10-03T16:00:00.000Z",
  provenance: "provider",
};
const post = {
  id: "provider-job",
  external_id: "local-key",
  caption: "Hook\n\nCaption\n\nCTA",
  status: "scheduled",
  scheduled_at: envelope.scheduledAt,
  social_accounts: [{ id: envelope.providerAccountId }],
  media: [],
  platform_configurations: { x: {} },
};
const json = (body: unknown, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
describe("Post for Me documented contracts with isolated transports", () => {
  it("rejects hidden content overrides and mismatched effective media", () => {
    expect(() =>
      effectiveSettings({
        ...envelope,
        payload: { ...envelope.payload, settings: { caption: "unapproved" } },
      }),
    ).toThrow("Unsupported platform settings");
    expect(() =>
      effectiveSettings({ ...envelope, platform: "instagram", format: "reel" }),
    ).toThrow("exactly one video");
    const media = {
      assetId: "asset",
      checksum: "digest",
      storagePath: "private",
      mimeType: "video/mp4",
      bytes: 100,
      width: 1080,
      height: 1920,
      duration: 90,
      derivativeId: null,
      derivativeChecksum: null,
      derivativePath: null,
    };
    const video = {
      ...envelope,
      platform: "youtube",
      format: "short",
      media: [media],
      payload: {
        ...envelope.payload,
        title: "Approved title",
        visibility: "private",
      },
    };
    expect(effectiveSettings(video)).toMatchObject({
      privacy_status: "private",
      title: "Approved title",
    });
    expect(() =>
      effectiveSettings({
        ...video,
        media: [{ ...media, width: 1920, height: 1080 }],
      }),
    ).toThrow("square or vertical");
    expect(() =>
      effectiveSettings({ ...video, media: [{ ...media, duration: 181 }] }),
    ).toThrow("three minutes");
    expect(() =>
      effectiveSettings({
        ...video,
        media: [{ ...media, mimeType: "image/jpeg" }],
      }),
    ).toThrow("exactly one video");
  });
  it("captures Instagram placement and TikTok privacy without auto music or draft publication", () => {
    const media = {
      assetId: "asset",
      checksum: "digest",
      storagePath: "private",
      mimeType: "video/mp4",
      bytes: 100,
      derivativeId: null,
      derivativeChecksum: null,
      derivativePath: null,
    };
    expect(
      effectiveSettings({
        ...envelope,
        platform: "instagram",
        format: "reel",
        media: [media],
      }),
    ).toEqual({ placement: "reels" });
    expect(
      effectiveSettings({
        ...envelope,
        platform: "tiktok",
        format: "video",
        media: [media],
        payload: { ...envelope.payload, visibility: "private" },
      }),
    ).toMatchObject({
      privacy_status: "private",
      is_draft: false,
      auto_add_music: false,
    });
    expect(() =>
      effectiveSettings({
        ...envelope,
        payload: { ...envelope.payload, settings: { is_draft: true } },
      }),
    ).toThrow();
  });
  it("uses documented destination, scheduling and external-reference fields", async () => {
    const calls: any[] = [];
    const p = new PostForMeProvider(
      async (url, init) => {
        calls.push({
          url,
          method: init.method,
          body: JSON.parse(String(init.body)),
        });
        return json(post);
      },
      "offline-fixture",
      true,
    );
    const receipt = await p.submit(envelope, "local-key", "snapshot");
    expect(calls).toEqual([
      {
        url: "https://api.postforme.dev/v1/social-posts",
        method: "POST",
        body: providerPayload(envelope, "local-key", []),
      },
    ]);
    expect(() =>
      providerPayload(
        { ...envelope, effectiveSettings: { caption: "unapproved override" } },
        "local-key",
        [],
      ),
    ).toThrow("Approved platform settings changed");
    expect(receipt.state).toBe("scheduled");
    expect(receipt.platformPostId).toBeUndefined();
    expect(receipt.authoritative).toBe(true);
  });
  it("only confirms publication from the matching account result", async () => {
    const p = new PostForMeProvider(
      async (url) =>
        url.includes("social-post-results")
          ? json({
              data: [
                {
                  id: "r-other",
                  post_id: post.id,
                  social_account_id: "other",
                  success: true,
                  platform_data: { id: "not-ours" },
                  error: null,
                },
                {
                  id: "r",
                  post_id: post.id,
                  social_account_id: envelope.providerAccountId,
                  success: true,
                  platform_data: {
                    id: "published-platform-id",
                    url: "https://example.invalid/post",
                  },
                  error: null,
                },
              ],
              meta: { next: null },
            })
          : json({ ...post, status: "processed" }),
      "offline-fixture",
      true,
    );
    const result = await p.status(post.id, envelope);
    expect(result.state).toBe("published");
    expect(result.platformPostId).toBe("published-platform-id");
  });
  it("handles feed pagination and rejects credential-bearing redirects to another origin", async () => {
    const calls: string[] = [];
    const page =
      "https://api.postforme.dev/v1/social-account-feeds/provider-account?page=2";
    const p = new PostForMeProvider(
      async (url) => {
        calls.push(url);
        return json({
          data: [
            {
              platform_post_id: calls.length === 1 ? "first" : "second",
              social_account_id: envelope.providerAccountId,
              metrics: { public_metrics: { impression_count: 123 } },
            },
          ],
          meta: { next: calls.length === 1 ? page : null },
        });
      },
      "offline-fixture",
      true,
    );
    expect(await p.feed(envelope.providerAccountId)).toHaveLength(2);
    expect(calls[0]).toContain("expand=metrics");
    const unsafe = new PostForMeProvider(
      async () =>
        json({ data: [], meta: { next: "https://example.invalid/v1/steal" } }),
      "offline-fixture",
      true,
    );
    await expect(unsafe.feed(envelope.providerAccountId)).rejects.toMatchObject(
      { classification: "validation" },
    );
  });
  it("requires schema-valid acceptance and preserves rate-limit uncertainty on writes", async () => {
    const malformed = new PostForMeProvider(
      async () => json({ id: "job" }),
      "offline-fixture",
      true,
    );
    await expect(
      malformed.submit(envelope, "local-key", "hash"),
    ).rejects.toMatchObject({ classification: "ambiguous" });
    const limited = new PostForMeProvider(
      async () => json({ error: "limited" }, 429, { "Retry-After": "17" }),
      "offline-fixture",
      true,
    );
    await expect(
      limited.submit(envelope, "local-key", "hash"),
    ).rejects.toMatchObject({
      classification: "rate_limited",
      retryAfterSeconds: 17,
      safeToRetry: false,
    });
  });
  it("does not treat DELETE acknowledgement or 404 as confirmed cancellation", async () => {
    const p = new PostForMeProvider(
      async (url, init) =>
        init.method === "DELETE"
          ? json({ success: true })
          : url.includes("social-post-results")
            ? json({ data: [], meta: { next: null } })
            : json(post),
      "offline-fixture",
      true,
    );
    expect(await p.cancel(post.id, envelope)).toMatchObject({
      state: "uncertain",
      authoritative: false,
    });
    const absent = new PostForMeProvider(
      async () => json({}, 404),
      "offline-fixture",
      true,
    );
    await expect(absent.cancel(post.id, envelope)).rejects.toMatchObject({
      classification: "validation",
    });
  });
  it("refuses ambiguous reconciliation matches and media byte identity assumptions", async () => {
    const duplicate = new PostForMeProvider(
      async () => json({ data: [post, post], meta: { next: null } }),
      "offline-fixture",
      true,
    );
    expect(await duplicate.reconcile("local-key", "hash", envelope)).toBeNull();
    const media = new PostForMeProvider(
      async () => json({ data: [post], meta: { next: null } }),
      "offline-fixture",
      true,
    );
    await expect(
      media.reconcile("local-key", "hash", {
        ...envelope,
        media: [
          {
            assetId: randomUUID(),
            checksum: "bytes",
            storagePath: "path",
            mimeType: "image/png",
            bytes: 1,
            derivativeId: null,
            derivativeChecksum: null,
            derivativePath: null,
          },
        ],
      }),
    ).rejects.toMatchObject({ classification: "ambiguous" });
  });
  it("requests both posts and feeds with bound redirect and external ID", async () => {
    let body: any;
    const p = new PostForMeProvider(
      async (_url, init) => {
        body = JSON.parse(String(init.body));
        return json({
          url: "https://provider.example/authorize",
          platform: "x",
        });
      },
      "offline-fixture",
      true,
    );
    await p.authUrl(
      "x",
      "unique-browser-binding",
      "https://app.example/api/v1/connections/callback?state=fixture",
    );
    expect(body.permissions).toEqual(["posts", "feeds"]);
    expect(body.external_id).toBe("unique-browser-binding");
    expect(body.redirect_url_override).toContain("state=fixture");
  });
});
describe("Workspace-bound credential vault", () => {
  it("encrypts secrets and authenticates workspace, service and tamper boundaries", () => {
    const encrypted = encryptCredential(
      "fixture-credential-value",
      envelope.workspaceId,
      "openai",
    );
    expect(encrypted.ciphertext).not.toContain("fixture-credential-value");
    const row = {
      ...encrypted,
      workspace_id: envelope.workspaceId,
      service: "openai",
    };
    expect(decryptCredential(row)).toBe("fixture-credential-value");
    expect(() =>
      decryptCredential({ ...row, workspace_id: randomUUID() }),
    ).toThrow();
    expect(() => decryptCredential({ ...row, service: "postforme" })).toThrow();
    expect(() =>
      decryptCredential({ ...row, tag: Buffer.alloc(16).toString("base64") }),
    ).toThrow();
  });
});
