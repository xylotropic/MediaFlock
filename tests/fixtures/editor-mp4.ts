const word = (n: number) => {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, n);
  return out;
};
const join = (...values: Uint8Array[]) => {
  const out = new Uint8Array(values.reduce((n, v) => n + v.length, 0));
  let at = 0;
  for (const value of values) {
    out.set(value, at);
    at += value.length;
  }
  return out;
};
const box = (type: string, ...content: Uint8Array[]) => {
  const body = join(...content);
  return join(word(body.length + 8), new TextEncoder().encode(type), body);
};
export function audioMp4Fixture({
  end = 7168,
  id = 2,
  descriptions = 1,
  sampleDescription = 1,
  edits = [{ duration: end, start: 1024, rate: 0x10000 }],
  fragmented = false,
}: {
  end?: number;
  id?: number;
  descriptions?: number;
  sampleDescription?: number;
  edits?: { duration: number; start: number; rate: number }[];
  fragmented?: boolean;
} = {}) {
  const timing = (duration: number) =>
    join(new Uint8Array(12), word(44100), word(duration));
  const mvhd = box("mvhd", timing(end));
  const tkhd = box("tkhd", new Uint8Array(12), word(id));
  const elst = box(
    "elst",
    new Uint8Array(4),
    word(edits.length),
    ...edits.map((e) => join(word(e.duration), word(e.start), word(e.rate))),
  );
  const mdhd = box("mdhd", timing(end + 1024));
  const hdlr = box("hdlr", new Uint8Array(8), new TextEncoder().encode("soun"));
  const stsd = box(
    "stsd",
    new Uint8Array(4),
    word(descriptions),
    ...Array.from({ length: descriptions }, () =>
      box("mp4a", new Uint8Array(28)),
    ),
  );
  const stsc = box(
    "stsc",
    new Uint8Array(4),
    word(1),
    word(1),
    word(8),
    word(sampleDescription),
  );
  const trak = box(
    "trak",
    tkhd,
    box("edts", elst),
    box("mdia", mdhd, hdlr, box("minf", box("stbl", stsd, stsc))),
  );
  return new File(
    [
      box("ftyp", new Uint8Array(8)),
      box("moov", mvhd, trak, ...(fragmented ? [box("mvex")] : [])),
    ],
    "synthetic.mp4",
  );
}
