import { createHash } from "node:crypto";
import { z } from "zod";
import { db, scoped, one, audit, type Context } from "../db";
import { credentialOwner, decryptCredential } from "../domain/integrations";
import { DomainError, requireCondition } from "../domain/errors";
import { getConfig } from "../domain/config";
import { recordingDuration } from "./audio";
const DAILY_REQUESTS = 10;
async function providerJson(response: Response) {
  const reader = response.body?.getReader();
  requireCondition(
    reader,
    "voice_provider_response",
    "ElevenLabs returned an incomplete result.",
    502,
  );
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.length;
      if (total > 128000) {
        await reader.cancel();
        throw new DomainError(
          "voice_provider_response",
          "ElevenLabs returned a result that is too large.",
          502,
        );
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new DomainError(
      "voice_provider_response",
      "ElevenLabs returned an unsupported result.",
      502,
    );
  }
}
const loadConnection = (ctx: Context) =>
  scoped(ctx, (tx) =>
    one(
      tx,
      "select * from integration_secrets where workspace_id=$1 and service='elevenlabs'",
      [ctx.workspaceId],
    ),
  );
export async function voiceStatus(ctx: Context) {
  credentialOwner(ctx);
  return scoped(ctx, async (tx) => ({
    unresolved: await one(
      tx,
      "select id,state,created_at from voice_requests where workspace_id=$1 and state in ('dispatched','unknown') order by created_at desc limit 1",
      [ctx.workspaceId],
    ),
    dailyRequests: Number(
      (await one(
        tx,
        "select count(*)::int as n from voice_requests where workspace_id=$1 and created_at >= date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'",
        [ctx.workspaceId],
      ))!.n,
    ),
    dailyLimit: DAILY_REQUESTS,
  }));
}
export async function checkVoiceAccount(
  ctx: Context,
  transport: typeof fetch = fetch,
) {
  credentialOwner(ctx);
  const row = await loadConnection(ctx);
  requireCondition(
    getConfig().mode === "live" && row?.ciphertext,
    "voice_connection",
    "Connect ElevenLabs in a live workspace first.",
    409,
  );
  let status = "configured",
    message =
      "Account check could not be completed. The key is still configured.";
  try {
    const response = await transport("https://api.elevenlabs.io/v1/user", {
      headers: { "xi-api-key": decryptCredential(row) },
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
    const body = await providerJson(response);
    if (response.ok && typeof body.user_id === "string") {
      status = "account_verified";
      message =
        "ElevenLabs account verified. Transcription access is verified by a successful recording.";
    } else if (body?.detail?.status === "missing_permissions")
      message =
        "The key cannot read this account. Enable User read permission to verify its identity and included credits.";
    else if (body?.detail?.status === "invalid_api_key") {
      status = "unavailable";
      message = "ElevenLabs did not accept this key.";
    }
  } catch {
    /* Credentials, provider body and transcripts never enter logs. */
  }
  return scoped(ctx, async (tx) => {
    const updated = await one(
      tx,
      "update integration_secrets set status=$1,last_checked_at=now() where workspace_id=$2 and service='elevenlabs' and generation=$3 returning id",
      [status, ctx.workspaceId, row.generation],
    );
    requireCondition(
      updated,
      "voice_connection_changed",
      "The ElevenLabs connection changed. Check the current key again.",
      409,
    );
    await audit(tx, ctx, "voice.account_checked", "integration", updated.id, {
      status,
    });
    return { status, message };
  });
}
export async function acknowledgeVoice(ctx: Context, requestId: string) {
  credentialOwner(ctx);
  return scoped(ctx, async (tx) => {
    await tx.query("select id from workspaces where id=$1 for update", [
      ctx.workspaceId,
    ]);
    const row = await one(
      tx,
      "update voice_requests set state='acknowledged',finished_at=now() where workspace_id=$1 and id=$2 and state in ('unknown','dispatched') and created_at < now()-interval '100 seconds' returning id",
      [ctx.workspaceId, requestId],
    );
    requireCondition(
      row,
      "voice_pending",
      "Wait for the current request to finish before acknowledging an unknown result.",
      409,
    );
    await audit(
      tx,
      ctx,
      "voice.unknown_acknowledged",
      "voice_request",
      requestId,
    );
    return { acknowledged: true };
  });
}
export async function transcribeRecording(
  ctx: Context,
  bytes: Uint8Array,
  requestId: string,
  transport: typeof fetch = fetch,
) {
  credentialOwner(ctx);
  z.uuid().parse(requestId);
  requireCondition(
    getConfig().mode === "live",
    "voice_live_only",
    "ElevenLabs transcription is disabled in the local demo.",
    403,
  );
  let seconds: number;
  try {
    seconds = recordingDuration(bytes);
  } catch (e) {
    throw new DomainError(
      "voice_recording",
      e instanceof Error ? e.message : "Unsupported recording.",
      400,
    );
  }
  // This read-only billing check precedes admission and is fenced against a
  // rotated key before any transcription is dispatched. No paid fallback.
  const snapshot = await loadConnection(ctx);
  requireCondition(
    snapshot?.enabled && snapshot.ciphertext,
    "voice_connection",
    "Connect ElevenLabs first.",
    409,
  );
  const accountResponse = await transport("https://api.elevenlabs.io/v1/user", {
    headers: { "xi-api-key": decryptCredential(snapshot) },
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  requireCondition(
    accountResponse.ok,
    "voice_account_check",
    "Enable User read permission so MediaFlock can verify included credits before transcribing.",
    409,
  );
  const account = await providerJson(accountResponse),
    allowance = account?.subscription;
  requireCondition(
    allowance &&
      allowance.can_extend_character_limit === false &&
      allowance.allowed_to_extend_character_limit === false &&
      Number.isFinite(allowance.character_limit) &&
      Number.isFinite(allowance.character_count) &&
      allowance.character_limit - allowance.character_count >= 10000,
    "voice_included_credits",
    "Transcription needs at least 10,000 included credits remaining and credit extensions disabled. No recording was sent.",
    409,
  );
  requireCondition(
    typeof account.user_id === "string" &&
      (!snapshot.config.providerUserId ||
        snapshot.config.providerUserId === account.user_id),
    "voice_account_changed",
    "Verify the intended ElevenLabs account in Connections first.",
    409,
  );
  const hash = createHash("sha256").update(bytes).digest("hex");
  const connection = await scoped(ctx, async (tx) => {
    await tx.query("select id from workspaces where id=$1 for update", [
      ctx.workspaceId,
    ]);
    const row = await one(
      tx,
      "select * from integration_secrets where workspace_id=$1 and service='elevenlabs' for update",
      [ctx.workspaceId],
    );
    requireCondition(
      row?.enabled && row.ciphertext && row.config.includedCreditsOnly === true,
      "voice_connection",
      "Connect an ElevenLabs transcription key in Connections first.",
      409,
    );
    requireCondition(
      String(row.generation) === String(snapshot.generation),
      "voice_connection_changed",
      "The ElevenLabs connection changed before dispatch. No recording was sent.",
      409,
    );
    const previous = await one(
      tx,
      "select id from voice_requests where workspace_id=$1 and id=$2",
      [ctx.workspaceId, requestId],
    );
    requireCondition(
      !previous,
      "voice_replay",
      "This recording was already submitted. No duplicate transcription was sent.",
      409,
    );
    const active = await one(
      tx,
      "select id from voice_requests where workspace_id=$1 and state in ('dispatched','unknown')",
      [ctx.workspaceId],
    );
    requireCondition(
      !active,
      "voice_pending",
      "A previous transcription is still pending or its result is unknown. Review it in ElevenLabs before starting another.",
      409,
    );
    const count = await one(
      tx,
      "select count(*)::int as n from voice_requests where workspace_id=$1 and created_at >= date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'",
      [ctx.workspaceId],
    );
    requireCondition(
      count!.n < DAILY_REQUESTS,
      "voice_allowance",
      "The daily transcription request allowance has been reached.",
      429,
    );
    await tx.query(
      "insert into voice_requests(id,workspace_id,user_id,connection_generation,audio_hash,duration_seconds,state) values($1,$2,$3,$4,$5,$6,'dispatched')",
      [requestId, ctx.workspaceId, ctx.userId, row.generation, hash, seconds],
    );
    await audit(
      tx,
      ctx,
      "voice.dispatch_authorized",
      "voice_request",
      requestId,
      { seconds, generation: row.generation },
    );
    return row;
  });
  let received = false;
  try {
    const body = new FormData();
    body.set("model_id", "scribe_v2");
    body.set(
      "file",
      new Blob([new Uint8Array(bytes)], { type: "audio/wav" }),
      "idea.wav",
    );
    body.set("diarize", "false");
    body.set("tag_audio_events", "false");
    body.set("webhook", "false");
    body.set("timestamps_granularity", "none");
    body.set("use_multi_channel", "false");
    const response = await transport(
      "https://api.elevenlabs.io/v1/speech-to-text",
      {
        method: "POST",
        headers: { "xi-api-key": decryptCredential(connection) },
        body,
        redirect: "error",
        signal: AbortSignal.timeout(60000),
      },
    );
    received =
      response.status >= 400 &&
      response.status < 500 &&
      response.status !== 408;
    requireCondition(
      response.ok,
      "voice_provider",
      response.status === 401 || response.status === 403
        ? "ElevenLabs requires Speech to Text permission for this key."
        : response.status === 429
          ? "ElevenLabs has reached an account or rate limit. No automatic retry was sent."
          : "ElevenLabs could not transcribe this recording. No automatic retry was sent.",
      502,
    );
    const result = z
      .object({ text: z.string().trim().min(1).max(10000) })
      .parse(await providerJson(response));
    received = true;
    return await scoped(ctx, async (tx) => {
      const row = await one(
        tx,
        "select id,generation,enabled from integration_secrets where workspace_id=$1 and service='elevenlabs' for update",
        [ctx.workspaceId],
      );
      requireCondition(
        row?.enabled &&
          String(row.generation) === String(connection.generation),
        "voice_connection_changed",
        "The ElevenLabs connection changed during transcription. The result was discarded.",
        409,
      );
      await tx.query(
        "update voice_requests set state='complete',finished_at=now() where workspace_id=$1 and id=$2 and state='dispatched'",
        [ctx.workspaceId, requestId],
      );
      await tx.query(
        "update integration_secrets set status='transcription_verified',last_checked_at=now() where id=$1",
        [row.id],
      );
      return { text: result.text, provider: "elevenlabs", requestId };
    });
  } catch (error) {
    // Settle only this server-created reservation. No audio or transcript is saved.
    await db().query(
      "update voice_requests set state=$1,finished_at=now() where workspace_id=$2 and id=$3 and state='dispatched'",
      [received ? "failed" : "unknown", ctx.workspaceId, requestId],
    );
    if (error instanceof DomainError) throw error;
    throw new DomainError(
      "voice_result_unknown",
      "Transcription could not be confirmed. Your recording is still here. Check ElevenLabs before sending another recording.",
      502,
    );
  }
}
