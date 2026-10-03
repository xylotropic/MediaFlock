import { z } from "zod";
import { authClient, sameOrigin } from "../../../../../../packages/domain/auth";
import { getConfig } from "../../../../../../packages/domain/config";
import {
  DomainError,
  publicError,
} from "../../../../../../packages/domain/errors";
import {
  emailInput,
  registrationBody,
  registrationRateLimit,
  requireAuthEmailEnabled,
} from "../../../../../../packages/domain/registration";

export async function POST(req: Request) {
  try {
    sameOrigin(req);
    requireAuthEmailEnabled();
    const input = await registrationBody(
      req,
      z.object({ email: emailInput }).strict(),
    );
    await registrationRateLimit(req, input.email, "email_recover");
    const { error } = await (
      await authClient()
    ).auth.resetPasswordForEmail(input.email, {
      redirectTo: getConfig().origin + "/api/auth/callback",
    });
    if (error && error.code !== "user_not_found")
      throw new DomainError(
        "recovery_unavailable",
        "Password reset email is temporarily unavailable. Try again later.",
        error.status === 429 ? 429 : 503,
      );
    return Response.json(
      { ok: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      { error: publicError(error) },
      {
        status: error instanceof DomainError ? error.status : 500,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
