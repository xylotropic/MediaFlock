import { EncodedPacketSink, type InputAudioTrack } from "mediabunny";
import { admitMp4Presentation } from "./container-clock";

export interface AdmittedAacClock {
  rate: number;
  channels: number;
  firstNativeFrame: number;
  endNativeFrame: number;
  packetCount: number;
}
const admitted = new WeakMap<File, Map<string, Readonly<AdmittedAacClock>>>();
const timingError = () =>
  new Error(
    "This video's audio timing is not supported yet. Convert a separate local copy with continuous audio, then import that copy.",
  );

/** AAC-LC's ordinary 1024-sample clock is the currently qualified profile.
 * Container gaps and stretched packets cannot be silently treated as dense
 * audio: some native decoders reconstruct timestamps from decoded counts. */
export async function admitLocalAacClock(
  track: InputAudioTrack,
  file: File,
  signal?: AbortSignal,
): Promise<Readonly<AdmittedAacClock>> {
  signal?.throwIfAborted();
  const rate = await track.getSampleRate(),
    channels = await track.getNumberOfChannels();
  const config = await track.getDecoderConfig();
  if (
    !config ||
    config.codec !== "mp4a.40.2" ||
    ![44100, 48000].includes(rate) ||
    ![1, 2].includes(channels) ||
    !config.description
  )
    throw new Error(
      "This editor currently supports mono or stereo AAC-LC sound at 44.1 or 48 kHz. Convert a separate copy locally for other audio profiles.",
    );
  const bytes = ArrayBuffer.isView(config.description)
    ? new Uint8Array(
        config.description.buffer,
        config.description.byteOffset,
        config.description.byteLength,
      )
    : new Uint8Array(config.description);
  let bit = 0;
  const take = (count: number) => {
    if (bit + count > bytes.byteLength * 8)
      throw new Error("The AAC audio description is incomplete.");
    let result = 0;
    for (let n = 0; n < count; n++, bit++)
      result =
        result * 2 + ((bytes[Math.floor(bit / 8)] >> (7 - (bit % 8))) & 1);
    return result;
  };
  const objectType = take(5),
    frequency = take(4);
  const declaredRate =
    frequency === 15
      ? take(24)
      : [
          96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000,
          11025, 8000, 7350,
        ][frequency];
  const declaredChannels = take(4),
    shortFrame = take(1),
    dependsOnCore = take(1),
    extensionFlag = take(1);
  if (
    objectType !== 2 ||
    shortFrame ||
    dependsOnCore ||
    extensionFlag ||
    declaredRate !== rate ||
    declaredChannels !== channels
  )
    throw new Error(
      "This AAC frame profile is not supported yet. Convert a separate local copy before importing it.",
    );
  // FFmpeg commonly includes a backward-compatible sync extension declaring
  // SBR absent. Admit that explicit absence, never an SBR/PS audio profile.
  if (bytes.byteLength * 8 - bit >= 16) {
    if (take(11) !== 0x2b7 || take(5) !== 5 || take(1) !== 0)
      throw new Error("The AAC extension profile is unsupported.");
  }
  while (bit < bytes.byteLength * 8)
    if (take(1)) throw new Error("The AAC extension profile is unsupported.");
  const presentations = await admitMp4Presentation(file, signal);
  const presentation = presentations.find(
    (p) => p.id === track.id && p.kind === "soun",
  );
  if (!presentation || presentation.timescale !== rate) throw timingError();
  const fingerprint = `aac-clock-v2:${track.id}:${rate}:${channels}:${Array.from(bytes).join(",")}`;
  const cached = admitted.get(file)?.get(fingerprint);
  if (cached) {
    signal?.throwIfAborted();
    return cached;
  }
  const resolution = await track.getTimeResolution();
  if (!Number.isFinite(resolution) || resolution <= 0) throw timingError();
  // Admit exact native-sample clocks. Coarse timestamps could give a seek
  // a different rounded source origin even without an obvious large gap.
  const nativeIndex = (seconds: number) => {
    const value = seconds * rate,
      rounded = Math.round(value);
    if (
      !Number.isSafeInteger(rounded) ||
      rounded < -65_536 ||
      rounded > 5400 * rate + 65_536 ||
      Math.abs(value - rounded) >
        Math.max(1e-6, Math.abs(value) * Number.EPSILON * 8)
    )
      throw timingError();
    return rounded;
  };
  let first: number | undefined,
    previousDuration: number | undefined,
    count = 0;
  for await (const packet of new EncodedPacketSink(track).packets(
    undefined,
    undefined,
    { metadataOnly: true },
  )) {
    signal?.throwIfAborted();
    if (
      !Number.isFinite(packet.timestamp) ||
      !Number.isFinite(packet.duration) ||
      packet.duration <= 0 ||
      (previousDuration !== undefined && previousDuration !== 1024)
    )
      throw timingError();
    const start = nativeIndex(packet.timestamp),
      duration = nativeIndex(packet.duration);
    if (duration < 1) throw timingError();
    first ??= start;
    if (start !== first + count * 1024) throw timingError();
    previousDuration = duration;
    count++;
    if (count % 2048 === 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      signal?.throwIfAborted();
    }
    if (count > (5400 * rate) / 1024 + 64) throw timingError();
  }
  signal?.throwIfAborted();
  if (!count || previousDuration === undefined || previousDuration > 1024)
    throw timingError();
  const end = first! + (count - 1) * 1024 + previousDuration;
  // Leading empty edits and arbitrary segment trims are not yet qualified.
  // The single edit may remove AAC priming, but must retain its declared end.
  if (
    first! > 0 ||
    first! < -2048 ||
    end < 1 ||
    end !== presentation.mediaDuration - presentation.mediaStart ||
    (presentation.segmentDuration !== null &&
      BigInt(presentation.segmentDuration) * BigInt(rate) !==
        BigInt(end) * BigInt(presentation.movieTimescale))
  )
    throw timingError();
  const value = Object.freeze({
    rate,
    channels,
    firstNativeFrame: first!,
    endNativeFrame: end,
    packetCount: count,
  });
  let entries = admitted.get(file);
  if (!entries) {
    entries = new Map();
    admitted.set(file, entries);
  }
  entries.set(fingerprint, value);
  return value;
}
