import { authClient, sameOrigin } from "../../../../../packages/domain/auth";
import { getConfig } from "../../../../../packages/domain/config";
import {
  DomainError,
  publicError,
} from "../../../../../packages/domain/errors";
import {
  checkRegistrationCapacity,
  ensureRegisteredWorkspace,
  registrationBody,
  registrationRateLimit,
  requireRegistrationEnabled,
  signupInput,
} from "../../../../../packages/domain/registration";
import { issueInitialRecoveryCode } from "../../../../../packages/domain/recovery-codes";

export async function POST(req: Request) {
  try {
    sameOrigin(req);
    requireRegistrationEnabled();
    const input = await registrationBody(req, signupInput);
    await registrationRateLimit(req, input.email);
    await checkRegistrationCapacity();
    const auth = await authClient();
    const { data, error } = await auth.auth.signUp({
      email: input.email,
      password: input.password,
      options: {
        emailRedirectTo: getConfig().origin + "/api/auth/callback",
        data: {
          full_name: input.name,
          timezone: input.timezone || "America/New_York",
        },
      },
    });
    if (error) {
      const limited =
        error.status === 429 || error.code === "over_email_send_rate_limit";
      throw new DomainError(
        limited ? "rate_limited" : "sign_up_failed",
        limited
          ? "Too many account requests. Try again later."
          : "Account creation could not be completed. Try signing in or try again later.",
        limited ? 429 : 400,
      );
    }
    if (data.session) {
      const verified = await auth.auth.getUser();
      if (verified.error || !verified.data.user)
        throw new DomainError(
          "authentication_required",
          "Sign in to open your new workspace.",
          401,
        );
      const membership = await ensureRegisteredWorkspace(verified.data.user);
      const recoveryCode = await issueInitialRecoveryCode(
        verified.data.user,
        membership.workspace_id,
      );
      return Response.json(
        {
          ok: true,
          status: "authenticated",
          ...(recoveryCode ? { recoveryCode } : {}),
        },
        { status: 201, headers: { "Cache-Control": "no-store" } },
      );
    }
    // The provider deliberately returns the same response for some existing
    // addresses. Never disclose a user identifier or create membership here.
    return Response.json(
      { ok: true, status: "confirmation_required" },
      { status: 202, headers: { "Cache-Control": "no-store" } },
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
