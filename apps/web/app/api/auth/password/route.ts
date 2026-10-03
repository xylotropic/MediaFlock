import { z } from "zod";
import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { db } from "../../../../../../packages/db";
import { authClient, sameOrigin } from "../../../../../../packages/domain/auth";
import {
  DomainError,
  publicError,
  requireCondition,
} from "../../../../../../packages/domain/errors";
import {
  passwordInput,
  recoveryCookie,
  registrationBody,
  registrationRateLimit,
  validRecoveryGrant,
} from "../../../../../../packages/domain/registration";
import {
  beginAccountSecurityReset,
  finishAccountSecurityReset,
  lockAccountSecurity,
  validateHumanSession,
  verifiedSessionId,
} from "../../../../../../packages/domain/session-security";

export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const input = await registrationBody(
      req,
      z.object({ password: passwordInput }).strict(),
    );
    const auth = await authClient();
    const verified = await auth.auth.getUser();
    requireCondition(
      verified.data.user && !verified.error,
      "authentication_required",
      "Open a fresh password reset link to continue.",
      401,
    );
    const jar = await cookies();
    requireCondition(
      validRecoveryGrant(
        jar.get(recoveryCookie)?.value || "",
        verified.data.user.id,
      ),
      "recovery_required",
      "Open a fresh password reset link to continue.",
      403,
    );
    await registrationRateLimit(
      req,
      verified.data.user.email,
      "password_reset",
    );
    const current = await auth.auth.getSession();
    requireCondition(
      !current.error,
      "authentication_required",
      "Open a fresh password reset link to continue.",
      401,
    );
    const sessionId = verifiedSessionId(
      current.data.session?.access_token,
      verified.data.user.id,
    );
    const attemptId = randomUUID();
    const tx = await db().connect();
    try {
      await tx.query("begin");
      await lockAccountSecurity(tx, verified.data.user.id, true);
      await validateHumanSession(tx, verified.data.user.id, sessionId);
      await beginAccountSecurityReset(tx, verified.data.user.id, attemptId);
      await tx.query("commit");
    } catch (error) {
      await tx.query("rollback");
      throw error;
    } finally {
      tx.release();
    }
    jar.set(recoveryCookie, "", {
      httpOnly: true,
      path: "/api/auth",
      maxAge: 0,
    });
    let outcome: "success" | "rejected" | "uncertain" = "uncertain";
    try {
      const result = await auth.auth.updateUser({ password: input.password });
      if (!result.error) outcome = "success";
      else if (
        result.error.status &&
        result.error.status >= 400 &&
        result.error.status < 500 &&
        result.error.status !== 408
      )
        outcome = "rejected";
    } catch {
      outcome = "uncertain";
    }
    if (outcome === "success") await auth.auth.signOut({ scope: "global" });
    const final = await db().connect();
    try {
      await final.query("begin");
      await finishAccountSecurityReset(
        final,
        verified.data.user.id,
        attemptId,
        outcome,
      );
      await final.query("commit");
    } catch (error) {
      await final.query("rollback");
      throw error;
    } finally {
      final.release();
    }
    requireCondition(
      outcome === "success",
      outcome === "uncertain"
        ? "recovery_unresolved"
        : "password_update_failed",
      outcome === "uncertain"
        ? "The password reset result could not be confirmed. Account access remains paused until it is checked."
        : "The password could not be changed. Sign in again before requesting a fresh reset link.",
      outcome === "uncertain" ? 503 : 400,
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
