import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
const spies = vi.hoisted(() => ({ signin: vi.fn(), limit: vi.fn() }));
vi.mock("../packages/domain/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../packages/domain/auth")>()),
  authClient: async () => ({ auth: { signInWithPassword: spies.signin } }),
  limit: spies.limit,
}));
import { POST } from "../apps/web/app/api/login/route";
import { getConfig } from "../packages/domain/config";
import { clientAddressHash } from "../packages/domain/registration";

const originalVercel = process.env.VERCEL;
function request(body: unknown, extra: Record<string, string> = {}) {
  return new Request(getConfig().origin + "/api/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: getConfig().origin,
      ...extra,
    },
    body: JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  spies.signin.mockResolvedValue({ error: null });
  spies.limit.mockResolvedValue(undefined);
});
afterAll(() => {
  if (originalVercel === undefined) delete process.env.VERCEL;
  else process.env.VERCEL = originalVercel;
});

describe("Login request boundaries", () => {
  it("bounds incoming JSON before calling Auth", async () => {
    const response = await POST(
      request({ email: "isolated@example.com", password: "x".repeat(5000) }),
    );
    expect(response.status).toBe(413);
    expect(spies.signin).not.toHaveBeenCalled();
  });

  it("preserves existing password semantics when signing in", async () => {
    const response = await POST(
      request({ email: "isolated@example.com", password: "old" }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(spies.signin).toHaveBeenCalledWith({
      email: "isolated@example.com",
      password: "old",
    });
  });

  it("uses the trusted Vercel client header and stores only its hash in the limiter", async () => {
    process.env.VERCEL = "1";
    const req = request(
      { email: "isolated@example.com", password: "old" },
      {
        "x-vercel-forwarded-for": "203.0.113.7",
        "x-forwarded-for": "198.51.100.9",
      },
    );
    expect((await POST(req)).status).toBe(200);
    expect(spies.limit).toHaveBeenCalledWith(
      "login:" + clientAddressHash(req),
      20,
    );
    const key = spies.limit.mock.calls[0][0];
    expect(key).toMatch(/^login:[a-f0-9]{64}$/);
    expect(key).not.toContain("203.0.113.7");
    expect(key).not.toContain("198.51.100.9");
  });

  it("does not trust spoofable forwarding headers on the local server", () => {
    delete process.env.VERCEL;
    const first = request(
      {},
      {
        "x-forwarded-for": "203.0.113.1",
        "x-vercel-forwarded-for": "203.0.113.2",
      },
    );
    const second = request({}, { "x-forwarded-for": "203.0.113.3" });
    expect(clientAddressHash(first)).toBe(clientAddressHash(second));
  });

  it("preserves generic credential rejection and rejects foreign origins", async () => {
    spies.signin.mockResolvedValue({
      error: { message: "Private provider error" },
    });
    const response = await POST(
      request({ email: "isolated@example.com", password: "old" }),
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: {
        code: "sign_in_failed",
        message: "Email or password was not accepted.",
      },
    });
    vi.clearAllMocks();
    expect(
      (
        await POST(
          request(
            { email: "isolated@example.com", password: "old" },
            { Origin: "https://other.example" },
          ),
        )
      ).status,
    ).toBe(403);
    expect(spies.signin).not.toHaveBeenCalled();
  });
});
