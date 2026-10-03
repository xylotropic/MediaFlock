import { beforeEach, describe, expect, it, vi } from "vitest";
const spies = vi.hoisted(() => ({
  exchange: vi.fn(),
  getUser: vi.fn(),
  verifyOtp: vi.fn(),
  ensureWorkspace: vi.fn(),
  updateUser: vi.fn(),
  signOut: vi.fn(),
  cookieGet: vi.fn(),
  cookieSet: vi.fn(),
  rateLimit: vi.fn(),
  recovery: false,
  getSession: vi.fn(),
  securityBegin: vi.fn(),
  securityFinish: vi.fn(),
  transaction: { query: vi.fn(), release: vi.fn() },
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: spies.cookieGet, set: spies.cookieSet }),
}));
vi.mock("../packages/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../packages/db")>()),
  db: () => ({ connect: async () => spies.transaction }),
}));
vi.mock("../packages/domain/session-security", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../packages/domain/session-security")
  >()),
  beginAccountSecurityReset: spies.securityBegin,
  finishAccountSecurityReset: spies.securityFinish,
  lockAccountSecurity: async () => undefined,
  validateHumanSession: async () => undefined,
}));
vi.mock("../packages/domain/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../packages/domain/auth")>()),
  authClient: async () => ({
    auth: {
      exchangeCodeForSession: spies.exchange,
      getUser: spies.getUser,
      getSession: spies.getSession,
      verifyOtp: spies.verifyOtp,
      updateUser: spies.updateUser,
      signOut: spies.signOut,
      onAuthStateChange: (callback: (event: string) => void) => {
        spies.exchange.mockImplementation(async () => {
          callback(spies.recovery ? "PASSWORD_RECOVERY" : "SIGNED_IN");
          return { data: { session: {} }, error: null };
        });
        return { data: { subscription: { unsubscribe: () => undefined } } };
      },
    },
  }),
}));
vi.mock("../packages/domain/registration", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../packages/domain/registration")>()),
  ensureRegisteredWorkspace: spies.ensureWorkspace,
  registrationRateLimit: spies.rateLimit,
}));
import { GET as callback } from "../apps/web/app/api/auth/callback/route";
import { GET as confirm } from "../apps/web/app/api/auth/confirm/route";
import { POST as password } from "../apps/web/app/api/auth/password/route";
import { getConfig } from "../packages/domain/config";
import { recoveryCookie, recoveryGrant } from "../packages/domain/registration";

const user = {
  id: "ef0979ac-15ae-446c-ae5b-f2d893b1f235",
  email: "isolated@example.com",
};
beforeEach(() => {
  vi.clearAllMocks();
  spies.recovery = false;
  spies.getUser.mockResolvedValue({ data: { user }, error: null });
  spies.verifyOtp.mockResolvedValue({ data: { session: {} }, error: null });
  spies.updateUser.mockResolvedValue({ data: { user }, error: null });
  spies.signOut.mockResolvedValue({ error: null });
  spies.ensureWorkspace.mockResolvedValue({
    workspace_id: "private-workspace",
  });
  spies.rateLimit.mockResolvedValue(undefined);
  spies.cookieGet.mockReturnValue(undefined);
  spies.transaction.query.mockResolvedValue({ rows: [] });
  spies.securityBegin.mockResolvedValue("2026-01-01T00:00:00Z");
  spies.securityFinish.mockResolvedValue(undefined);
  const payload = Buffer.from(
    JSON.stringify({
      sub: user.id,
      session_id: "774d01ca-01cc-4ea2-bce1-9d1b24124974",
    }),
  ).toString("base64url");
  spies.getSession.mockResolvedValue({
    data: { session: { access_token: `header.${payload}.signature` } },
    error: null,
  });
});

describe("Auth confirmation and recovery routes", () => {
  it("ignores client redirect URLs and verifies identity before opening a workspace", async () => {
    const response = await callback(
      new Request(
        getConfig().origin +
          "/api/auth/callback?code=valid&next=https://other.example",
      ),
    );
    expect(response.headers.get("Location")).toBe(getConfig().origin + "/app");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(spies.ensureWorkspace).toHaveBeenCalledWith(user);
  });

  it("uses a confirmed recovery event to create a short identity-bound grant", async () => {
    spies.recovery = true;
    const response = await callback(
      new Request(getConfig().origin + "/api/auth/callback?code=valid"),
    );
    expect(response.headers.get("Location")).toBe(
      getConfig().origin + "/reset-password",
    );
    expect(spies.cookieSet).toHaveBeenCalledWith(
      recoveryCookie,
      expect.any(String),
      expect.objectContaining({
        httpOnly: true,
        maxAge: 900,
        path: "/api/auth",
        sameSite: "lax",
      }),
    );
    expect(spies.ensureWorkspace).not.toHaveBeenCalled();
  });

  it("rejects unknown OTP types and invalid links without using their metadata", async () => {
    const response = await confirm(
      new Request(
        getConfig().origin +
          "/api/auth/confirm?token_hash=" +
          "a".repeat(64) +
          "&type=invite",
      ),
    );
    expect(response.headers.get("Location")).toBe(
      getConfig().origin + "/signin?auth=confirmation_failed",
    );
    expect(spies.verifyOtp).not.toHaveBeenCalled();
    expect(spies.ensureWorkspace).not.toHaveBeenCalled();
  });

  it("does not permit an ordinary signed-in user to reset a password without a recovery grant", async () => {
    const response = await password(
      new Request(getConfig().origin + "/api/auth/password", {
        method: "POST",
        headers: {
          Origin: getConfig().origin,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ password: "a-new-long-password!" }),
      }),
    );
    expect(response.status).toBe(403);
    expect(spies.updateUser).not.toHaveBeenCalled();
  });

  it("clears the recovery grant and revokes sessions after a successful password reset", async () => {
    spies.cookieGet.mockReturnValue({ value: recoveryGrant(user.id) });
    const response = await password(
      new Request(getConfig().origin + "/api/auth/password", {
        method: "POST",
        headers: {
          Origin: getConfig().origin,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ password: "a-new-long-password!" }),
      }),
    );
    expect(response.status).toBe(200);
    expect(spies.updateUser).toHaveBeenCalledWith({
      password: "a-new-long-password!",
    });
    expect(spies.cookieSet).toHaveBeenCalledWith(
      recoveryCookie,
      "",
      expect.objectContaining({ maxAge: 0 }),
    );
    expect(spies.signOut).toHaveBeenCalledWith({ scope: "global" });
    expect(spies.securityBegin).toHaveBeenCalledWith(
      spies.transaction,
      user.id,
      expect.any(String),
    );
    expect(spies.securityFinish).toHaveBeenCalledWith(
      spies.transaction,
      user.id,
      expect.any(String),
      "success",
    );
  });
});
