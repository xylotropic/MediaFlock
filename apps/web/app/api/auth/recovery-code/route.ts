import { sameOrigin } from "../../../../../../packages/domain/auth";
import {
  DomainError,
  publicError,
} from "../../../../../../packages/domain/errors";
import {
  requireRecoveryCodesEnabled,
  resetRecoveryInput,
  resetWithRecoveryCode,
} from "../../../../../../packages/domain/recovery-codes";
import {
  registrationBody,
  registrationRateLimit,
} from "../../../../../../packages/domain/registration";

export async function POST(req: Request) {
  try {
    sameOrigin(req);
    requireRecoveryCodesEnabled();
    const input = await registrationBody(req, resetRecoveryInput);
    await registrationRateLimit(req, input.email, "recovery_code");
    const result = await resetWithRecoveryCode(input);
    return Response.json(result, {
      headers: {
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      },
    });
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
