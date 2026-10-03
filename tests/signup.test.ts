import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
const spies = vi.hoisted(() => ({
  signUp: vi.fn(),
  getUser: vi.fn(),
  ensureWorkspace: vi.fn(),
  capacity: vi.fn(),
  rateLimit: vi.fn(),
  initialCode: vi.fn(),
}));
vi.mock("../packages/domain/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../packages/domain/auth")>()),
  authClient: async () => ({
    auth: { signUp: spies.signUp, getUser: spies.getUser },
  }),
}));
vi.mock("../packages/domain/registration", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../packages/domain/registration")>()),
  ensureRegisteredWorkspace: spies.ensureWorkspace,
  checkRegistrationCapacity: spies.capacity,
  registrationRateLimit: spies.rateLimit,
}));
vi.mock("../packages/domain/recovery-codes", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../packages/domain/recovery-codes")
  >()),
  issueInitialRecoveryCode: spies.initialCode,
}));
import { POST } from "../apps/web/app/api/signup/route";
import { getConfig } from "../packages/domain/config";

const email = "isolated@example.com";
const originalSignup = process.env.MEDIAFLOCK_SELF_SIGNUP_ENABLED;
function request(data: unknown, origin = getConfig().origin) {
  return new Request(getConfig().origin + "/api/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify(data),
  });
}
beforeEach(() => {
  process.env.MEDIAFLOCK_SELF_SIGNUP_ENABLED = "true";
  vi.clearAllMocks();
  spies.capacity.mockResolvedValue(undefined);
  spies.rateLimit.mockResolvedValue(undefined);
  spies.ensureWorkspace.mockResolvedValue({
    workspace_id: "private-workspace",
    role: "owner",
    mode: "demo",
  });
  spies.initialCode.mockResolvedValue(undefined);
});
afterAll(() => {
  if (originalSignup === undefined)
    delete process.env.MEDIAFLOCK_SELF_SIGNUP_ENABLED;
  else process.env.MEDIAFLOCK_SELF_SIGNUP_ENABLED = originalSignup;
});

describe("Signup API", () => {
  it("checks request origin and body bounds before any identity operation", async () => {
    expect(
      (
        await POST(
          request(
            { email, password: "long-password!" },
            "https://other.example",
          ),
        )
      ).status,
    ).toBe(403);
    expect(
      (await POST(request({ email, password: "p".repeat(5000) }))).status,
    ).toBe(413);
    expect(spies.signUp).not.toHaveBeenCalled();
  });

  it("leaves pending confirmation identities without membership or identifiers", async () => {
    spies.signUp.mockResolvedValue({
      data: { user: { id: "pending-id" }, session: null },
      error: null,
    });
    const response = await POST(
      request({ email, password: "long-password!", name: "Ada" }),
    );
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      ok: true,
      status: "confirmation_required",
    });
    expect(spies.getUser).not.toHaveBeenCalled();
    expect(spies.ensureWorkspace).not.toHaveBeenCalled();
    expect(spies.initialCode).not.toHaveBeenCalled();
    expect(spies.signUp).toHaveBeenCalledWith({
      email,
      password: "long-password!",
      options: {
        emailRedirectTo: getConfig().origin + "/api/auth/callback",
        data: { full_name: "Ada", timezone: "America/New_York" },
      },
    });
  });

  it("verifies an instant Auth session before provisioning", async () => {
    const user = { id: "verified-id", email, email_confirmed_at: "2026-01-01" };
    spies.signUp.mockResolvedValue({
      data: { user: { id: "untrusted-response" }, session: {} },
      error: null,
    });
    spies.getUser.mockResolvedValue({ data: { user }, error: null });
    const response = await POST(request({ email, password: "long-password!" }));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      ok: true,
      status: "authenticated",
    });
    expect(spies.ensureWorkspace).toHaveBeenCalledWith(user);
    expect(spies.initialCode).toHaveBeenCalledWith(user, "private-workspace");
  });

  it("refuses forged identity data and disabled signup before calling Auth", async () => {
    expect(
      (
        await POST(
          request({
            email,
            password: "long-password!",
            workspace_id: "another-user",
            role: "owner",
          }),
        )
      ).status,
    ).toBe(400);
    process.env.MEDIAFLOCK_SELF_SIGNUP_ENABLED = "false";
    expect(
      (await POST(request({ email, password: "long-password!" }))).status,
    ).toBe(403);
    expect(spies.signUp).not.toHaveBeenCalled();
  });

  it("does not expose provider errors, credentials or user identifiers", async () => {
    spies.signUp.mockResolvedValue({
      data: null,
      error: {
        status: 400,
        message: "sensitive provider diagnostic and user id",
        code: "unexpected",
      },
    });
    const response = await POST(request({ email, password: "long-password!" }));
    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).not.toContain(
      "sensitive provider",
    );
  });
});
