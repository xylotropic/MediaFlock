// The server accepts only our bounded mono PCM recording format. This avoids
// native media parsers and gives an authoritative duration from sample count.
export const RECORDING_SECONDS = 90;
export const RECORDING_RATE = 16000;
export const MAX_RECORDING_BYTES = 44 + RECORDING_SECONDS * RECORDING_RATE * 2;
const word = (view: DataView, at: number, text: string) =>
  [...text].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
export function encodeRecording(samples: Float32Array): Uint8Array {
  const frames = Math.min(samples.length, RECORDING_SECONDS * RECORDING_RATE);
  const bytes = new Uint8Array(44 + frames * 2),
    view = new DataView(bytes.buffer);
  word(view, 0, "RIFF");
  view.setUint32(4, bytes.length - 8, true);
  word(view, 8, "WAVE");
  word(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, RECORDING_RATE, true);
  view.setUint32(28, RECORDING_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  word(view, 36, "data");
  view.setUint32(40, frames * 2, true);
  for (let i = 0; i < frames; i++) {
    const v = Number.isFinite(samples[i])
      ? Math.max(-1, Math.min(1, samples[i]))
      : 0;
    view.setInt16(44 + i * 2, Math.round(v * (v < 0 ? 32768 : 32767)), true);
  }
  return bytes;
}
export function recordingDuration(bytes: Uint8Array): number {
  if (bytes.length < 44 || bytes.length > MAX_RECORDING_BYTES)
    throw Error("Record an idea between 0.1 and 90 seconds.");
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    text = (at: number) => String.fromCharCode(...bytes.slice(at, at + 4));
  if (
    text(0) !== "RIFF" ||
    text(8) !== "WAVE" ||
    text(12) !== "fmt " ||
    text(36) !== "data" ||
    v.getUint32(4, true) !== bytes.length - 8 ||
    v.getUint32(16, true) !== 16 ||
    v.getUint16(20, true) !== 1 ||
    v.getUint16(22, true) !== 1 ||
    v.getUint32(24, true) !== RECORDING_RATE ||
    v.getUint32(28, true) !== RECORDING_RATE * 2 ||
    v.getUint16(32, true) !== 2 ||
    v.getUint16(34, true) !== 16 ||
    v.getUint32(40, true) !== bytes.length - 44 ||
    (bytes.length - 44) % 2
  )
    throw Error("Use the microphone recorder to create a supported recording.");
  const seconds = (bytes.length - 44) / (RECORDING_RATE * 2);
  if (seconds < 0.1 || seconds > RECORDING_SECONDS)
    throw Error("Record an idea between 0.1 and 90 seconds.");
  return seconds;
}
