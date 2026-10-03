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
  requireRegistrationEnabled,
} from "../../../../../../packages/domain/registration";

export async function POST(req: Request) {
  try {
    sameOrigin(req);
    requireRegistrationEnabled();
    requireAuthEmailEnabled();
    const input = await registrationBody(
      req,
      z.object({ email: emailInput }).strict(),
    );
    await registrationRateLimit(req, input.email, "resend");
    const { error } = await (
      await authClient()
    ).auth.resend({
      type: "signup",
      email: input.email,
      options: { emailRedirectTo: getConfig().origin + "/api/auth/callback" },
    });
    if (error && error.code !== "user_not_found")
      throw new DomainError(
        "confirmation_unavailable",
        "Confirmation email is temporarily unavailable. Try again later.",
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
