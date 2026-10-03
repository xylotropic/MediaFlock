import { afterEach, describe, expect, it, vi } from "vitest";
import { generateKeyPair, SignJWT } from "jose";
import { randomUUID, randomBytes } from "node:crypto";
import {
  mkdtemp,
  readFile,
  writeFile,
  rm,
  chmod,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import type { Context } from "../packages/db";
import { ChatGPTRuntime } from "../packages/chatgpt/runtime";
import {
  LocalVault,
  localSubscriptionsEnabled,
  type LocalState,
  type LocalBinding,
  type Vault,
} from "../packages/chatgpt/local-vault";
import {
  authorizeUrl,
  callbackParameters,
  exchangeTokens,
  oauthIssuer,
  oauthRevoke,
  planPermission,
  streamDraft,
  subscriptionRequest,
  verifyIdentity,
  type Credentials,
  type Transport,
} from "../packages/chatgpt/protocol";

const credentials: Credentials = {
  accessToken: "fixture-access",
  refreshToken: "fixture-refresh",
  idToken: "fixture-id",
  scopes: ["resource.invoke", "chatgpt.tokens.use.direct"],
  expiresAt: Date.now() + 3600000,
};
const binding: LocalBinding = {
  format: 1,
  userId: randomUUID(),
  workspaceId: randomUUID(),
  supabaseOrigin: "https://fixture.supabase.co",
  hostId: "urn:uuid:" + randomUUID(),
  createdAt: new Date().toISOString(),
};
const ctx: Context = {
  userId: binding.userId,
  workspaceId: binding.workspaceId,
  role: "owner",
  kind: "human",
  scopes: [],
  localInteractive: true,
  authSessionId: randomUUID(),
};
class MemoryVault implements Vault {
  state: LocalState = { format: 1, epoch: 0, profiles: [] };
  tail = Promise.resolve();
  async binding() {
    return binding;
  }
  async read() {
    return structuredClone(this.state);
  }
  async locked<T>(fn: (state: LocalState) => Promise<T>) {
    let release!: () => void;
    const before = this.tail;
    this.tail = new Promise((resolve) => {
      release = resolve;
    });
    await before;
    try {
      const draft = structuredClone(this.state),
        result = await fn(draft);
      this.state = draft;
      return result;
    } finally {
      release();
    }
  }
}
const runtimes: { runtime: ChatGPTRuntime; attempts: string[] }[] = [];
afterEach(async () => {
  for (const item of runtimes.splice(0))
    for (const id of item.attempts)
      await item.runtime.cancel(ctx, id).catch(() => {});
});
function setup(
  transport: Transport = vi.fn(async () => {
    throw Error("unexpected network");
  }) as Transport,
) {
  const vault = new MemoryVault(),
    checkOwner = vi.fn(async () => {}),
    keyReady = vi.fn(async () => {});
  const runtime = new ChatGPTRuntime({
    vault,
    available: () => true,
    projectOrigin: () => binding.supabaseOrigin,
    checkOwner,
    keyReady,
    transport,
    identity: async (_token, _client, nonce) => {
      if (nonce) expect(nonce.length).toBeGreaterThan(20);
      return {
        subject: "fixture-subject",
        email: "same@fixture.local",
        name: "Fixture",
      };
    },
  });
  const cleanup = { runtime, attempts: [] as string[] };
  runtimes.push(cleanup);
  const begin = async (profileId?: string) => {
    const attempt = await runtime.begin(ctx, profileId);
    cleanup.attempts.push(attempt.attemptId);
    return attempt;
  };
  return { runtime, vault, begin, checkOwner, keyReady };
}
const json = (data: unknown) =>
  new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json" },
  });
const tokenResponse = () =>
  json({
    access_token: credentials.accessToken,
    refresh_token: credentials.refreshToken,
    id_token: credentials.idToken,
    token_type: "Bearer",
    scope: credentials.scopes.join(" "),
    expires_in: 3600,
  });
async function callback(
  attempt: { attemptId: string; url: string },
  runtime: ChatGPTRuntime,
  extra: Record<string, string> = {},
) {
  const auth = new URL(attempt.url),
    url = new URL(auth.searchParams.get("redirect_uri")!);
  url.search = new URLSearchParams({
    state: auth.searchParams.get("state")!,
    code: "fixture-code",
    client_id: "oaiapp_fixture_client",
    ...extra,
  }).toString();
  const result = await fetch(url, { redirect: "manual" });
  for (let i = 0; i < 100; i++) {
    const status = await runtime.attemptStatus(ctx, attempt.attemptId);
    if (!["awaiting", "exchanging"].includes(status.status))
      return { result, status, url };
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw Error("Fixture callback did not complete");
}
function addProfile(vault: MemoryVault) {
  const profile = {
    id: randomUUID(),
    clientId: "oaiapp_fixture_client",
    subject: "fixture-subject",
    email: "same@fixture.local",
    name: "Fixture",
    model: "fixture-model",
    dailyTokenEstimate: 20000,
    generation: 0,
    reconnectRequired: false,
    revocationUnconfirmed: false,
    credentials: structuredClone(credentials),
  };
  vault.state.profiles.push(profile);
  vault.state.selectedId = profile.id;
  return profile;
}

describe("Local ChatGPT subscription security", () => {
  it("validates signatures, issuer, audience, nonce and authorized party", async () => {
    const pair = await generateKeyPair("RS256");
    const issue = (claims: any = {}, issuer = oauthIssuer) =>
      new SignJWT({
        nonce: "fixture-nonce",
        email: "fixture@local.test",
        ...claims,
      })
        .setProtectedHeader({ alg: "RS256" })
        .setIssuer(issuer)
        .setAudience("oaiapp_fixture_client")
        .setSubject("fixture-subject")
        .setIssuedAt()
        .setExpirationTime("5m")
        .sign(pair.privateKey);
    const token = await issue();
    expect(
      (
        await verifyIdentity(
          token,
          "oaiapp_fixture_client",
          "fixture-nonce",
          async () => pair.publicKey,
        )
      ).subject,
    ).toBe("fixture-subject");
    for (const [value, audience, nonce] of [
      [token, "wrong-audience", "fixture-nonce"],
      [token, "oaiapp_fixture_client", "wrong-nonce"],
      [await issue({ azp: "wrong" }), "oaiapp_fixture_client", "fixture-nonce"],
      [
        await issue({}, "https://wrong.example"),
        "oaiapp_fixture_client",
        "fixture-nonce",
      ],
    ])
      await expect(
        verifyIdentity(value, audience, nonce, async () => pair.publicKey),
      ).rejects.toMatchObject({ code: "chatgpt_identity" });
    const other = await generateKeyPair("RS256");
    await expect(
      verifyIdentity(
        token,
        "oaiapp_fixture_client",
        "fixture-nonce",
        async () => other.publicKey,
      ),
    ).rejects.toMatchObject({ code: "chatgpt_identity" });
  });
  it("requires both plan grants and rejects ambiguous or changed callbacks", () => {
    expect(planPermission(credentials)).toBe(true);
    expect(planPermission({ ...credentials, scopes: ["openid"] })).toBe(false);
    for (const query of [
      "state=wrong&code=x&client_id=oaiapp_fixture_client",
      "state=expected&state=expected&code=x&client_id=oaiapp_fixture_client",
      "state=expected&code=x&client_id=dynamic_agent_client",
      "state=expected&code=x&client_id=oaiapp_different_client",
    ])
      expect(() =>
        callbackParameters(
          new URL("http://127.0.0.1/auth/callback?" + query),
          "expected",
          "oaiapp_fixture_client",
        ),
      ).toThrow();
    expect(
      callbackParameters(
        new URL(
          "http://127.0.0.1/auth/callback?state=expected&error=access_denied",
        ),
        "expected",
      ).denied,
    ).toBe(true);
  });
  it("the real startup gate rejects hosted and non-web processes despite loopback-looking configuration", () => {
    const args = process.argv;
    try {
      vi.stubEnv("MEDIAFLOCK_MODE", "live");
      vi.stubEnv("MEDIAFLOCK_LOCAL_SUBSCRIPTIONS", "true");
      vi.stubEnv("MEDIAFLOCK_PROCESS_ROLE", "web");
      vi.stubEnv("APP_ORIGIN", "http://127.0.0.1:3210");
      process.argv = [
        args[0],
        "next",
        "start",
        "apps/web",
        "--hostname",
        "127.0.0.1",
        "--port",
        "3210",
      ];
      vi.stubEnv("VERCEL", "1");
      expect(localSubscriptionsEnabled()).toBe(false);
      vi.stubEnv("VERCEL", "");
      vi.stubEnv("MEDIAFLOCK_PROCESS_ROLE", "worker");
      expect(localSubscriptionsEnabled()).toBe(false);
      vi.stubEnv("MEDIAFLOCK_PROCESS_ROLE", "web");
      process.argv[5] = "0.0.0.0";
      expect(localSubscriptionsEnabled()).toBe(false);
      process.argv[5] = "127.0.0.1";
      process.argv[7] = "3212";
      expect(localSubscriptionsEnabled()).toBe(false);
      process.argv[7] = "3210";
      expect(localSubscriptionsEnabled()).toBe(process.platform === "darwin");
    } finally {
      process.argv = args;
      vi.unstubAllEnvs();
    }
  });
  it("evidence rejection preserves reported usage and never marks inference verified", async () => {
    const completed = {
      type: "response.completed",
      response: {
        status: "completed",
        usage: { total_tokens: 23 },
        output: [
          {
            type: "message",
            content: [
              {
                type: "output_text",
                text: JSON.stringify({ text: "valid schema" }),
              },
            ],
          },
        ],
      },
    };
    const { runtime, vault } = setup(
      async () => new Response("data: " + JSON.stringify(completed) + "\n\n"),
    );
    const profile = addProfile(vault);
    await expect(
      runtime.run(ctx, profile, {}, z.object({ text: z.string() }), () => {
        throw Error("invalid evidence");
      }),
    ).rejects.toMatchObject({ usedTokens: 23 });
    expect(vault.state.profiles[0].lastVerifiedInference).toBeUndefined();
    expect(vault.state.profiles[0].lease).toBeUndefined();
  });
  it("denies hosted, worker, token, foreign owner and foreign workspace before credential reads", async () => {
    const vault = new MemoryVault(),
      read = vi.spyOn(vault, "read"),
      bindingRead = vi.spyOn(vault, "binding");
    let available = false;
    const runtime = new ChatGPTRuntime({
      vault,
      available: () => available,
      projectOrigin: () => binding.supabaseOrigin,
      checkOwner: async () => {},
      keyReady: async () => {},
    });
    await expect(runtime.status(ctx)).rejects.toMatchObject({
      code: "chatgpt_local_required",
    });
    expect(bindingRead).not.toHaveBeenCalled();
    available = true;
    for (const bad of [
      { ...ctx, kind: "worker" as const },
      { ...ctx, kind: "token" as const },
      { ...ctx, localInteractive: false },
      { ...ctx, authSessionId: undefined },
      { ...ctx, role: "editor" as const },
      { ...ctx, userId: randomUUID() },
      { ...ctx, workspaceId: randomUUID() },
    ])
      await expect(runtime.status(bad)).rejects.toMatchObject({
        code: "chatgpt_local_owner",
      });
    expect(read).not.toHaveBeenCalled();
  });
  it("stages a valid callback until the same authenticated session finalizes and rejects replay", async () => {
    const transport = vi.fn(async () => tokenResponse()) as Transport;
    const { runtime, vault, begin } = setup(transport),
      attempt = await begin();
    const done = await callback(attempt, runtime);
    expect(done.result.status).toBe(303);
    expect(done.result.headers.get("location")).toBe("/complete");
    expect(done.status.status).toBe("verified");
    expect(vault.state.profiles[0].credentials).toBeUndefined();
    await expect(
      runtime.finalize(
        { ...ctx, authSessionId: randomUUID() },
        attempt.attemptId,
      ),
    ).rejects.toMatchObject({ code: "chatgpt_attempt" });
    expect((await fetch(done.url, { redirect: "manual" })).status).toBe(400);
    const status = await runtime.finalize(ctx, attempt.attemptId);
    expect(status.profiles[0].signedIn).toBe(true);
    expect(JSON.stringify(status)).not.toContain("fixture-access");
    await expect(
      runtime.finalize(ctx, attempt.attemptId),
    ).rejects.toMatchObject({ code: "chatgpt_attempt" });
  });
  it("keeps registrations separate even with identical emails and retains issued clients after disconnect", async () => {
    const { runtime, vault, begin } = setup(async () => tokenResponse());
    const first = await begin();
    await callback(first, runtime);
    await runtime.finalize(ctx, first.attemptId);
    const second = await begin();
    await callback(second, runtime, { client_id: "oaiapp_second_client" });
    await runtime.finalize(ctx, second.attemptId);
    expect(vault.state.profiles).toHaveLength(2);
    expect(vault.state.profiles[0].email).toBe(vault.state.profiles[1].email);
    const id = vault.state.profiles[0].id;
    await runtime.disconnect(ctx, id);
    expect(vault.state.profiles[0].clientId).toBe("oaiapp_fixture_client");
    expect(vault.state.profiles[0].credentials).toBeUndefined();
    expect(new URL((await begin(id)).url).searchParams.get("client_id")).toBe(
      "oaiapp_fixture_client",
    );
  });
  it("a cancelled or superseded callback cannot restore credentials", async () => {
    const { runtime, vault, begin } = setup(async () => tokenResponse());
    const old = await begin();
    await callback(old, runtime);
    await begin();
    await expect(runtime.finalize(ctx, old.attemptId)).rejects.toMatchObject({
      code: "chatgpt_attempt",
    });
    expect(vault.state.profiles[0].credentials).toBeUndefined();
  });
  it("serializes rotating refreshes, retains omitted scope and rejects changed refresh identity", async () => {
    const transport = vi.fn(async () =>
      json({
        access_token: "rotated-access",
        refresh_token: "rotated-refresh",
        expires_in: 3600,
        token_type: "Bearer",
      }),
    ) as Transport;
    const { runtime, vault } = setup(transport),
      profile = addProfile(vault);
    profile.credentials.expiresAt = 0;
    await Promise.all([
      runtime.admittedProfile(ctx),
      runtime.admittedProfile(ctx),
    ]);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(vault.state.profiles[0].credentials).toMatchObject({
      accessToken: "rotated-access",
      refreshToken: "rotated-refresh",
      scopes: credentials.scopes,
    });
    const bad = setup(async () =>
      json({
        access_token: "new",
        id_token: "new-id",
        scope: "openid",
        token_type: "Bearer",
        expires_in: 3600,
      }),
    );
    addProfile(bad.vault).credentials.expiresAt = 0;
    await expect(bad.runtime.admittedProfile(ctx)).rejects.toMatchObject({
      code: "chatgpt_permission",
    });
    expect(bad.vault.state.profiles[0].credentials!.accessToken).toBe("new");
    expect(bad.vault.state.profiles[0].reconnectRequired).toBe(false);
  });
  it("disconnect aborts a running request and leaves no credentials when revocation fails", async () => {
    let started!: () => void;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const transport: Transport = async (url, init) => {
      if (String(url) === oauthRevoke) throw Error("offline");
      started();
      return await new Promise((_resolve, reject) =>
        init!.signal!.addEventListener(
          "abort",
          () => reject(Error("aborted")),
          { once: true },
        ),
      );
    };
    const { runtime, vault } = setup(transport),
      profile = addProfile(vault);
    const running = runtime.run(
      ctx,
      profile,
      {},
      z.object({ text: z.string() }),
    );
    const rejected = expect(running).rejects.toMatchObject({
      code: "chatgpt_interrupted",
    });
    await entered;
    expect(
      (await runtime.disconnect(ctx, profile.id)).revocationConfirmed,
    ).toBe(false);
    await rejected;
    expect(vault.state.profiles[0].credentials).toBeUndefined();
    expect(vault.state.profiles[0].lease).toBeUndefined();
  });
  it("persists a reduced refreshed grant and disconnect revokes the latest rotating token", async () => {
    const revoked: string[] = [];
    const transport: Transport = async (url, init) => {
      if (String(url) === oauthRevoke) {
        revoked.push((init!.body as URLSearchParams).get("token")!);
        return new Response(null, { status: 200 });
      }
      return json({
        access_token: "reduced-access",
        refresh_token: "rotated-R1",
        id_token: "new-verified-id",
        scope: "openid profile email offline_access",
        token_type: "Bearer",
        expires_in: 3600,
      });
    };
    const { runtime, vault } = setup(transport);
    const profile = addProfile(vault);
    profile.credentials.expiresAt = 0;
    await expect(runtime.admittedProfile(ctx)).rejects.toMatchObject({
      code: "chatgpt_permission",
    });
    expect(vault.state.profiles[0].credentials).toMatchObject({
      accessToken: "reduced-access",
      refreshToken: "rotated-R1",
      scopes: ["openid", "profile", "email", "offline_access"],
    });
    expect(vault.state.profiles[0].reconnectRequired).toBe(false);
    expect((await runtime.status(ctx)).profiles[0]).toMatchObject({
      signedIn: true,
      planPermission: false,
    });
    expect(
      (await runtime.disconnect(ctx, profile.id)).revocationConfirmed,
    ).toBe(true);
    expect(revoked).toEqual(["rotated-R1"]);
  });
  it("a definitely pre-transmission error preserves the connection for a later explicit attempt", async () => {
    let calls = 0;
    const { runtime, vault } = setup(async () => {
      calls++;
      if (calls === 1)
        throw Object.assign(Error("fixture connect refused"), {
          cause: { code: "ECONNREFUSED" },
        });
      return json({
        access_token: "recovered",
        refresh_token: "new-R1",
        token_type: "Bearer",
        expires_in: 3600,
      });
    });
    addProfile(vault).credentials.expiresAt = 0;
    await expect(runtime.admittedProfile(ctx)).rejects.toMatchObject({
      code: "chatgpt_temporary",
    });
    expect(calls).toBe(1);
    expect(vault.state.profiles[0].reconnectRequired).toBe(false);
    expect(vault.state.profiles[0].credentials!.refreshToken).toBe(
      "fixture-refresh",
    );
    expect((await runtime.admittedProfile(ctx)).credentials!.accessToken).toBe(
      "recovered",
    );
    expect(calls).toBe(2);
  });
  it("distinguishes invalid grant, client configuration and ambiguous renewal without automatic retry", async () => {
    for (const [failure, code, cleared] of [
      ["invalid_grant", "chatgpt_reconnect", true],
      ["invalid_client", "chatgpt_configuration", false],
      ["ambiguous", "chatgpt_renewal_uncertain", true],
    ] as const) {
      let calls = 0;
      const { runtime, vault } = setup(async () => {
        calls++;
        if (failure === "ambiguous")
          throw Error("fixture connection reset after request");
        return new Response(JSON.stringify({ error: failure }), {
          status: 400,
        });
      });
      const profile = addProfile(vault);
      profile.credentials.expiresAt = 0;
      await expect(runtime.admittedProfile(ctx)).rejects.toMatchObject({
        code,
      });
      expect(calls).toBe(1);
      expect(!!vault.state.profiles[0].credentials).toBe(!cleared);
      expect(vault.state.profiles[0].reconnectRequired).toBe(cleared);
      expect(vault.state.profiles[0].clientId).toBe(profile.clientId);
      if (failure === "ambiguous")
        expect(
          (await runtime.disconnect(ctx, profile.id)).revocationConfirmed,
        ).toBe(false);
    }
  });
  it("revokes a rotated grant whose refreshed identity differs before requiring reauthorization", async () => {
    const vault = new MemoryVault();
    const profile = addProfile(vault);
    profile.credentials.expiresAt = 0;
    let revoked = "";
    const runtime = new ChatGPTRuntime({
      vault,
      available: () => true,
      projectOrigin: () => binding.supabaseOrigin,
      checkOwner: async () => {},
      keyReady: async () => {},
      identity: async () => ({
        subject: "another-subject",
        email: "same@fixture.local",
        name: "Fixture",
      }),
      transport: async (url, init) => {
        if (String(url) === oauthRevoke) {
          revoked = (init!.body as URLSearchParams).get("token")!;
          return new Response(null, { status: 200 });
        }
        return json({
          access_token: "new-access",
          refresh_token: "wrong-identity-R1",
          id_token: "new-id",
          scope: credentials.scopes.join(" "),
          token_type: "Bearer",
          expires_in: 3600,
        });
      },
    });
    await expect(runtime.admittedProfile(ctx)).rejects.toMatchObject({
      code: "chatgpt_identity",
    });
    expect(revoked).toBe("wrong-identity-R1");
    expect(vault.state.profiles[0].credentials).toBeUndefined();
    expect(vault.state.profiles[0].subject).toBe("fixture-subject");
    expect(vault.state.profiles[0].revocationUnconfirmed).toBe(false);
  });
  it("protects the vault with encryption, associated owner data, atomic writes and private permissions", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mediaflock-vault-test-")),
      key = randomBytes(32);
    try {
      await chmod(dir, 0o700);
      await writeFile(join(dir, "binding.json"), JSON.stringify(binding), {
        mode: 0o600,
      });
      const vault = new LocalVault(dir, async () => key);
      await vault.locked(async (state) => {
        addProfile({ state } as MemoryVault);
      });
      const raw = await readFile(join(dir, "chatgpt-vault.json"), "utf8");
      expect(raw).not.toContain("fixture-access");
      expect((await vault.read()).profiles[0].credentials!.accessToken).toBe(
        "fixture-access",
      );
      await writeFile(
        join(dir, "binding.json"),
        JSON.stringify({ ...binding, userId: randomUUID() }),
      );
      await expect(vault.read()).rejects.toMatchObject({
        code: "chatgpt_storage",
      });
      await chmod(join(dir, "binding.json"), 0o644);
      await expect(vault.binding()).rejects.toMatchObject({
        code: "chatgpt_installation",
      });
      await rm(join(dir, "binding.json"));
      await symlink(join(dir, "chatgpt-vault.json"), join(dir, "binding.json"));
      await expect(vault.binding()).rejects.toMatchObject({
        code: "chatgpt_installation",
      });
    } finally {
      key.fill(0);
      await rm(dir, { recursive: true, force: true });
    }
  });
});
describe("Plan inference protocol", () => {
  const schema = z.object({ text: z.string() });
  const completed = (usage?: number) => ({
    type: "response.completed",
    response: {
      status: "completed",
      output: [
        {
          type: "message",
          content: [
            { type: "output_text", text: JSON.stringify({ text: "café" }) },
          ],
        },
      ],
      ...(usage === undefined ? {} : { usage: { total_tokens: usage } }),
    },
  });
  const events = (...items: unknown[]) =>
    new Response(
      items.map((item) => "data: " + JSON.stringify(item) + "\n\n").join(""),
      { headers: { "Content-Type": "text/event-stream" } },
    );
  it("uses only supported fields and never serializes an API key or system message", () => {
    const request = subscriptionRequest("fixture-model", {}, schema);
    expect(request).toMatchObject({ store: false, stream: true });
    expect(Array.isArray(request.input)).toBe(true);
    for (const field of [
      "max_output_tokens",
      "temperature",
      "previous_response_id",
      "metadata",
    ])
      expect(request).not.toHaveProperty(field);
    expect(JSON.stringify(request)).not.toContain('"system"');
    const auth = new URL(
      authorizeUrl({
        hostId: binding.hostId,
        redirectUri: "http://127.0.0.1:1455/auth/callback",
        state: "fixture-state",
        nonce: "fixture-nonce",
        verifier: "fixture-verifier",
      }),
    );
    expect(auth.searchParams.get("client_id")).toBe("dynamic_agent_client");
    expect(auth.searchParams.get("code_challenge_method")).toBe("S256");
  });
  it("retains omitted refresh grants and requires initial grants", async () => {
    const transport: Transport = async () =>
      json({ access_token: "new", token_type: "Bearer", expires_in: 3600 });
    expect(
      await exchangeTokens(new URLSearchParams(), transport, credentials),
    ).toMatchObject({
      refreshToken: "fixture-refresh",
      scopes: credentials.scopes,
    });
    await expect(
      exchangeTokens(new URLSearchParams(), transport),
    ).rejects.toMatchObject({ code: "chatgpt_signin" });
  });
  it("requires a completed response, tolerates fragmented UTF8 and leaves missing usage unknown", async () => {
    const bytes = Buffer.from(
        "data: " + JSON.stringify(completed()) + "\r\n\r\n",
      ),
      body = new ReadableStream({
        start(controller) {
          for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
          controller.close();
        },
      });
    const result = await streamDraft(
      credentials,
      "fixture-model",
      {},
      schema,
      async () => new Response(body),
    );
    expect(result).toEqual({ output: { text: "café" }, usedTokens: undefined });
    await expect(
      streamDraft(credentials, "fixture-model", {}, schema, async () =>
        events({ type: "response.output_text.delta", delta: "{}" }),
      ),
    ).rejects.toMatchObject({ code: "chatgpt_incomplete" });
  });
  it("rejects late failure, failed schema and allowance exhaustion without retrying and preserves known usage", async () => {
    for (const [items, code] of [
      [
        [
          completed(31),
          {
            type: "response.failed",
            response: {
              error: { code: "subscription_sharing_usage_limit_exceeded" },
            },
          },
        ],
        "chatgpt_limit",
      ],
      [
        [
          {
            ...completed(31),
            response: { ...completed(31).response, output: [] },
          },
        ],
        "chatgpt_output",
      ],
    ] as const) {
      const transport = vi.fn(async () => events(...items)) as Transport;
      await expect(
        streamDraft(credentials, "fixture-model", {}, schema, transport),
      ).rejects.toMatchObject({ code, usedTokens: 31 });
      expect(transport).toHaveBeenCalledTimes(1);
    }
    await expect(
      streamDraft(
        credentials,
        "fixture-model",
        {},
        z.object({ missing: z.number() }),
        async () => events(completed(17)),
      ),
    ).rejects.toMatchObject({ code: "chatgpt_schema", usedTokens: 17 });
  });
});
