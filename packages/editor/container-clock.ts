/** Inspect declarations before a demuxer can discard unsupported MP4 edits.
 * Only the classic, single-description, unit-rate presentation is admitted.
 * Media payloads are skipped; the bounded movie metadata is read locally. */
export interface Mp4Presentation {
  id: number;
  kind: string;
  timescale: number;
  mediaDuration: number;
  mediaStart: number;
  segmentDuration: number | null;
  movieTimescale: number;
}
interface Box {
  type: string;
  start: number;
  end: number;
}
const MAX_METADATA = 32 * 1024 ** 2;
const MAX_BOXES = 16_384;
const cache = new WeakMap<File, readonly Mp4Presentation[]>();
const unsupported = () =>
  new Error(
    "This video's container timing is not supported yet. Export a separate local MP4 copy with a single continuous picture and sound track.",
  );
/** The demuxer does not implement an edit's end boundary. Reject a truncated
 * segment rather than rendering packets outside the declared presentation. */
export function assertMp4PresentationEnd(
  presentation: Mp4Presentation,
  seconds: number,
): void {
  if (presentation.segmentDuration === null) return;
  const value = seconds * presentation.timescale,
    ticks = Math.round(value);
  if (
    !Number.isSafeInteger(ticks) ||
    ticks < 1 ||
    Math.abs(value - ticks) >
      Math.max(1e-6, Math.abs(value) * Number.EPSILON * 8) ||
    BigInt(presentation.segmentDuration) * BigInt(presentation.timescale) !==
      BigInt(ticks) * BigInt(presentation.movieTimescale)
  )
    throw unsupported();
}
function safe(value: bigint): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw unsupported();
  return n;
}

export async function admitMp4Presentation(
  file: File,
  signal?: AbortSignal,
): Promise<readonly Mp4Presentation[]> {
  signal?.throwIfAborted();
  const prior = cache.get(file);
  if (prior) return prior;
  let offset = 0,
    count = 0,
    movie: ArrayBuffer | undefined;
  while (offset < file.size) {
    signal?.throwIfAborted();
    if (++count > MAX_BOXES || file.size - offset < 8) throw unsupported();
    const head = new DataView(
      await file.slice(offset, Math.min(offset + 16, file.size)).arrayBuffer(),
    );
    const type = String.fromCharCode(
      head.getUint8(4),
      head.getUint8(5),
      head.getUint8(6),
      head.getUint8(7),
    );
    let size = head.getUint32(0),
      header = 8;
    if (size === 1) {
      if (head.byteLength < 16) throw unsupported();
      size = safe(head.getBigUint64(8));
      header = 16;
    } else if (size === 0) size = file.size - offset;
    if (size < header || size > file.size - offset) throw unsupported();
    if (["moof", "mfra"].includes(type)) throw unsupported();
    if (type === "moov") {
      if (movie || size - header > MAX_METADATA) throw unsupported();
      movie = await file.slice(offset + header, offset + size).arrayBuffer();
    }
    offset += size;
  }
  signal?.throwIfAborted();
  if (!movie) throw unsupported();
  const view = new DataView(movie);
  const need = (start: number, bytes: number, end: number) => {
    if (start < 0 || bytes < 0 || start + bytes > end) throw unsupported();
  };
  const boxes = (start: number, end: number): Box[] => {
    const result: Box[] = [];
    for (let at = start; at < end;) {
      need(at, 8, end);
      if (++count > MAX_BOXES) throw unsupported();
      const type = String.fromCharCode(
        view.getUint8(at + 4),
        view.getUint8(at + 5),
        view.getUint8(at + 6),
        view.getUint8(at + 7),
      );
      let size = view.getUint32(at),
        header = 8;
      if (size === 1) {
        need(at, 16, end);
        size = safe(view.getBigUint64(at + 8));
        header = 16;
      } else if (size === 0) size = end - at;
      if (size < header || size > end - at) throw unsupported();
      result.push({ type, start: at + header, end: at + size });
      at += size;
    }
    return result;
  };
  const one = (list: Box[], type: string, required = true) => {
    const matches = list.filter((b) => b.type === type);
    if (matches.length > 1 || (required && matches.length !== 1))
      throw unsupported();
    return matches[0];
  };
  const fullVersion = (box: Box) => {
    need(box.start, 4, box.end);
    const version = view.getUint8(box.start);
    if (version > 1) throw unsupported();
    return version;
  };
  const timing = (box: Box) => {
    const version = fullVersion(box),
      at = box.start + (version ? 20 : 12);
    need(at, version ? 12 : 8, box.end);
    const timescale = view.getUint32(at),
      duration = version
        ? safe(view.getBigUint64(at + 4))
        : view.getUint32(at + 4);
    if (!timescale || !duration) throw unsupported();
    return { timescale, duration };
  };
  const top = boxes(0, movie.byteLength);
  if (top.some((b) => b.type === "mvex")) throw unsupported();
  const movieTimescale = timing(one(top, "mvhd")!).timescale;
  const result: Mp4Presentation[] = [];
  for (const trak of top.filter((b) => b.type === "trak")) {
    const children = boxes(trak.start, trak.end),
      tkhd = one(children, "tkhd")!;
    const idAt = tkhd.start + (fullVersion(tkhd) ? 20 : 12);
    need(idAt, 4, tkhd.end);
    const id = view.getUint32(idAt);
    if (!id || result.some((t) => t.id === id)) throw unsupported();
    const mdia = one(children, "mdia")!,
      media = boxes(mdia.start, mdia.end);
    const mdhd = timing(one(media, "mdhd")!),
      hdlr = one(media, "hdlr")!;
    need(hdlr.start, 12, hdlr.end);
    const kind = String.fromCharCode(
      ...[8, 9, 10, 11].map((n) => view.getUint8(hdlr.start + n)),
    );
    if (!["soun", "vide"].includes(kind)) continue;
    const minf = one(media, "minf")!,
      stbl = one(boxes(minf.start, minf.end), "stbl")!;
    const tables = boxes(stbl.start, stbl.end),
      stsd = one(tables, "stsd")!;
    need(stsd.start, 8, stsd.end);
    if (view.getUint8(stsd.start) !== 0 || view.getUint32(stsd.start + 4) !== 1)
      throw unsupported();
    const descriptions = boxes(stsd.start + 8, stsd.end);
    if (descriptions.length !== 1) throw unsupported();
    const stsc = one(tables, "stsc")!;
    need(stsc.start, 8, stsc.end);
    const entries = view.getUint32(stsc.start + 4);
    if (
      entries > MAX_METADATA / 12 ||
      stsc.end - stsc.start !== 8 + entries * 12
    )
      throw unsupported();
    for (let n = 0; n < entries; n++)
      if (view.getUint32(stsc.start + 8 + n * 12 + 8) !== 1)
        throw unsupported();
    let mediaStart = 0,
      segmentDuration: number | null = null;
    const edts = one(children, "edts", false);
    if (edts) {
      const elst = one(boxes(edts.start, edts.end), "elst")!,
        version = fullVersion(elst);
      need(elst.start, 8, elst.end);
      const width = version ? 20 : 12;
      if (
        view.getUint32(elst.start + 4) !== 1 ||
        elst.end - elst.start !== 8 + width
      )
        throw unsupported();
      const at = elst.start + 8;
      segmentDuration = version
        ? safe(view.getBigUint64(at))
        : view.getUint32(at);
      mediaStart = version
        ? safe(view.getBigInt64(at + 8))
        : view.getInt32(at + 4);
      const rateAt = at + (version ? 16 : 8);
      if (
        mediaStart < 0 ||
        !segmentDuration ||
        view.getInt32(rateAt) !== 0x10000
      )
        throw unsupported();
    }
    result.push(
      Object.freeze({
        id,
        kind,
        timescale: mdhd.timescale,
        mediaDuration: mdhd.duration,
        mediaStart,
        segmentDuration,
        movieTimescale,
      }),
    );
  }
  signal?.throwIfAborted();
  if (!result.length) throw unsupported();
  const admitted = Object.freeze(result);
  cache.set(file, admitted);
  return admitted;
}
