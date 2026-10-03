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
    const code = new URL(req.url).searchParams.get("code");
    if (!code || code.length > 1024)
      throw new Error("Invalid confirmation code.");
    const auth = await authClient();
    let recovery = false;
    const {
      data: { subscription },
    } = auth.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") recovery = true;
    });
    const exchanged = await auth.auth.exchangeCodeForSession(code);
    subscription.unsubscribe();
    if (exchanged.error || !exchanged.data.session)
      throw new Error("Invalid confirmation code.");
    const verified = await auth.auth.getUser();
    if (verified.error || !verified.data.user)
      throw new Error("Invalid session.");
    if (recovery) {
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
