import { effectiveSettings } from "./validation";
import { workerTimeout } from "../worker/budget";
import { uploadPublicBytes } from "../security";
import { z } from "zod";
import { getConfig } from "../domain/config";
import { storageAdmin, contentHash } from "../domain/auth";
import {
  ProviderError,
  type PublishingProvider,
  type DeliveryEnvelope,
  type Receipt,
  type FeedPost,
} from "./provider";
const base = "https://api.postforme.dev";
const postSchema = z
  .object({
    id: z.string(),
    external_id: z.string().nullable(),
    caption: z.string(),
    status: z.enum(["draft", "scheduled", "processing", "processed"]),
    scheduled_at: z.string().nullable(),
    social_accounts: z.array(z.object({ id: z.string() }).passthrough()),
    media: z.array(z.object({ url: z.string() }).passthrough()).nullable(),
    platform_configurations: z.unknown().optional(),
    account_configurations: z.unknown().optional(),
  })
  .passthrough();
const resultsSchema = z.object({
  data: z.array(
    z
      .object({
        id: z.string(),
        social_account_id: z.string(),
        post_id: z.string(),
        success: z.boolean(),
        platform_data: z
          .object({ id: z.string().optional(), url: z.string().optional() })
          .passthrough()
          .nullable(),
        error: z.unknown(),
      })
      .passthrough(),
  ),
  meta: z.object({ next: z.string().nullable() }).passthrough(),
});
export type Transport = (url: string, init: RequestInit) => Promise<Response>;
function safeUrl(url: string) {
  const parsed = new URL(url);
  if (parsed.origin !== base || !parsed.pathname.startsWith("/v1/"))
    throw new ProviderError("validation", "Provider pagination URL rejected.");
  return parsed.toString();
}
function retryAfter(value: string | null) {
  if (!value) return undefined;
  const num = Number(value);
  return Number.isFinite(num)
    ? Math.max(0, num)
    : Math.max(0, Math.ceil((Date.parse(value) - Date.now()) / 1000));
}
export function providerPayload(
  e: DeliveryEnvelope,
  localKey: string,
  mediaUrls: string[],
) {
  const caption = [e.payload.hook, e.payload.caption, e.payload.cta]
    .filter(Boolean)
    .join("\n\n");
  const computed = effectiveSettings(e);
  if (
    e.effectiveSettings &&
    contentHash(computed) !== contentHash(e.effectiveSettings)
  )
    throw new ProviderError(
      "validation",
      "Approved platform settings changed. Obtain a fresh approval.",
    );
  const settings = e.effectiveSettings || computed;
  return {
    caption,
    scheduled_at: e.scheduledAt,
    social_accounts: [e.providerAccountId],
    external_id: localKey,
    media: mediaUrls.map((url) => ({ url })),
    platform_configurations: { [e.platform]: settings },
  };
}
export class PostForMeProvider implements PublishingProvider {
  constructor(
    private transport: Transport = fetch,
    private apiKey = process.env.POSTFORME_API_KEY || "",
    private offline = false,
  ) {
    if (!offline) {
      const c = getConfig();
      if (c.mode !== "live" || !apiKey)
        throw new ProviderError(
          "unavailable",
          "Configure Post for Me credentials and explicitly enable live publishing.",
        );
    }
  }
  private async request(
    path: string,
    method = "GET",
    body?: unknown,
  ): Promise<any> {
    const url = safeUrl(path.startsWith("https:") ? path : base + path);
    let r: Response;
    try {
      r = await this.transport(url, {
        method,
        headers: {
          Authorization: "Bearer " + this.apiKey,
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(workerTimeout(20000)),
        redirect: "error",
      });
    } catch {
      throw new ProviderError(
        "ambiguous",
        method === "GET"
          ? "Provider status read unavailable."
          : "Provider response unknown. Reconcile before another submission.",
      );
    }
    if (!r.ok) {
      const classification =
        r.status === 429
          ? "rate_limited"
          : r.status === 401 || r.status === 403
            ? "auth"
            : r.status >= 500
              ? "ambiguous"
              : "validation";
      throw new ProviderError(
        classification,
        `Post for Me ${method} returned HTTP ${r.status}.`,
        method === "GET",
        retryAfter(r.headers.get("retry-after")),
      );
    }
    try {
      return await r.json();
    } catch {
      throw new ProviderError("ambiguous", "Malformed provider response.");
    }
  }
  private async pages(path: string, schema: z.ZodType<any>): Promise<any[]> {
    let url: string | null = path;
    const rows: any[] = [];
    const seen = new Set();
    for (let n = 0; url && n < 100; n++) {
      if (seen.has(url))
        throw new ProviderError(
          "ambiguous",
          "Provider pagination repeated a page.",
        );
      seen.add(url);
      const parsed = schema.safeParse(await this.request(url));
      if (!parsed.success)
        throw new ProviderError(
          "ambiguous",
          "Provider response failed schema validation.",
        );
      rows.push(...parsed.data.data);
      url = parsed.data.meta.next;
      if (url) safeUrl(url);
    }
    if (url)
      throw new ProviderError(
        "ambiguous",
        "Provider pagination exceeded the safety limit.",
      );
    return rows;
  }
  async submit(
    e: DeliveryEnvelope,
    key: string,
    snapshotHash: string,
  ): Promise<Receipt> {
    if (!this.offline && !getConfig().livePublishing)
      throw new ProviderError("unavailable", "Live publishing is disabled.");
    if (e.provenance !== "provider")
      throw new ProviderError(
        "validation",
        "Simulated content cannot be submitted to a live provider.",
      );
    if (e.adapterVersion !== "postforme-v1-20261002")
      throw new ProviderError(
        "validation",
        "The approved serializer version is unavailable. Obtain a new approval.",
      );
    if (!this.offline && !e.effectiveSettings)
      throw new ProviderError(
        "validation",
        "The approval has no captured effective settings. Obtain a fresh approval.",
      );
    providerPayload(e, key, []);
    const urls: string[] = [];
    for (const asset of e.media) {
      if (this.offline) {
        urls.push("https://fixture.invalid/" + asset.checksum);
        continue;
      }
      const path = asset.derivativePath || asset.storagePath;
      const { data, error } = await storageAdmin()
        .storage.from("mediaflock")
        .download(path);
      if (error || !data)
        throw new ProviderError(
          "validation",
          "Approved media bytes could not be read.",
        );
      const bytes = Buffer.from(await data.arrayBuffer());
      if (
        contentHashBytes(bytes) !== (asset.derivativeChecksum || asset.checksum)
      )
        throw new ProviderError(
          "validation",
          "Approved media checksum mismatch.",
        );
      const upload = z
        .object({ media_url: z.url(), upload_url: z.url() })
        .parse(await this.request("/v1/media/create-upload-url", "POST", {}));
      await uploadPublicBytes(
        upload.upload_url,
        bytes,
        data.type || asset.mimeType,
      );
      urls.push(upload.media_url);
    }
    const payload = providerPayload(e, key, urls);
    const parsed = postSchema.safeParse(
      await this.request("/v1/social-posts", "POST", payload),
    );
    if (!parsed.success)
      throw new ProviderError(
        "ambiguous",
        "Post acceptance response failed schema validation.",
      );
    const post = parsed.data;
    if (
      post.external_id !== key ||
      !post.social_accounts.some((a) => a.id === e.providerAccountId)
    )
      throw new ProviderError("ambiguous", "Acceptance correlation mismatch.");
    return {
      providerJobId: post.id,
      state: post.status === "scheduled" ? "scheduled" : "processing",
      scheduledAt: post.scheduled_at || undefined,
      raw: { ...redact(post), snapshotHash },
      authoritative: true,
    };
  }
  async status(id: string, e: DeliveryEnvelope): Promise<Receipt> {
    const parsed = postSchema.safeParse(
      await this.request("/v1/social-posts/" + encodeURIComponent(id)),
    );
    if (!parsed.success)
      throw new ProviderError(
        "ambiguous",
        "Status response failed schema validation.",
      );
    const post = parsed.data;
    if (!post.social_accounts.some((x) => x.id === e.providerAccountId))
      throw new ProviderError("ambiguous", "Provider job account mismatch.");
    const results = await this.pages(
      "/v1/social-post-results?post_id=" +
        encodeURIComponent(id) +
        "&social_account_id=" +
        encodeURIComponent(e.providerAccountId),
      resultsSchema,
    );
    const matched = results.filter(
      (x) => x.post_id === id && x.social_account_id === e.providerAccountId,
    );
    const success = matched.find((x) => x.success && x.platform_data?.id);
    if (success)
      return {
        providerJobId: id,
        state: "published",
        platformPostId: success.platform_data.id,
        url: success.platform_data.url,
        raw: redact(success),
        authoritative: true,
      };
    const failure = matched.find((x) => !x.success);
    if (failure)
      return {
        providerJobId: id,
        state: "uncertain",
        error:
          "Provider reported a destination error; terminal finality is undocumented. Reconciliation required.",
        raw: redact(failure),
        authoritative: false,
      };
    return {
      providerJobId: id,
      state:
        post.status === "scheduled"
          ? "scheduled"
          : post.status === "processing"
            ? "processing"
            : "uncertain",
      scheduledAt: post.scheduled_at || undefined,
      raw: redact(post),
      authoritative:
        post.status === "scheduled" || post.status === "processing",
    };
  }
  async reconcile(
    key: string,
    _snapshotHash: string,
    e: DeliveryEnvelope,
  ): Promise<Receipt | null> {
    const posts = await this.pages(
      "/v1/social-posts?external_id=" + encodeURIComponent(key),
      z.object({
        data: z.array(postSchema),
        meta: z.object({ next: z.string().nullable() }).passthrough(),
      }),
    );
    const matches = posts.filter(
      (x) =>
        x.external_id === key &&
        x.social_accounts.some((a: any) => a.id === e.providerAccountId),
    );
    if (matches.length !== 1) return null;
    const candidate = matches[0];
    const payload = providerPayload(e, key, []);
    if (
      candidate.caption !== payload.caption ||
      !candidate.scheduled_at ||
      new Date(candidate.scheduled_at).toISOString() !==
        new Date(e.scheduledAt).toISOString() ||
      candidate.social_accounts.length !== 1 ||
      contentHash(candidate.platform_configurations || {}) !==
        contentHash(payload.platform_configurations)
    )
      throw new ProviderError(
        "ambiguous",
        "Found external reference but immutable payload cannot be verified.",
      );
    // API URLs cannot prove media byte identity after an unknown submission; retain uncertainty for media deliveries.
    if (e.media.length)
      throw new ProviderError(
        "ambiguous",
        "External reference found; approved media identity requires operator verification.",
      );
    return this.status(candidate.id, e);
  }
  async cancel(id: string, e: DeliveryEnvelope): Promise<Receipt> {
    const before = await this.status(id, e);
    if (before.state === "published") return before;
    await this.request("/v1/social-posts/" + encodeURIComponent(id), "DELETE");
    return {
      providerJobId: id,
      state: "uncertain",
      raw: { cancellation_requested: true },
      error:
        "Delete was acknowledged; platform nonpublication is not documented. Confirm with the provider before replacement.",
      authoritative: false,
    };
  }
  async feed(account: string, postId?: string): Promise<FeedPost[]> {
    const query = new URLSearchParams({ expand: "metrics" });
    if (postId) query.set("platform_post_id", postId);
    const rows = await this.pages(
      "/v1/social-account-feeds/" + encodeURIComponent(account) + "?" + query,
      z.object({
        data: z.array(
          z
            .object({
              platform_post_id: z.string(),
              social_account_id: z.string(),
              metrics: z.record(z.string(), z.unknown()).optional(),
              posted_at: z.string().optional(),
            })
            .passthrough(),
        ),
        meta: z.object({ next: z.string().nullable() }).passthrough(),
      }),
    );
    return rows
      .filter((x) => x.social_account_id === account)
      .map((x) => ({
        platformPostId: x.platform_post_id,
        publishedAt: x.posted_at,
        metrics: x.metrics || {},
        raw: redact(x),
      }));
  }
  async authUrl(
    platform: string,
    externalId: string,
    redirect?: string,
    connectionType?: string,
  ) {
    const parsed = z.object({ url: z.url(), platform: z.string() }).safeParse(
      await this.request("/v1/social-accounts/auth-url", "POST", {
        platform,
        external_id: externalId,
        permissions: ["posts", "feeds"],
        ...(redirect ? { redirect_url_override: redirect } : {}),
        ...(["instagram", "linkedin", "x"].includes(platform)
          ? {
              platform_data: {
                [platform]: {
                  connection_type:
                    connectionType ||
                    (platform === "instagram"
                      ? "instagram"
                      : platform === "linkedin"
                        ? "organization"
                        : "oauth2"),
                },
              },
            }
          : {}),
      }),
    );
    if (!parsed.success)
      throw new ProviderError(
        "ambiguous",
        "Authorization URL response invalid.",
      );
    if (parsed.data.platform !== platform)
      throw new ProviderError(
        "ambiguous",
        "Authorization response platform did not match the request.",
      );
    const u = new URL(parsed.data.url);
    if (u.protocol !== "https:")
      throw new ProviderError(
        "validation",
        "Authorization URL must use HTTPS.",
      );
    return parsed.data;
  }
  async accountsByBinding(externalId: string) {
    return this.pages(
      "/v1/social-accounts?external_id=" + encodeURIComponent(externalId),
      z.object({
        data: z.array(
          z
            .object({
              id: z.string(),
              platform: z.string(),
              status: z.enum(["connected", "disconnected"]),
              external_id: z.string().nullable(),
              username: z.string().nullable(),
              user_id: z.string(),
              metadata: z.unknown().optional(),
            })
            .passthrough(),
        ),
        meta: z.object({ next: z.string().nullable() }).passthrough(),
      }),
    );
  }
  async disconnect(id: string) {
    return this.request(
      "/v1/social-accounts/" + encodeURIComponent(id) + "/disconnect",
      "POST",
    );
  }
  async account(id: string) {
    return redact(
      await this.request("/v1/social-accounts/" + encodeURIComponent(id)),
    );
  }
}
import { createHash } from "node:crypto";
const contentHashBytes = (b: Buffer) =>
  createHash("sha256").update(b).digest("hex");
export function redact(value: any): any {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([k]) => !/(token|secret|authorization|password)/i.test(k))
        .map(([k, v]) => [k, redact(v)]),
    );
  return value;
}
