import { requestContext } from "../../../../../../packages/domain/auth";
import {
  DomainError,
  publicError,
  requireCondition,
} from "../../../../../../packages/domain/errors";
import { credentialOwner } from "../../../../../../packages/domain/integrations";
import { boundedBody } from "../../../../../../packages/security";
import { transcribeRecording } from "../../../../../../packages/voice";
import { MAX_RECORDING_BYTES } from "../../../../../../packages/voice/audio";
export const runtime = "nodejs";
export const maxDuration = 90;
export async function POST(req: Request) {
  try {
    const ctx = await requestContext(req);
    credentialOwner(ctx);
    requireCondition(
      req.headers.get("content-type")?.split(";")[0] === "audio/wav",
      "voice_type",
      "Use the microphone recorder for transcription.",
      400,
    );
    const data = await transcribeRecording(
      ctx,
      await boundedBody(req, MAX_RECORDING_BYTES),
      req.headers.get("x-voice-request-id") || "",
    );
    return Response.json(
      { data },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      { error: publicError(error) },
      {
        status: error instanceof DomainError ? error.status : 400,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
