// Adapted from the MIT Instagram/Facebook skills by Creative Content Crafts
// and Hao0321's social-post quick card. Source commits and licenses are in vendor/writing.
// These are writing defaults, not learned personal voice or platform-ranking claims.
const common = [
  "Use one clear idea. Prefer direct wording and concrete details from the supplied source.",
  "Never invent results, statistics, testimonials, lived experience, or facts.",
  "Respect this account's explicit rules, audience and writing guidelines over these defaults.",
  "Use short paragraphs and accurate capitalization for names, brands and products.",
  "Avoid corporate filler, forced sincerity, exaggerated promises and unnecessary emoji.",
  "Use a call to action only when the source brief gives it a purpose; one action is enough.",
];
const platformGuidance: Record<string, string[]> = {
  instagram: [
    "Lead with a specific first line. Let the caption add context to the image or reel.",
    "Use restrained, relevant hashtags only when requested. Do not invent trending tags.",
  ],
  facebook: [
    "Choose a useful tip, a grounded story, or a specific point of view. Open with its concrete point.",
    "Invite a relevant response only when it serves the post; avoid engagement bait.",
  ],
  x: [
    "Make the first sentence understandable on its own. Keep the post focused and concise.",
  ],
  linkedin: [
    "Start with a verifiable result or a useful lesson. Give context before a takeaway.",
    "Match the account's professional voice; do not fabricate authority or personal anecdotes.",
  ],
  youtube: [
    "Make the title and description accurately reflect the source video. Avoid misleading promises.",
  ],
  tiktok: [
    "Keep the hook and caption aligned with the source video or photo sequence. Do not invent visual events.",
  ],
};
export function writingGuidance(platform: string, format: string) {
  return {
    principles: [...common, ...(platformGuidance[platform] || [])],
    format,
    hookStructures: [
      "A specific useful outcome supported by the source",
      "A short grounded observation",
      "An actual before-and-after from the source",
      "A practical lesson with enough context",
    ],
    provenance:
      "Open-source writing defaults; account voice is supplied by the user.",
  };
}
