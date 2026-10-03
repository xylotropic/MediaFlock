import {
  authClient,
  requestContext,
  sameOrigin,
} from "../../../../../../../packages/domain/auth";
import {
  DomainError,
  publicError,
  requireCondition,
} from "../../../../../../../packages/domain/errors";
import {
  generateRecoveryInput,
  requireRecoveryCodesEnabled,
  rotateRecoveryCode,
} from "../../../../../../../packages/domain/recovery-codes";
import {
  registrationBody,
  registrationRateLimit,
} from "../../../../../../../packages/domain/registration";

export async function POST(req: Request) {
  try {
    sameOrigin(req);
    requireRecoveryCodesEnabled();
    const input = await registrationBody(req, generateRecoveryInput);
    const ctx = await requestContext(req);
    const verified = await (await authClient()).auth.getUser();
    requireCondition(
      !verified.error &&
        verified.data.user &&
        verified.data.user.id === ctx.userId,
      "authentication_required",
      "Sign in to create a recovery code.",
      401,
    );
    await registrationRateLimit(
      req,
      verified.data.user.email,
      "recovery_generate",
    );
    const recoveryCode = await rotateRecoveryCode(
      ctx,
      verified.data.user,
      input.currentPassword,
    );
    return Response.json(
      { ok: true, recoveryCode },
      {
        headers: {
          "Cache-Control": "no-store",
          "Referrer-Policy": "no-referrer",
        },
      },
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
