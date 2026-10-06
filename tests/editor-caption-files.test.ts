import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import {
  parseCaptionFile,
  timelineCaptionFile,
  MAX_CAPTION_FILE_BYTES,
} from "../packages/editor/caption-files";
import {
  compileRenderPlan,
  newEditorProject,
  type FrameRate,
} from "../packages/editor/project";
import {
  applyEditorCommand,
  startEditorJournal,
  undoEditorCommand,
  redoEditorCommand,
  journalSchema,
} from "../packages/editor/journal";
function fixture() {
  const project = newEditorProject(randomUUID(), "Caption fixture");
  project.sources.push({
    id: randomUUID(),
    name: "original.mp4",
    sha256: "a".repeat(64),
    bytes: 1000,
    durationUs: 10_000_000,
    width: 640,
    height: 360,
    hasAudio: true,
    rotation: "0",
  });
  return { project, source: project.sources[0] };
}
const srt =
  "1\n00:00:00,250 --> 00:00:01,500\nFirst line\nSecond line\n\n2\n00:00:03,000 --> 00:00:05,000\nLater words\n";
it("imports BOM/CRLF SRT and preserves original source time and multiline words", () => {
  const { source } = fixture();
  const parsed = parseCaptionFile(
    "\ufeff" + srt.replaceAll("\n", "\r\n"),
    source,
  );
  expect(parsed.format).toBe("srt");
  expect(
    parsed.captions.map((c) => [c.inUs, c.outUs, c.text, c.sourceId]),
  ).toEqual([
    [250_000, 1_500_000, "First line\nSecond line", source.id],
    [3_000_000, 5_000_000, "Later words", source.id],
  ]);
  expect(new Set(parsed.captions.map((c) => c.id)).size).toBe(2);
});
it("reads VTT cue IDs, two timestamp forms and comments without executing formatting or style", () => {
  const { source } = fixture();
  const parsed = parseCaptionFile(
    "WEBVTT\nKind: captions\n\nNOTE ignored comment\nhttps://example.invalid/never-fetch\n\nSTYLE\n::cue { background: url(https://example.invalid/never-fetch); }\n\nvoice-1\n00:00.250 --> 00:01.500 align:right\n<v Speaker><b>Reviewed</b> &amp; &lt;script&gt;\n\n00:00:03.000 --> 00:00:04.000\nAnother line\n",
    source,
  );
  expect(parsed.format).toBe("vtt");
  expect(parsed.styleConverted).toBe(true);
  expect(parsed.captions.map((c) => c.text)).toEqual([
    "Reviewed & <script>",
    "Another line",
  ]);
});
it.each([
  "1\n00:00:01,500 --> 00:00:01,000\nBackwards",
  "1\n00:00:00,000 --> 00:00:11,000\nPast source",
  "1\n00:60:00,000 --> 00:61:00,000\nInvalid minutes",
  "1\n00:00:00,000 --> 00:00:01,000\n",
  srt + "\n3\nnot a timestamp\nBroken later cue",
  "WEBVTT\n00:00.000 --> 00:01.000\nMissing header separator",
  "1\n00:00:00,000 --> 00:00:01,000\n" + "x".repeat(2001),
  "\u0000" + srt,
])(
  "rejects the entire malformed caption file without returning partial cues: %s",
  (text) => {
    const { source } = fixture();
    expect(() => parseCaptionFile(text, source)).toThrow();
  },
);
it("bounds bytes, count and hostile tag text while allowing 10,000 valid short cues", () => {
  const { source } = fixture();
  expect(() =>
    parseCaptionFile("x".repeat(MAX_CAPTION_FILE_BYTES + 1), source),
  ).toThrow(/2 MB/);
  expect(() =>
    parseCaptionFile("é".repeat(MAX_CAPTION_FILE_BYTES / 2 + 1), source),
  ).toThrow(/2 MB/);
  // Repeated '<' must not trigger quadratic tag stripping.
  expect(() =>
    parseCaptionFile(
      "1\n00:00:00,000 --> 00:00:01,000\n" + "<".repeat(200_000),
      source,
    ),
  ).toThrow(/2,000/);
  const cues = Array.from(
    { length: 10_000 },
    (_, n) => `${n + 1}\n00:00:00,000 --> 00:00:00,100\nCue ${n}\n`,
  ).join("\n");
  expect(parseCaptionFile(cues, source).captions).toHaveLength(10_000);
  expect(() =>
    parseCaptionFile(
      cues + "\n10001\n00:00:00,000 --> 00:00:00,100\nToo many",
      source,
    ),
  ).toThrow(/10,000/);
});
it("saves an import as one undoable edit and retains other captions through durable redo", () => {
  const { project, source } = fixture();
  const other = {
    id: randomUUID(),
    sourceId: source.id,
    inUs: 0,
    outUs: 100_000,
    text: "Existing words",
  };
  project.captions.push(other);
  const imported = parseCaptionFile(srt, source).captions;
  const initial = startEditorJournal(project),
    before = JSON.stringify(initial);
  let next = applyEditorCommand(initial, {
    kind: "insert-captions",
    captions: imported,
  });
  expect(next.undo).toHaveLength(1);
  expect(next.project.editSequence).toBe(1);
  expect(next.project.captions).toEqual([other, ...imported]);
  next = undoEditorCommand(
    journalSchema.parse(JSON.parse(JSON.stringify(next))),
  );
  expect(next.project.captions).toEqual([other]);
  next = redoEditorCommand(
    journalSchema.parse(JSON.parse(JSON.stringify(next))),
  );
  expect(next.project.captions).toEqual([other, ...imported]);
  expect(next.project.editSequence).toBe(3);
  expect(JSON.stringify(initial)).toBe(before);
});
it("rejects duplicate IDs, out-of-source ranges and missing caption edits atomically", () => {
  const { project, source } = fixture(),
    initial = startEditorJournal(project),
    before = JSON.stringify(initial);
  const cues = parseCaptionFile(srt, source).captions;
  for (const bad of [
    [cues[0], cues[0]],
    [cues[0], { ...cues[1], outUs: source.durationUs + 1 }],
  ]) {
    expect(() =>
      applyEditorCommand(initial, { kind: "insert-captions", captions: bad }),
    ).toThrow();
    expect(JSON.stringify(initial)).toBe(before);
  }
  expect(() =>
    applyEditorCommand(initial, { kind: "edit-caption", caption: cues[0] }),
  ).toThrow(/no longer available/);
  const saved = applyEditorCommand(initial, {
    kind: "insert-captions",
    captions: cues,
  });
  const edited = applyEditorCommand(saved, {
    kind: "edit-caption",
    caption: { ...cues[0], text: "Corrected words", inUs: 500_000 },
  });
  expect(edited.project.captions[0].text).toBe("Corrected words");
  expect(undoEditorCommand(edited).project.captions).toEqual(cues);
});
it("maps trimmed, reordered and repeated clips to the exact output clock, even without burned-in text", () => {
  const { project, source } = fixture();
  project.captions = parseCaptionFile(srt, source).captions;
  const clip = (start: number, end: number) => ({
    id: randomUUID(),
    sourceId: source.id,
    inUs: start,
    outUs: end,
    muted: false,
    effects: {
      brightness: 1,
      contrast: 1,
      saturation: 1,
      look: "original" as const,
    },
  });
  project.clips = [
    clip(3_500_000, 4_500_000),
    clip(500_000, 1_000_000),
    clip(3_500_000, 4_500_000),
  ];
  project.output.captions = false;
  expect(compileRenderPlan(project).captions).toHaveLength(0);
  const result = timelineCaptionFile(project);
  const parsed = parseCaptionFile(result, {
    ...source,
    durationUs: 2_500_000,
  }).captions;
  expect(parsed.map((c) => [c.inUs, c.outUs, c.text])).toEqual([
    [0, 1_000_000, "Later words"],
    [1_000_000, 1_500_000, "First line\nSecond line"],
    [1_500_000, 2_500_000, "Later words"],
  ]);
  const snapshot = structuredClone(project);
  project.captions[0].text = "Changed open edit";
  expect(timelineCaptionFile(snapshot)).toBe(result);
  expect(
    parseCaptionFile(timelineCaptionFile(snapshot, "vtt"), {
      ...source,
      durationUs: 2_500_000,
    }).captions.map((c) => c.text),
  ).toEqual(parsed.map((c) => c.text));
});
it.each<FrameRate>([
  { numerator: 30, denominator: 1 },
  { numerator: 30_000, denominator: 1001 },
  { numerator: 60_000, denominator: 1001 },
])(
  "sidecar milliseconds select exactly the same frames at rational frame rate %j",
  (fps) => {
    const { project, source } = fixture();
    project.output.fps = fps;
    project.clips = [
      {
        id: randomUUID(),
        sourceId: source.id,
        inUs: 0,
        outUs: source.durationUs,
        muted: false,
        effects: {
          brightness: 1,
          contrast: 1,
          saturation: 1,
          look: "original",
        },
      },
    ];
    project.captions = [
      {
        id: randomUUID(),
        sourceId: source.id,
        inUs: 450_123,
        outUs: 4_000_876,
        text: "Timed & <literal>",
      },
    ];
    const plan = compileRenderPlan(project),
      parsed = parseCaptionFile(timelineCaptionFile(project), source)
        .captions[0];
    expect(parsed.text).toBe(project.captions[0].text);
    const included = [];
    for (let frame = 0; frame < plan.videoFrames; frame++) {
      const exact = BigInt(frame) * BigInt(fps.denominator) * 1_000_000n;
      if (
        exact >= BigInt(parsed.inUs) * BigInt(fps.numerator) &&
        exact < BigInt(parsed.outUs) * BigInt(fps.numerator)
      )
        included.push(frame);
    }
    expect(included).toEqual(
      Array.from(
        { length: plan.captions[0].outFrame - plan.captions[0].inFrame },
        (_, n) => n + plan.captions[0].inFrame,
      ),
    );
  },
);
it("keeps manual paragraph spacing from terminating a subtitle cue", () => {
  const { project, source } = fixture();
  project.clips = [
    {
      id: randomUUID(),
      sourceId: source.id,
      inUs: 0,
      outUs: 2_000_000,
      muted: false,
      effects: { brightness: 1, contrast: 1, saturation: 1, look: "original" },
    },
  ];
  project.captions = [
    {
      id: randomUUID(),
      sourceId: source.id,
      inUs: 0,
      outUs: 1_000_000,
      text: "First line\r\n \r\nSecond line",
    },
  ];
  for (const format of ["srt", "vtt"] as const) {
    const parsed = parseCaptionFile(
      timelineCaptionFile(project, format),
      source,
    );
    expect(parsed.captions).toHaveLength(1);
    expect(parsed.captions[0].text).toBe("First line\nSecond line");
    expect(project.captions[0].text).toBe("First line\r\n \r\nSecond line");
  }
});
