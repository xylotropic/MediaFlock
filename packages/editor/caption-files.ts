import {
  captionSchema,
  compileRenderPlan,
  type EditorProject,
  type FrameRate,
  type LocalSource,
  type SourceCaption,
} from "./project";

export const MAX_CAPTION_FILE_BYTES = 2 * 1024 ** 2;
export type CaptionFileFormat = "srt" | "vtt";
export interface CaptionImport {
  format: CaptionFileFormat;
  captions: SourceCaption[];
  styleConverted: boolean;
}
function timestampUs(text: string, format: CaptionFileFormat): number {
  const match = text.match(
    format === "srt"
      ? /^(\d{2,}):([0-5]\d):([0-5]\d)[,.](\d{3})$/
      : /^(?:(\d{2,}):)?([0-5]\d):([0-5]\d)\.(\d{3})$/,
  );
  if (!match)
    throw new Error("Use valid subtitle timestamps with milliseconds.");
  const us =
    ((Number(match[1] || 0) * 60 + Number(match[2])) * 60 + Number(match[3])) *
      1_000_000 +
    Number(match[4]) * 1000;
  if (!Number.isSafeInteger(us) || us > 5_400_000_000)
    throw new Error("Caption timestamps must be within 90 minutes.");
  return us;
}
const entities: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  nbsp: "\u00a0",
  lrm: "\u200e",
  rlm: "\u200f",
  quot: '"',
  apos: "'",
};
function plainText(text: string): string {
  // Strip formatting before decoding entities. Decoded angle brackets remain
  // literal caption text and are never interpreted as markup or instructions.
  return text
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^<>]*>/g, "")
    .replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
      if (!name.startsWith("#")) return entities[name] ?? whole;
      const code =
        name.startsWith("#x") || name.startsWith("#X")
          ? Number.parseInt(name.slice(2), 16)
          : Number.parseInt(name.slice(1), 10);
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
        ? String.fromCodePoint(code)
        : whole;
    })
    .trim();
}
/** Parse a bounded local file completely before creating any saved edit.
 * Imported times belong to the original source, never the current timeline. */
export function parseCaptionFile(
  input: string,
  source: Pick<LocalSource, "id" | "durationUs">,
  makeId: () => string = () => crypto.randomUUID(),
): CaptionImport {
  if (
    input.length > MAX_CAPTION_FILE_BYTES ||
    new TextEncoder().encode(input).byteLength > MAX_CAPTION_FILE_BYTES
  )
    throw new Error("Choose a caption file smaller than 2 MB.");
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(input))
    throw new Error("Choose a plain UTF-8 subtitle file.");
  const text = input
    .replace(/^\ufeff/, "")
    .replace(/\r\n?/g, "\n")
    .trim();
  const blocks = text.split(/\n[\t ]*\n+/);
  const format: CaptionFileFormat = /^WEBVTT(?:[\t ]|\n|$)/.test(text)
    ? "vtt"
    : "srt";
  let styleConverted = false;
  if (format === "vtt") {
    const header = blocks.shift()!;
    if (
      !/^WEBVTT(?:[\t ].*)?$/.test(header.split("\n")[0]) ||
      header.includes("-->")
    )
      throw new Error(
        "Separate the WEBVTT header from its cues with a blank line.",
      );
  }
  const captions: SourceCaption[] = [];
  for (const block of blocks) {
    const lines = block.split("\n");
    if (format === "vtt" && /^NOTE(?:[\t ]|$)/.test(lines[0])) continue;
    if (format === "vtt" && /^(STYLE|REGION)$/.test(lines[0])) {
      styleConverted = true;
      continue;
    }
    const line = lines[0]?.includes("-->") ? 0 : 1;
    if (format === "srt" && (line !== 1 || !/^\d+$/.test(lines[0])))
      throw new Error(
        `Caption ${captions.length + 1} needs a numbered SRT cue.`,
      );
    const timing = lines[line]?.match(
      /^(\S+)[\t ]+-->[\t ]+(\S+)(?:[\t ]+(.*))?$/,
    );
    if (!timing || lines.length <= line + 1)
      throw new Error(
        `Caption ${captions.length + 1} needs a time range and text.`,
      );
    const inUs = timestampUs(timing[1], format),
      outUs = timestampUs(timing[2], format);
    if (outUs <= inUs || outUs > source.durationUs)
      throw new Error(
        `Caption ${captions.length + 1} must have a positive range within this source video.`,
      );
    const raw = lines.slice(line + 1).join("\n"),
      content = plainText(raw);
    if (
      !content ||
      content.length > 2000 ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(content)
    )
      throw new Error(
        `Caption ${captions.length + 1} needs between 1 and 2,000 readable characters.`,
      );
    styleConverted ||= !!timing[3] || /<[^<>]*>/.test(raw);
    if (captions.length >= 10_000)
      throw new Error("A caption file can contain at most 10,000 cues.");
    captions.push(
      captionSchema.parse({
        id: makeId(),
        sourceId: source.id,
        inUs,
        outUs,
        text: content,
      }),
    );
  }
  if (!captions.length)
    throw new Error("The file does not contain any caption cues.");
  return { format, captions, styleConverted };
}
function stamp(milliseconds: number, format: CaptionFileFormat): string {
  const hours = Math.floor(milliseconds / 3_600_000),
    minutes = Math.floor(milliseconds / 60_000) % 60,
    seconds = Math.floor(milliseconds / 1000) % 60,
    ms = milliseconds % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}${format === "srt" ? "," : "."}${String(ms).padStart(3, "0")}`;
}
function escapeText(text: string): string {
  // Blank lines delimit subtitle cues. Fold paragraph gaps in the sidecar
  // without modifying the saved source caption or splitting its time range.
  const payload = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .join("\n")
    .trim();
  if (!payload || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(payload))
    throw new Error(
      "Remove empty text or control characters before downloading captions.",
    );
  return payload
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
function frameMilliseconds(frame: number, fps: FrameRate): number {
  // Both edges round down from the exact rational frame clock. At <=60 fps,
  // this sub-millisecond shift keeps the same included/excluded video frames.
  return Number(
    (BigInt(frame) * BigInt(fps.denominator) * 1000n) / BigInt(fps.numerator),
  );
}
/** Use the sealed video job's project for its sidecar. Changing the open edit
 * or disabling burned-in text cannot change a previously exported sidecar. */
export function timelineCaptionFile(
  project: EditorProject,
  format: CaptionFileFormat = "srt",
): string {
  const plan = compileRenderPlan({
    ...project,
    output: { ...project.output, captions: true },
  });
  if (!plan.captions.length)
    throw new Error(
      "No source captions overlap this edit. Add or import captions before downloading them.",
    );
  const cues = plan.captions.map(
    (cue, index) =>
      `${index + 1}\n${stamp(frameMilliseconds(cue.inFrame, plan.output.fps), format)} --> ${stamp(frameMilliseconds(cue.outFrame, plan.output.fps), format)}\n${escapeText(cue.text)}\n`,
  );
  return `${format === "vtt" ? "WEBVTT\n\n" : ""}${cues.join("\n")}\n`;
}
