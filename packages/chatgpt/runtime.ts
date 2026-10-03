import { createServer, type Server, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { scoped, one, type Context } from "../db";
import { getConfig } from "../domain/config";
import { DomainError, requireCondition } from "../domain/errors";
import {
  LocalVault,
  localSubscriptionsEnabled,
  keychainKey,
  publicProfile,
  type Vault,
  type Profile,
  type LocalBinding,
} from "./local-vault";
import {
  authorizeUrl,
  callbackParameters,
  exchangeTokens,
  verifyIdentity,
  randomSecret,
  planPermission,
  listModels,
  streamDraft,
  oauthRevoke,
  InferenceError,
  responsesOrigin,
  type Credentials,
  type Identity,
  type Model,
  type Transport,
} from "./protocol";

interface Attempt {
  id: string;
  profileId: string;
  epoch: number;
  ctx: Context;
  state: string;
  nonce: string;
  verifier: string;
  redirectUri: string;
  clientId?: string;
  expectedSubject?: string;
  status:
    | "awaiting"
    | "exchanging"
    | "verified"
    | "denied"
    | "error"
    | "complete"
    | "cancelled";
  message: string;
  consumed: boolean;
  expiresAt: number;
  staged?: { identity: Identity; credentials: Credentials };
  server?: Server;
  timer?: ReturnType<typeof setTimeout>;
}
export interface RuntimeDependencies {
  vault: Vault;
  available: () => boolean;
  projectOrigin: () => string;
  checkOwner: (ctx: Context) => Promise<void>;
  keyReady: () => Promise<void>;
  transport?: Transport;
  identity?: typeof verifyIdentity;
}
function staticReply(
  response: ServerResponse,
  status: number,
  message: string,
) {
  response.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy":
      "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'",
  });
  response.end(
    '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>MediaFlock</title><style>body{font:16px system-ui;margin:0;min-height:100vh;display:grid;place-items:center;color:#171717}main{max-width:420px;padding:32px}h1{font-size:24px}p{line-height:1.5;color:#666}</style><main><h1>MediaFlock</h1><p>' +
      message +
      "</p></main></html>",
  );
}
export class ChatGPTRuntime {
  private attempts = new Map<string, Attempt>();
  private modelCache = new Map<
    string,
    { models: Model[]; fetchedAt: number }
  >();
  private controllers = new Map<string, AbortController>();
  private transport: Transport;
  constructor(private dependencies: RuntimeDependencies) {
    this.transport = dependencies.transport || fetch;
  }
  private async scope(ctx: Context): Promise<LocalBinding> {
    requireCondition(
      this.dependencies.available(),
      "chatgpt_local_required",
      "Open MediaFlock on this Mac to use your ChatGPT subscription.",
      403,
    );
    requireCondition(
      ctx.kind === "human" &&
        ctx.role === "owner" &&
        ctx.localInteractive &&
        ctx.authSessionId,
      "chatgpt_local_owner",
      "This connection requires the installed owner's local sign-in.",
      403,
    );
    const binding = await this.dependencies.vault.binding();
    requireCondition(
      ctx.userId === binding.userId &&
        ctx.workspaceId === binding.workspaceId &&
        this.dependencies.projectOrigin() === binding.supabaseOrigin,
      "chatgpt_local_owner",
      "This subscription connection belongs to another local installation owner.",
      403,
    );
    await this.dependencies.checkOwner(ctx);
    return binding;
  }
  async status(ctx: Context) {
    await this.scope(ctx);
    const state = await this.dependencies.vault.read();
    return {
      available: true,
      selectedId: state.selectedId || null,
      profiles: state.profiles.map(publicProfile),
    };
  }
  private attempt(ctx: Context, id: string) {
    const attempt = this.attempts.get(id);
    requireCondition(
      attempt &&
        attempt.ctx.userId === ctx.userId &&
        attempt.ctx.workspaceId === ctx.workspaceId &&
        attempt.ctx.authSessionId === ctx.authSessionId &&
        attempt.expiresAt > Date.now(),
      "chatgpt_attempt",
      "This sign-in attempt expired. Start sign-in again.",
      403,
    );
    return attempt;
  }
  async begin(ctx: Context, profileId?: string, enablePlanUsage = false) {
    const binding = await this.scope(ctx);
    await this.dependencies.keyReady();
    const snapshot = await this.dependencies.vault.locked(async (state) => {
      const profile = profileId
        ? state.profiles.find((p) => p.id === profileId)
        : undefined;
      requireCondition(
        !profileId || profile,
        "chatgpt_profile",
        "Select a saved ChatGPT connection.",
      );
      requireCondition(
        profile || state.profiles.length < 20,
        "chatgpt_profiles",
        "This installation already has twenty saved ChatGPT connections.",
      );
      state.epoch++;
      return {
        epoch: state.epoch,
        profile: profile ? structuredClone(profile) : null,
      };
    });
    for (const attempt of this.attempts.values()) {
      if (["awaiting", "exchanging", "verified"].includes(attempt.status)) {
        attempt.status = "cancelled";
        this.closeAttempt(attempt);
      }
    }
    for (const [id, attempt] of this.attempts)
      if (
        ["complete", "cancelled", "error", "denied"].includes(attempt.status)
      ) {
        this.closeAttempt(attempt);
        this.attempts.delete(id);
      }
    const attempt: Attempt = {
      id: randomUUID(),
      profileId: snapshot.profile?.id || randomUUID(),
      epoch: snapshot.epoch,
      ctx: { ...ctx },
      clientId: snapshot.profile?.clientId,
      expectedSubject: snapshot.profile?.subject || undefined,
      state: randomSecret(),
      nonce: randomSecret(),
      verifier: randomSecret(),
      redirectUri: "",
      status: "awaiting",
      message: "Finish sign-in in Chrome.",
      consumed: false,
      expiresAt: Date.now() + 600000,
    };
    const server = createServer((request, response) => {
      const port = (server.address() as { port: number } | null)?.port;
      if (
        request.method !== "GET" ||
        request.headers.host !== "127.0.0.1:" + port ||
        request.socket.remoteAddress !== "127.0.0.1" ||
        (request.url || "").length > 4096 ||
        request.headers["transfer-encoding"] ||
        Number(request.headers["content-length"] || 0) > 0
      ) {
        staticReply(response, 400, "This sign-in response is invalid.");
        return;
      }
      let url: URL;
      try {
        url = new URL(request.url || "/", "http://127.0.0.1:" + port);
      } catch {
        staticReply(response, 400, "This sign-in response is invalid.");
        return;
      }
      if (url.origin !== "http://127.0.0.1:" + port) {
        staticReply(response, 400, "This sign-in response is invalid.");
        return;
      }
      if (url.pathname === "/complete" && !url.search) {
        staticReply(
          response,
          200,
          "The sign-in response was received. Return to MediaFlock to finish connecting.",
        );
        return;
      }
      if (
        url.pathname !== "/auth/callback" ||
        attempt.consumed ||
        attempt.status !== "awaiting" ||
        attempt.expiresAt <= Date.now()
      ) {
        staticReply(
          response,
          400,
          "This sign-in response is invalid or expired.",
        );
        return;
      }
      let parameters: ReturnType<typeof callbackParameters>;
      try {
        parameters = callbackParameters(url, attempt.state, attempt.clientId);
      } catch {
        staticReply(response, 400, "This sign-in response is invalid.");
        return;
      }
      attempt.consumed = true;
      attempt.status = parameters.denied ? "denied" : "exchanging";
      attempt.message = parameters.denied
        ? "ChatGPT authorization was declined. Your previous connection was preserved."
        : "Finishing ChatGPT sign-in…";
      response.writeHead(303, {
        Location: "/complete",
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      });
      response.end();
      if (!parameters.denied)
        void this.finishCallback(attempt, parameters.clientId, parameters.code);
    });
    attempt.server = server;
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    attempt.redirectUri =
      "http://127.0.0.1:" +
      (server.address() as { port: number }).port +
      "/auth/callback";
    server.unref();
    attempt.timer = setTimeout(() => {
      attempt.status = "cancelled";
      this.closeAttempt(attempt);
      this.attempts.delete(attempt.id);
    }, 600000);
    attempt.timer.unref();
    this.attempts.set(attempt.id, attempt);
    return {
      attemptId: attempt.id,
      url: authorizeUrl({
        clientId: attempt.clientId,
        hostId: binding.hostId,
        redirectUri: attempt.redirectUri,
        state: attempt.state,
        nonce: attempt.nonce,
        verifier: attempt.verifier,
        requestPlanConsent: !!snapshot.profile && enablePlanUsage,
      }),
    };
  }
  private async finishCallback(
    attempt: Attempt,
    clientId: string,
    code: string,
  ) {
    let received: Credentials | undefined;
    try {
      await this.scope(attempt.ctx);
      await this.dependencies.vault.locked(async (state) => {
        requireCondition(
          state.epoch === attempt.epoch && attempt.status === "exchanging",
          "chatgpt_attempt",
          "A newer connection action replaced this sign-in.",
          409,
        );
        let profile = state.profiles.find((p) => p.id === attempt.profileId);
        if (!profile) {
          profile = {
            id: attempt.profileId,
            clientId,
            subject: "",
            email: "",
            name: "",
            model: "",
            dailyTokenEstimate: 20000,
            generation: 0,
            reconnectRequired: true,
            revocationUnconfirmed: false,
          };
          state.profiles.push(profile);
        }
        requireCondition(
          profile.clientId === clientId,
          "chatgpt_registration",
          "ChatGPT returned a different registration.",
          403,
        );
      });
      attempt.clientId = clientId;
      const credentials = (received = await exchangeTokens(
        new URLSearchParams({
          grant_type: "authorization_code",
          client_id: clientId,
          code,
          code_verifier: attempt.verifier,
          redirect_uri: attempt.redirectUri,
          resource: responsesOrigin,
        }),
        this.transport,
      ));
      requireCondition(
        credentials.idToken,
        "chatgpt_identity",
        "ChatGPT returned no verifiable identity.",
        403,
      );
      const identity = await (this.dependencies.identity || verifyIdentity)(
        credentials.idToken,
        clientId,
        attempt.nonce,
      );
      requireCondition(
        !attempt.expectedSubject ||
          attempt.expectedSubject === identity.subject,
        "chatgpt_identity",
        "ChatGPT returned a different account. Your original connection was preserved.",
        403,
      );
      await this.scope(attempt.ctx);
      await this.dependencies.vault.locked(async (state) => {
        requireCondition(
          state.epoch === attempt.epoch &&
            attempt.status === "exchanging" &&
            attempt.expiresAt > Date.now(),
          "chatgpt_attempt",
          "This sign-in was cancelled or expired.",
          409,
        );
      });
      attempt.staged = { identity, credentials };
      attempt.status = "verified";
      attempt.message =
        "ChatGPT identity verified. Finish connecting in MediaFlock.";
    } catch (error) {
      if (received) void this.revoke(clientId, received);
      if (attempt.status !== "cancelled") {
        attempt.status = "error";
        attempt.message =
          error instanceof DomainError
            ? error.message
            : "ChatGPT sign-in could not be completed. Your previous connection was preserved.";
      }
    }
  }
  async attemptStatus(ctx: Context, id: string) {
    await this.scope(ctx);
    const attempt = this.attempt(ctx, id);
    return { status: attempt.status, message: attempt.message };
  }
  async finalize(ctx: Context, id: string) {
    await this.scope(ctx);
    const attempt = this.attempt(ctx, id);
    requireCondition(
      attempt.status === "verified" && attempt.staged,
      "chatgpt_attempt",
      "Finish ChatGPT sign-in before connecting.",
      409,
    );
    const staged = attempt.staged;
    await this.dependencies.vault.locked(async (state) => {
      requireCondition(
        state.epoch === attempt.epoch,
        "chatgpt_attempt",
        "A newer connection action replaced this sign-in.",
        409,
      );
      const profile = state.profiles.find((p) => p.id === attempt.profileId);
      requireCondition(
        profile && profile.clientId,
        "chatgpt_profile",
        "This ChatGPT registration is unavailable.",
        409,
      );
      profile.subject = staged.identity.subject;
      profile.email = staged.identity.email;
      profile.name = staged.identity.name;
      profile.credentials = staged.credentials;
      profile.generation++;
      profile.reconnectRequired = false;
      profile.revocationUnconfirmed = false;
      profile.lastVerifiedInference = undefined;
      profile.lease = undefined;
      state.selectedId = profile.id;
      state.epoch++;
    });
    attempt.status = "complete";
    attempt.staged = undefined;
    this.closeAttempt(attempt);
    this.modelCache.delete(attempt.profileId);
    return this.status(ctx);
  }
  private closeAttempt(attempt: Attempt) {
    if (attempt.timer) clearTimeout(attempt.timer);
    attempt.server?.close();
    // Staged credentials never enter browser responses, cloud rows, or logs.
    if (attempt.status === "cancelled" && attempt.staged) {
      void this.revoke(attempt.clientId || "", attempt.staged.credentials);
      attempt.staged = undefined;
    }
  }
  private async revoke(clientId: string, credentials: Credentials) {
    if (!clientId || !credentials.refreshToken) return false;
    try {
      const response = await this.transport(oauthRevoke, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(15000),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          token: credentials.refreshToken,
          token_type_hint: "refresh_token",
          client_id: clientId,
        }),
      });
      return response.status === 200;
    } catch {
      return false;
    }
  }
  async cancel(ctx: Context, id: string) {
    await this.scope(ctx);
    const attempt = this.attempt(ctx, id);
    attempt.status = "cancelled";
    this.closeAttempt(attempt);
    await this.dependencies.vault.locked(async (state) => {
      state.epoch++;
    });
    return { cancelled: true };
  }
  private async token(ctx: Context, profileId: string) {
    await this.scope(ctx);
    const result = await this.dependencies.vault.locked(async (state) => {
      const profile = state.profiles.find((p) => p.id === profileId);
      requireCondition(
        profile?.credentials &&
          !profile.reconnectRequired &&
          planPermission(profile.credentials),
        "chatgpt_permission",
        "Sign in and enable ChatGPT plan usage for this connection.",
        403,
      );
      if (profile.credentials.expiresAt <= Date.now() + 60000) {
        requireCondition(
          profile.credentials.refreshToken,
          "chatgpt_reconnect",
          "Reconnect ChatGPT to renew this connection.",
          403,
        );
        let refreshed: Credentials | undefined;
        try {
          refreshed = await exchangeTokens(
            new URLSearchParams({
              grant_type: "refresh_token",
              client_id: profile.clientId,
              refresh_token: profile.credentials.refreshToken,
              resource: responsesOrigin,
            }),
            this.transport,
            profile.credentials,
          );
          if (refreshed.idToken !== profile.credentials.idToken) {
            const identity = await (
              this.dependencies.identity || verifyIdentity
            )(refreshed.idToken, profile.clientId);
            requireCondition(
              identity.subject === profile.subject,
              "chatgpt_identity",
              "ChatGPT renewed a different identity.",
              403,
            );
          }
          requireCondition(
            refreshed.refreshToken,
            "chatgpt_reconnect",
            "ChatGPT did not renew this connection. Sign in again.",
            403,
          );
          if (
            JSON.stringify(profile.credentials.scopes.slice().sort()) !==
            JSON.stringify(refreshed.scopes.slice().sort())
          )
            profile.generation++;
          profile.credentials = refreshed;
          profile.reconnectRequired = false;
          this.modelCache.delete(profileId);
        } catch (error) {
          const failure =
            error instanceof DomainError
              ? error
              : new DomainError(
                  "chatgpt_renewal_uncertain",
                  "ChatGPT token renewal could not be verified. Sign in again before continuing.",
                  503,
                );
          if (
            ["chatgpt_temporary", "chatgpt_configuration"].includes(
              failure.code,
            )
          )
            return { error: failure };
          const revoked = refreshed
            ? await this.revoke(profile.clientId, refreshed)
            : false;
          profile.credentials = undefined;
          profile.reconnectRequired = true;
          profile.revocationUnconfirmed = !revoked;
          profile.generation++;
          profile.lastVerifiedInference = undefined;
          this.modelCache.delete(profileId);
          return { error: failure };
        }
      }
      if (!planPermission(profile.credentials))
        return {
          error: new DomainError(
            "chatgpt_permission",
            "This account is signed in, but ChatGPT plan usage is not enabled. Enable it in Connections before drafting.",
            403,
          ),
        };
      return { profile: structuredClone(profile) };
    });
    if (result.error) throw result.error;
    return result.profile!;
  }
  async models(ctx: Context, profileId: string) {
    const profile = await this.token(ctx, profileId),
      cached = this.modelCache.get(profileId);
    if (cached && Date.now() - cached.fetchedAt < 300000) return cached.models;
    const models = await listModels(profile.credentials!, this.transport);
    this.modelCache.set(profileId, { models, fetchedAt: Date.now() });
    return models;
  }
  async select(ctx: Context, profileId: string) {
    await this.scope(ctx);
    await this.dependencies.vault.locked(async (state) => {
      requireCondition(
        state.profiles.some((p) => p.id === profileId && p.subject),
        "chatgpt_profile",
        "Select a verified ChatGPT connection.",
      );
      state.selectedId = profileId;
      state.epoch++;
    });
    return this.status(ctx);
  }
  async settings(
    ctx: Context,
    profileId: string,
    model: string,
    dailyTokenEstimate: number,
  ) {
    const models = await this.models(ctx, profileId);
    requireCondition(
      models.some((m) => m.slug === model),
      "chatgpt_model",
      "Choose a model available to this ChatGPT account.",
    );
    await this.dependencies.vault.locked(async (state) => {
      const profile = state.profiles.find((p) => p.id === profileId);
      requireCondition(
        profile,
        "chatgpt_profile",
        "Select a saved ChatGPT connection.",
      );
      profile.model = model;
      profile.dailyTokenEstimate = dailyTokenEstimate;
      profile.generation++;
      profile.lastVerifiedInference = undefined;
      state.epoch++;
    });
    return this.status(ctx);
  }
  async disconnect(ctx: Context, profileId: string) {
    await this.scope(ctx);
    this.controllers.get(profileId)?.abort();
    const snapshot = await this.dependencies.vault.locked(async (state) => {
      const profile = state.profiles.find((p) => p.id === profileId);
      requireCondition(
        profile,
        "chatgpt_profile",
        "Select a saved ChatGPT connection.",
      );
      const credentials = profile.credentials
        ? structuredClone(profile.credentials)
        : undefined;
      const uncertain = profile.revocationUnconfirmed;
      profile.credentials = undefined;
      profile.generation++;
      profile.lease = undefined;
      profile.reconnectRequired = true;
      profile.lastVerifiedInference = undefined;
      profile.revocationUnconfirmed = uncertain || !!credentials;
      state.epoch++;
      return {
        credentials,
        uncertain,
        clientId: profile.clientId,
        generation: profile.generation,
      };
    });
    this.modelCache.delete(profileId);
    let revocationConfirmed = !snapshot.credentials && !snapshot.uncertain;
    if (snapshot.credentials?.refreshToken)
      revocationConfirmed = await this.revoke(
        snapshot.clientId,
        snapshot.credentials,
      );
    await this.dependencies.vault.locked(async (state) => {
      const profile = state.profiles.find((p) => p.id === profileId);
      if (
        profile &&
        profile.generation === snapshot.generation &&
        !profile.credentials
      )
        profile.revocationUnconfirmed = !revocationConfirmed;
    });
    return {
      disconnectedLocally: true,
      revocationConfirmed,
      message: revocationConfirmed
        ? "ChatGPT disconnected."
        : "Disconnected on this Mac. Remote revocation was not confirmed; remove MediaFlock in ChatGPT settings to revoke its access.",
    };
  }
  async admittedProfile(ctx: Context) {
    await this.scope(ctx);
    const state = await this.dependencies.vault.read();
    requireCondition(
      state.selectedId,
      "chatgpt_connection",
      "Connect your ChatGPT subscription on this Mac first.",
      503,
    );
    const profile = await this.token(ctx, state.selectedId);
    requireCondition(
      profile.model,
      "chatgpt_model",
      "Choose a ChatGPT model in Connections first.",
    );
    return profile;
  }
  async run<T>(
    ctx: Context,
    profile: Profile,
    input: unknown,
    schema: z.ZodType<T>,
    validate?: (output: T) => void,
  ) {
    await this.scope(ctx);
    const leaseId = randomUUID(),
      controller = new AbortController();
    await this.dependencies.vault.locked(async (state) => {
      const current = state.profiles.find((p) => p.id === profile.id);
      requireCondition(
        current &&
          state.selectedId === profile.id &&
          current.generation === profile.generation &&
          current.credentials &&
          !current.reconnectRequired,
        "chatgpt_changed",
        "The ChatGPT connection changed. Review the selected account before trying again.",
        409,
      );
      requireCondition(
        !current.lease || current.lease.expiresAt < Date.now(),
        "chatgpt_busy",
        "ChatGPT is already processing a request. Wait for it to finish.",
        409,
      );
      current.lease = {
        id: leaseId,
        generation: current.generation,
        expiresAt: Date.now() + 120000,
      };
    });
    this.controllers.set(profile.id, controller);
    let completedUsage: number | undefined;
    try {
      const result = await streamDraft(
        profile.credentials!,
        profile.model,
        input,
        schema,
        this.transport,
        controller.signal,
      );
      completedUsage = result.usedTokens;
      validate?.(result.output);
      await this.scope(ctx);
      await this.dependencies.vault.locked(async (state) => {
        const current = state.profiles.find((p) => p.id === profile.id);
        requireCondition(
          current &&
            state.selectedId === profile.id &&
            current.generation === profile.generation &&
            current.lease?.id === leaseId &&
            current.credentials,
          "chatgpt_changed",
          "The ChatGPT connection changed before this draft completed. Existing content was preserved.",
          409,
        );
        current.lastVerifiedInference = new Date().toISOString();
      });
      return result;
    } catch (error) {
      if (error instanceof InferenceError) throw error;
      throw new InferenceError(
        error instanceof DomainError ? error.code : "chatgpt_invalid",
        error instanceof DomainError
          ? error.message
          : "ChatGPT draft validation failed. Existing content was preserved.",
        completedUsage,
      );
    } finally {
      this.controllers.delete(profile.id);
      await this.dependencies.vault.locked(async (state) => {
        const current = state.profiles.find((p) => p.id === profile.id);
        if (current?.lease?.id === leaseId) current.lease = undefined;
      });
    }
  }
}
let runtime: ChatGPTRuntime | undefined;
export function chatgptRuntime() {
  requireCondition(
    localSubscriptionsEnabled(),
    "chatgpt_local_required",
    "Open MediaFlock on this Mac to use your ChatGPT subscription.",
    403,
  );
  return (runtime ||= new ChatGPTRuntime({
    vault: new LocalVault(),
    available: localSubscriptionsEnabled,
    projectOrigin: () => new URL(getConfig().supabaseUrl).origin,
    checkOwner: async (ctx) => {
      await scoped(ctx, async (tx) => {
        const member = await one(
          tx,
          "select role from memberships where workspace_id=$1 and user_id=$2",
          [ctx.workspaceId, ctx.userId],
        );
        requireCondition(
          member?.role === "owner",
          "chatgpt_local_owner",
          "This connection requires the installed owner.",
          403,
        );
      });
    },
    keyReady: async () => {
      await keychainKey("read");
    },
  }));
}
