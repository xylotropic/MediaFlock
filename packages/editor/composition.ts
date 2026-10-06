import type { EditorClip, RenderCaption } from "./project";
type Context = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export function captionLayout(
  ctx: Context,
  width: number,
  height: number,
  captions: Pick<RenderCaption, "text">[],
) {
  if (captions.length > 8)
    throw new Error(
      "More than eight captions overlap. Shorten or separate those cues before exporting.",
    );
  const text = captions.map((c) => c.text).join("\n"),
    maxWidth = width * 0.86;
  let fontSize = Math.round(Math.min(width * 0.065, height * 0.06)),
    lines: string[] = [];
  do {
    ctx.font = `600 ${fontSize}px Arial, sans-serif`;
    lines = [];
    for (const paragraph of text.split(/\n/)) {
      let line = "";
      for (const word of paragraph.split(/\s+/)) {
        if (line && ctx.measureText(`${line} ${word}`).width > maxWidth) {
          lines.push(line);
          line = word;
        } else line = line ? `${line} ${word}` : word;
      }
      if (line) lines.push(line);
    }
    if (
      lines.length <= 6 &&
      lines.every((line) => ctx.measureText(line).width <= maxWidth)
    )
      break;
    fontSize -= 2;
  } while (fontSize >= 12);
  if (fontSize < 12)
    throw new Error(
      "A caption is too long to fit this output. Split it into shorter cues.",
    );
  return { fontSize, lines };
}

export function clipFilter(effects: EditorClip["effects"]): string {
  return `brightness(${effects.brightness}) contrast(${effects.contrast}) saturate(${effects.saturation}) ${effects.look === "monochrome" ? "grayscale(1)" : effects.look === "sepia" ? "sepia(1)" : ""}`.trim();
}
/** Picture and caption composition is shared by preview and offline export. */
export function drawComposition(
  ctx: Context,
  image: CanvasImageSource | null,
  sourceWidth: number,
  sourceHeight: number,
  width: number,
  height: number,
  fit: "contain" | "cover",
  effects: EditorClip["effects"],
  captions: Pick<RenderCaption, "text">[],
  pictureRenderer?: (
    ctx: Context,
    x: number,
    y: number,
    width: number,
    height: number,
  ) => void,
) {
  ctx.save();
  try {
    ctx.filter = "none";
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, width, height);
    if ((image || pictureRenderer) && sourceWidth > 0 && sourceHeight > 0) {
      const scale =
        fit === "cover"
          ? Math.max(width / sourceWidth, height / sourceHeight)
          : Math.min(width / sourceWidth, height / sourceHeight);
      const w = sourceWidth * scale,
        h = sourceHeight * scale;
      ctx.filter = clipFilter(effects);
      if (pictureRenderer)
        pictureRenderer(ctx, (width - w) / 2, (height - h) / 2, w, h);
      else if (image)
        ctx.drawImage(image, (width - w) / 2, (height - h) / 2, w, h);
      ctx.filter = "none";
    }
    if (captions.length) {
      const { fontSize, lines } = captionLayout(ctx, width, height, captions);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineJoin = "round";
      ctx.fillStyle = "#fff";
      ctx.strokeStyle = "rgba(0,0,0,.85)";
      ctx.lineWidth = Math.max(2, fontSize * 0.1);
      const lineHeight = fontSize * 1.25,
        start = height * 0.86 - (lines.length - 1) * lineHeight;
      lines.forEach((line, n) => {
        const y = start + n * lineHeight;
        ctx.strokeText(line, width / 2, y);
        ctx.fillText(line, width / 2, y);
      });
    }
  } finally {
    ctx.restore();
  }
}
