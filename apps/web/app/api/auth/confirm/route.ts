import { cookies } from "next/headers";
import { authClient } from "../../../../../../packages/domain/auth";
import { getConfig } from "../../../../../../packages/domain/config";
import {
  ensureRegisteredWorkspace,
  authRedirect,
  recoveryCookie,
  recoveryGrant,
} from "../../../../../../packages/domain/registration";

export async function GET(req: Request) {
  const config = getConfig();
  try {
    const params = new URL(req.url).searchParams;
    const tokenHash = params.get("token_hash");
    const type = params.get("type");
    if (
      !tokenHash ||
      !/^[A-Za-z0-9_-]{20,256}$/.test(tokenHash) ||
      (type !== "email" && type !== "signup" && type !== "recovery")
    )
      throw new Error("Invalid confirmation link.");
    const auth = await authClient();
    const result = await auth.auth.verifyOtp({ token_hash: tokenHash, type });
    if (result.error || !result.data.session)
      throw new Error("Invalid confirmation link.");
    const verified = await auth.auth.getUser();
    if (verified.error || !verified.data.user)
      throw new Error("Invalid session.");
    if (type === "recovery") {
      (await cookies()).set(
        recoveryCookie,
        recoveryGrant(verified.data.user.id),
        {
          httpOnly: true,
          secure: config.secureCookies,
          sameSite: "lax",
          path: "/api/auth",
          maxAge: 900,
        },
      );
      return authRedirect("/reset-password");
    }
    await ensureRegisteredWorkspace(verified.data.user);
    return authRedirect("/app");
  } catch {
    return authRedirect("/signin?auth=confirmation_failed");
  }
}
