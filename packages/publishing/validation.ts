import { z } from "zod";
import type { DeliveryEnvelope } from "./provider";
import { ProviderError } from "./provider";

const bool = z.boolean().optional();
const settings: Record<string, z.ZodType> = {
  youtube: z.strictObject({
    tags: z.array(z.string().max(100)).max(30).optional(),
    category_id: z.string().optional(),
    default_language: z.string().optional(),
    embeddable: bool,
    license: z.enum(["youtube", "creativeCommon"]).optional(),
    public_stats_viewable: bool,
    made_for_kids: bool,
    contains_synthetic_media: bool,
  }),
  instagram: z.strictObject({
    share_to_feed: bool,
    collaborators: z.array(z.string()).max(3).optional(),
    location: z.string().optional(),
    trial_reel_type: z.enum(["manual", "performance"]).optional(),
    audio_name: z.string().optional(),
  }),
  facebook: z.strictObject({
    location: z.string().optional(),
    set_caption_for_each_image: bool,
  }),
  tiktok: z.strictObject({
    allow_comment: bool,
    allow_duet: bool,
    allow_stitch: bool,
    disclose_your_brand: bool,
    disclose_branded_content: bool,
    is_ai_generated: bool,
    auto_add_music: bool,
  }),
  linkedin: z.strictObject({}),
  x: z.strictObject({}),
};
const formats: Record<string, string[]> = {
  youtube: ["video", "short"],
  instagram: ["reel", "image", "carousel"],
  facebook: ["video", "image", "text"],
  tiktok: ["video", "image", "carousel"],
  linkedin: ["video", "image", "text"],
  x: ["video", "image", "text"],
};
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new ProviderError("validation", message);
}
// One shared semantic gate runs before human approval and in the live serializer.
// Caption/media/privacy/scheduling overrides are deliberately absent from settings.
export function effectiveSettings(
  e: DeliveryEnvelope,
): Record<string, unknown> {
  assert(
    formats[e.platform]?.includes(e.format),
    "This format is unavailable for this platform.",
  );
  const parsed = settings[e.platform]?.safeParse(e.payload.settings);
  assert(
    parsed?.success,
    "Unsupported platform settings. Caption, media, privacy and schedule must use their dedicated fields.",
  );
  const result: Record<string, unknown> = {
    ...(parsed.data as Record<string, unknown>),
  };
  const videos = e.media.filter((x) => x.mimeType.startsWith("video/"));
  const images = e.media.filter((x) => x.mimeType.startsWith("image/"));
  if (["video", "reel", "short"].includes(e.format))
    assert(
      e.media.length === 1 && videos.length === 1,
      "Choose exactly one video for this format.",
    );
  if (e.format === "image")
    assert(
      e.media.length === 1 && images.length === 1,
      "Choose exactly one image for this format.",
    );
  if (e.format === "carousel")
    assert(
      e.media.length >= 2 && images.length === e.media.length,
      "Choose two to ten images for a carousel.",
    );
  if (e.format === "text")
    assert(
      videos.length === 0 && images.length === e.media.length,
      "Text posts can include images, but not video.",
    );
  if (e.platform === "youtube") {
    assert(
      e.payload.title.trim().length > 0 && e.payload.title.length <= 100,
      "YouTube requires a title of at most 100 characters.",
    );
    if (e.format === "short") {
      const video = videos[0];
      assert(
        video.width &&
          video.height &&
          video.duration &&
          video.width <= video.height &&
          video.duration <= 180,
        "YouTube Shorts require square or vertical video lasting at most three minutes.",
      );
    }
    Object.assign(result, {
      title: e.payload.title,
      description:
        e.payload.description ||
        [e.payload.hook, e.payload.caption, e.payload.cta]
          .filter(Boolean)
          .join("\n\n"),
      privacy_status: e.payload.visibility,
      made_for_kids: result.made_for_kids ?? false,
    });
  } else if (e.platform === "tiktok") {
    assert(
      ["public", "private"].includes(e.payload.visibility),
      "TikTok supports public or private visibility.",
    );
    Object.assign(result, {
      title: e.payload.title,
      privacy_status: e.payload.visibility,
      is_draft: false,
      auto_add_music: result.auto_add_music ?? false,
    });
  } else
    assert(
      e.payload.visibility === "public",
      "Choose public visibility for this platform.",
    );
  if (e.platform === "instagram")
    result.placement = e.format === "reel" ? "reels" : "timeline";
  if (e.platform === "facebook") result.placement = "timeline";
  return result;
}
