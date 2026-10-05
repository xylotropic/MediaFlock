import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { db, closeDb, scoped } from "../packages/db";
import {
  encodeRecording,
  recordingDuration,
  MAX_RECORDING_BYTES,
} from "../packages/voice/audio";
import {
  transcribeRecording,
  checkVoiceAccount,
  voiceStatus,
} from "../packages/voice";
import {
  saveIntegration,
  removeIntegration,
} from "../packages/domain/integrations";
import { fixture } from "./helpers";
const sample = () => encodeRecording(new Float32Array(16000).fill(0.01));
const response = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const account = () =>
  response({
    user_id: "fixture-elevenlabs-account",
    subscription: {
      can_extend_character_limit: false,
      allowed_to_extend_character_limit: false,
      character_limit: 100000,
      character_count: 0,
    },
  });
let owner: Awaited<ReturnType<typeof fixture>>,
  other: Awaited<ReturnType<typeof fixture>>;
let mode: string | undefined, vault: string | undefined;
beforeAll(async () => {
  owner = await fixture("voice-owner");
  other = await fixture("voice-other");
  mode = process.env.MEDIAFLOCK_MODE;
  vault = process.env.CREDENTIAL_ENCRYPTION_KEY;
  await db().query("update workspaces set mode='live' where id=any($1)", [
    [owner.ctx.workspaceId, other.ctx.workspaceId],
  ]);
  process.env.MEDIAFLOCK_MODE = "live";
  process.env.CREDENTIAL_ENCRYPTION_KEY = Buffer.alloc(32, 71).toString(
    "base64",
  );
  await connect();
});
afterAll(async () => {
  if (owner && other)
    await db().query("update workspaces set mode='demo' where id=any($1)", [
      [owner.ctx.workspaceId, other.ctx.workspaceId],
    ]);
  process.env.MEDIAFLOCK_MODE = mode;
  process.env.CREDENTIAL_ENCRYPTION_KEY = vault;
  await closeDb();
});
const connect = () =>
  saveIntegration(owner.ctx, "elevenlabs", {
    apiKey: "fixture-key-no-real-provider",
    enabled: true,
    config: { includedCreditsOnly: true },
  });
const clearPending = () =>
  db().query(
    "update voice_requests set state='acknowledged',finished_at=now() where workspace_id=$1 and state in ('unknown','dispatched')",
    [owner.ctx.workspaceId],
  );
describe("bounded recording", () => {
  it("derives real duration from validated samples", () =>
    expect(recordingDuration(sample())).toBe(1));
  it("rejects forged duration, stereo, truncated and excessive input", () => {
    const forged = sample();
    new DataView(forged.buffer).setUint32(24, 1, true);
    expect(() => recordingDuration(forged)).toThrow();
    const stereo = sample();
    new DataView(stereo.buffer).setUint16(22, 2, true);
    expect(() => recordingDuration(stereo)).toThrow();
    expect(() => recordingDuration(sample().slice(0, -2))).toThrow();
    expect(() =>
      recordingDuration(new Uint8Array(MAX_RECORDING_BYTES + 1)),
    ).toThrow();
  });
});
describe("voice request isolation", () => {
  it("denies machine tokens and other workspaces before network", async () => {
    let calls = 0;
    const transport: typeof fetch = async () => {
      calls++;
      return account();
    };
    await expect(
      transcribeRecording(
        { ...owner.ctx, kind: "token" },
        sample(),
        randomUUID(),
        transport,
      ),
    ).rejects.toMatchObject({ code: "credential_owner_required" });
    await expect(
      transcribeRecording(other.ctx, sample(), randomUUID(), transport),
    ).rejects.toMatchObject({ code: "voice_connection" });
    expect(calls).toBe(0);
  });
  it("denies disabled extensions/insufficient credits without sending audio", async () => {
    let posts = 0;
    const transport: typeof fetch = async (_url, init) => {
      if (init?.method === "POST") posts++;
      return response({
        user_id: "fixture",
        subscription: {
          can_extend_character_limit: true,
          allowed_to_extend_character_limit: true,
          character_limit: 100000,
          character_count: 0,
        },
      });
    };
    await expect(
      transcribeRecording(owner.ctx, sample(), randomUUID(), transport),
    ).rejects.toMatchObject({ code: "voice_included_credits" });
    expect(posts).toBe(0);
  });
  it("submits one bounded request, preserves approval gates and denies replay", async () => {
    let posts = 0;
    const requestId = randomUUID();
    const transport: typeof fetch = async (url, init) => {
      if (String(url).endsWith("/user")) return account();
      posts++;
      expect((init?.body as FormData).get("model_id")).toBe("scribe_v2");
      expect((init?.body as FormData).get("webhook")).toBe("false");
      return response({ text: "An idea ready for review." });
    };
    const result = await transcribeRecording(
      owner.ctx,
      sample(),
      requestId,
      transport,
    );
    expect(result.text).toBe("An idea ready for review.");
    await expect(
      transcribeRecording(owner.ctx, sample(), requestId, transport),
    ).rejects.toMatchObject({ code: "voice_replay" });
    expect(posts).toBe(1);
    expect(
      (
        await db().query(
          "select count(*)::int n from publish_jobs where workspace_id=$1",
          [owner.ctx.workspaceId],
        )
      ).rows[0].n,
    ).toBe(0);
  });
  it("fences a rotated credential between billing check and dispatch", async () => {
    let posts = 0;
    const transport: typeof fetch = async (_url, init) => {
      if (init?.method === "POST") {
        posts++;
        return response({ text: "Should never appear" });
      }
      await connect();
      return account();
    };
    await expect(
      transcribeRecording(owner.ctx, sample(), randomUUID(), transport),
    ).rejects.toMatchObject({ code: "voice_connection_changed" });
    expect(posts).toBe(0);
  });
  it("allows only one in-flight request across concurrent callers", async () => {
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => (release = resolve));
    let posts = 0;
    const transport: typeof fetch = async (url) => {
      if (String(url).endsWith("/user")) return account();
      posts++;
      await waiting;
      return response({ text: "Concurrent idea" });
    };
    const first = transcribeRecording(
      owner.ctx,
      sample(),
      randomUUID(),
      transport,
    );
    while (!posts) await new Promise((resolve) => setTimeout(resolve, 5));
    await expect(
      transcribeRecording(owner.ctx, sample(), randomUUID(), transport),
    ).rejects.toMatchObject({ code: "voice_pending" });
    release();
    await first;
    expect(posts).toBe(1);
  });
  it("discards results after disconnect, including reconnect with the same key", async () => {
    const transport: typeof fetch = async (url) => {
      if (String(url).endsWith("/user")) return account();
      await removeIntegration(owner.ctx, "elevenlabs");
      await connect();
      return response({ text: "Stale idea" });
    };
    await expect(
      transcribeRecording(owner.ctx, sample(), randomUUID(), transport),
    ).rejects.toMatchObject({ code: "voice_connection_changed" });
  });
  it("blocks uncertain outcomes without retry or lease expiry", async () => {
    let posts = 0;
    const transport: typeof fetch = async (url) => {
      if (String(url).endsWith("/user")) return account();
      posts++;
      throw Error("fixture network uncertainty");
    };
    await expect(
      transcribeRecording(owner.ctx, sample(), randomUUID(), transport),
    ).rejects.toMatchObject({ code: "voice_result_unknown" });
    await expect(
      transcribeRecording(owner.ctx, sample(), randomUUID(), transport),
    ).rejects.toMatchObject({ code: "voice_pending" });
    expect(posts).toBe(1);
    expect((await voiceStatus(owner.ctx)).unresolved!.state).toBe("unknown");
    await clearPending();
  });
  it("keeps malformed successful provider results uncertain", async () => {
    const transport: typeof fetch = async (url) =>
      String(url).endsWith("/user") ? account() : response({ text: 42 });
    await expect(
      transcribeRecording(owner.ctx, sample(), randomUUID(), transport),
    ).rejects.toMatchObject({ code: "voice_result_unknown" });
    expect((await voiceStatus(owner.ctx)).unresolved!.state).toBe("unknown");
    await clearPending();
  });
  it("rejects stale account verification after key rotation", async () => {
    const transport: typeof fetch = async () => {
      await connect();
      return account();
    };
    await expect(checkVoiceAccount(owner.ctx, transport)).rejects.toMatchObject(
      { code: "voice_connection_changed" },
    );
  });
  it("does not mistake missing User read scope for an invalid transcription key", async () => {
    const result = await checkVoiceAccount(owner.ctx, async () =>
      response({ detail: { status: "missing_permissions" } }, 401),
    );
    expect(result.status).toBe("configured");
  });
  it("counts all attempts toward the allowance and honors workspace RLS", async () => {
    await db().query(
      "insert into voice_requests(id,workspace_id,user_id,connection_generation,audio_hash,duration_seconds,state) select gen_random_uuid(),$1,$2,0,'fixture',1,'failed' from generate_series(1,10)",
      [owner.ctx.workspaceId, owner.ctx.userId],
    );
    let posts = 0;
    await expect(
      transcribeRecording(owner.ctx, sample(), randomUUID(), async (url) => {
        if (String(url).endsWith("/user")) return account();
        posts++;
        return response({ text: "Not admitted" });
      }),
    ).rejects.toMatchObject({ code: "voice_allowance" });
    expect(posts).toBe(0);
    expect(
      await scoped(
        other.ctx,
        async (tx) =>
          (
            await tx.query(
              "select id from voice_requests where workspace_id=$1",
              [owner.ctx.workspaceId],
            )
          ).rows,
      ),
    ).toEqual([]);
  });
});
