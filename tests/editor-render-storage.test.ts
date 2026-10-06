import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { newEditorProject } from "../packages/editor/project";

const injected = vi.hoisted(() => ({
  fault: "output",
  cancel: vi.fn(async () => undefined),
}));
vi.mock("@mediabunny/aac-encoder", () => ({ registerAacEncoder: vi.fn() }));
vi.mock("../packages/editor/audio", () => ({
  PCM_BLOCK_FRAMES: 16_384,
  preparePcm: vi.fn(async () => ({ file: null, frames: 48_000, bytes: 0 })),
  readPcm: vi.fn(),
}));
vi.mock("mediabunny", () => {
  class StreamTarget {
    constructor(readonly stream: WritableStream) {
      if (injected.fault === "stream")
        throw new Error("Injected stream setup failure.");
    }
  }
  class Output {
    private target: StreamTarget;
    constructor(options: { target: StreamTarget }) {
      if (injected.fault === "output")
        throw new Error("Injected output setup failure.");
      this.target = options.target;
    }
    addVideoTrack() {}
    addAudioTrack() {}
    cancel = injected.cancel;
    async start() {
      const writer = this.target.stream.getWriter();
      await writer.write({
        type: "write",
        position: injected.fault === "offset" ? 10 ** 12 : 0,
        data: new Uint8Array(
          injected.fault === "chunk" ? 4 * 1024 ** 2 + 1 : 1,
        ),
      });
    }
  }
  class CanvasSource {
    constructor() {
      if (injected.fault === "canvas")
        throw new Error("Injected canvas setup failure.");
    }
  }
  class Stub {}
  return {
    StreamTarget,
    Output,
    CanvasSource,
    AudioSample: Stub,
    AudioSampleSource: Stub,
    BlobSource: Stub,
    EncodedPacketSink: Stub,
    Input: Stub,
    Mp4OutputFormat: Stub,
    VideoSampleSink: Stub,
    MP4: {},
    canEncodeVideo: async () => true,
  };
});
import { renderLocalProject } from "../packages/editor/render";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
async function render(fault: string, abort: () => Promise<void>) {
  injected.fault = fault;
  vi.stubGlobal(
    "OffscreenCanvas",
    class {
      getContext() {
        return {};
      }
    },
  );
  const project = newEditorProject(randomUUID(), "Writer failure fixture");
  project.output = { ...project.output, width: 1920, height: 1080 };
  const sourceId = randomUUID(),
    file = new File(["abc"], "fixture.mp4");
  project.sources.push({
    id: sourceId,
    name: file.name,
    bytes: file.size,
    sha256: "a".repeat(64),
    durationUs: 1_000_000,
    width: 640,
    height: 360,
    hasAudio: false,
    rotation: "0",
  });
  project.clips.push({
    id: randomUUID(),
    sourceId,
    inUs: 0,
    outUs: 1_000_000,
    muted: true,
    effects: { brightness: 1, contrast: 1, saturation: 1, look: "original" },
  });
  const write = vi.fn(),
    close = vi.fn();
  const directory = {
    getFileHandle: async () => ({
      createWritable: async () => ({ write, close, abort }),
    }),
  } as unknown as FileSystemDirectoryHandle;
  return {
    write,
    close,
    pending: renderLocalProject(
      project,
      new Map([[sourceId, file]]),
      directory,
      new AbortController().signal,
      () => undefined,
    ),
  };
}
it.each(["stream", "output", "canvas"])(
  "aborts an opened writer when %s setup fails",
  async (fault) => {
    const abort = vi.fn(async () => undefined);
    const { pending, write, close } = await render(fault, abort);
    await expect(pending).rejects.toThrow(/Injected .* setup failure/);
    expect(abort).toHaveBeenCalledTimes(1);
    expect(write).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  },
);
it.each([
  ["offset", /file-size limit/],
  ["chunk", /memory bound/],
] as const)(
  "rejects a %s write before touching disk and awaits underlying abort",
  async (fault, error) => {
    let release!: () => void;
    const aborted = new Promise<void>((resolve) => {
      release = resolve;
    });
    const abort = vi.fn(() => aborted);
    const { pending, write } = await render(fault, abort);
    let settled = false;
    const observed = pending.catch((e) => {
      settled = true;
      throw e;
    });
    const rejection = expect(observed).rejects.toThrow(error);
    await vi.waitFor(() => expect(abort).toHaveBeenCalledTimes(1));
    expect(write).not.toHaveBeenCalled();
    expect(settled).toBe(false);
    release();
    await rejection;
    expect(injected.cancel).toHaveBeenCalledTimes(1);
  },
);
