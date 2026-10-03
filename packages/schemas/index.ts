import { z } from "zod";
export const id = z.uuid();
export const platform = z.enum([
  "youtube",
  "facebook",
  "instagram",
  "tiktok",
  "linkedin",
  "x",
]);
export const format = z.enum([
  "video",
  "short",
  "reel",
  "image",
  "text",
  "carousel",
]);
export const mediaSelection = z.object({
  assetId: id,
  derivativeId: id.nullable().default(null),
});
export const revisionPayload = z.object({
  hook: z.string().max(300),
  caption: z.string().max(10000),
  title: z.string().max(120).default(""),
  description: z.string().max(10000).default(""),
  cta: z.string().max(500).default(""),
  visibility: z.enum(["public", "private", "unlisted"]).default("public"),
  settings: z
    .record(
      z.string(),
      z.union([z.string(), z.boolean(), z.number(), z.array(z.string())]),
    )
    .default({}),
  media: z.array(mediaSelection).max(10).default([]),
  utm: z.string().max(2000).default(""),
});
export type RevisionPayload = z.infer<typeof revisionPayload>;
export const packageInput = z.object({
  title: z.string().trim().min(1).max(200),
  sourceNotes: z.string().max(20000).default(""),
  brief: z.string().max(10000).default(""),
  tags: z.array(z.string().max(50)).max(20).default([]),
  assetIds: z.array(id).max(10).default([]),
});
export const variantInput = z.object({
  packageId: id,
  accountId: id,
  format,
  payload: revisionPayload,
});
export const approvalInput = z.object({
  variantId: id,
  revisionId: id,
  scheduledAt: z.iso.datetime({ offset: true }),
});
export const experimentInput = z.object({
  name: z.string().min(1).max(150),
  hypothesis: z.string().min(10).max(2000),
  changedVariable: z.enum(["hook", "format", "cta", "publishing_window"]),
  primaryMetric: z.enum([
    "views",
    "likes",
    "comments",
    "shares",
    "engagement_rate",
  ]),
  denominator: z.enum(["views", "impressions"]).nullable().default(null),
  horizonHours: z.number().int().min(1).max(720).default(24),
  plannedSamples: z.number().int().min(3).max(1000).default(3),
  accounts: z
    .array(z.object({ accountId: id, formats: z.array(format).min(1) }))
    .min(1)
    .max(30),
  startAt: z.iso.datetime({ offset: true }).nullable().default(null),
  endAt: z.iso.datetime({ offset: true }).nullable().default(null),
  endCondition: z
    .string()
    .min(5)
    .max(500)
    .default("Planned sample size and evaluation horizon reached"),
});
export const scopes = z.enum([
  "read",
  "draft",
  "request_approval",
  "schedule",
  "analytics",
]);
export const tokenInput = z.object({
  name: z.string().min(1).max(80),
  scopes: z.array(scopes).min(1).default(["read", "draft", "request_approval"]),
  expiresAt: z.iso.datetime({ offset: true }),
});
export const mediaRecipe = z
  .object({
    trimStart: z.number().min(0).max(3600).optional(),
    trimEnd: z.number().min(0).max(3600).optional(),
    width: z.number().int().min(64).max(1920).default(1080),
    height: z.number().int().min(64).max(1920).default(1920),
    fit: z.enum(["letterbox", "crop", "stretch"]).default("letterbox"),
    cropX: z.number().min(0).max(1).default(0.5),
    cropY: z.number().min(0).max(1).default(0.5),
    output: z.enum(["mp4", "png", "jpeg"]).default("mp4"),
    thumbnailAt: z.number().min(0).max(3600).optional(),
    subtitles: z.string().max(50000).optional(),
  })
  .refine((x) => x.trimEnd === undefined || x.trimEnd > (x.trimStart || 0), {
    message: "Trim end must be after trim start",
  });
export type MediaRecipe = z.infer<typeof mediaRecipe>;
