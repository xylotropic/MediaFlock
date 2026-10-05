import * as voice from "../voice";
import { boundedBody } from "../security";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { openSync } from "node:fs";
import { resolve } from "node:path";
import { scoped, one, audit, type Context } from "../db";
import {
  requestContext,
  authClient,
  storageAdmin,
  createToken,
  revokeToken,
  authorize,
  humanReviewer,
} from "./auth";
import { getConfig } from "./config";
import {
  DomainError,
  requireCondition,
  publicError,
  safeError,
} from "./errors";
import * as domain from "./index";
import * as experiments from "../experiments";
import * as ai from "../ai";
import * as integrations from "./integrations";
import * as media from "../media";
import * as uploads from "../media/uploads";
import * as analytics from "../analytics";
import { id, platform } from "../schemas";
import { verifiedSessionId } from "./session-security";
import { chatgptRuntime } from "../chatgpt/runtime";
import { localSubscriptionsEnabled } from "../chatgpt/local-vault";
export async function dispatch(
  ctx: Context,
  method: string,
  path: string[],
  body: any = {},
  query = new URLSearchParams(),
): Promise<any> {
  const [root, resource, action] = path;
  if (
    resource &&
    !["connections", "integrations", "subscriptions", "voice"].includes(root)
  )
    id.parse(resource);
  if (root === "subscriptions" && resource === "chatgpt") {
    integrations.credentialOwner(ctx);
    if (!action && method === "GET" && !localSubscriptionsEnabled())
      return {
        available: false,
        localUrl: "http://127.0.0.1:3210/app?screen=connections",
        message: "Use your ChatGPT subscription in MediaFlock on this Mac.",
        profiles: [],
        selectedId: null,
      };
    const runtime = chatgptRuntime();
    if (!action && method === "GET") return runtime.status(ctx);
    if (action === "begin" && method === "POST") {
      const input = z
        .object({
          profileId: z.uuid().optional(),
          enablePlanUsage: z.boolean().default(false),
        })
        .parse(body);
      return runtime.begin(ctx, input.profileId, input.enablePlanUsage);
    }
    if (["attempt", "finalize", "cancel"].includes(action)) {
      const input = z
        .object({ attemptId: z.uuid() })
        .parse(method === "GET" ? Object.fromEntries(query) : body);
      if (action === "attempt" && method === "GET")
        return runtime.attemptStatus(ctx, input.attemptId);
      if (action === "finalize" && method === "POST")
        return runtime.finalize(ctx, input.attemptId);
      if (action === "cancel" && method === "POST")
        return runtime.cancel(ctx, input.attemptId);
    }
    const input = z
      .object({ profileId: z.uuid() })
      .parse(method === "GET" ? Object.fromEntries(query) : body);
    if (action === "models" && method === "GET")
      return runtime.models(ctx, input.profileId);
    if (action === "select" && method === "POST")
      return runtime.select(ctx, input.profileId);
    if (action === "disconnect" && method === "POST")
      return runtime.disconnect(ctx, input.profileId);
    if (action === "settings" && method === "PUT") {
      const settings = z
        .object({
          model: z.string().min(1).max(100),
          dailyTokenEstimate: z.number().int().min(1000).max(1000000),
        })
        .parse(body);
      return runtime.settings(
        ctx,
        input.profileId,
        settings.model,
        settings.dailyTokenEstimate,
      );
    }
    throw new DomainError(
      "not_found",
      "This connection action was not found.",
      404,
    );
  }
  if (root === "voice" && resource === "status" && method === "GET")
    return voice.voiceStatus(ctx);
  if (root === "voice" && resource === "check" && method === "POST")
    return voice.checkVoiceAccount(ctx);
  if (root === "voice" && resource === "acknowledge" && method === "POST")
    return voice.acknowledgeVoice(ctx, z.uuid().parse(body.requestId));
  if (root === "ideas" && method === "POST" && !resource)
    return ai.polishIdea(ctx, z.string().min(1).max(10000).parse(body.text));
  if (root === "password" && method === "POST") {
    integrations.credentialOwner(ctx);
    const input = z
      .object({
        currentPassword: z.string().min(1).max(200),
        newPassword: z.string().min(12).max(200),
      })
      .parse(body);
    const auth = await authClient({ timeoutMs: 10000 });
    const {
      data: { user },
    } = await auth.auth.getUser();
    requireCondition(
      user?.email && user.id === ctx.userId,
      "authentication_required",
      "Sign in again before changing your password.",
      401,
    );
    const verified = await auth.auth.signInWithPassword({
      email: user.email,
      password: input.currentPassword,
    });
    requireCondition(
      !verified.error && verified.data.session,
      "password_rejected",
      "Current password was not accepted.",
      400,
    );
    const freshUser = await auth.auth.getUser();
    requireCondition(
      !freshUser.error && freshUser.data.user?.id === ctx.userId,
      "authentication_required",
      "Sign in again before changing your password.",
      401,
    );
    const freshCtx = {
      ...ctx,
      authSessionId: verifiedSessionId(
        verified.data.session!.access_token,
        freshUser.data.user.id,
      ),
    };
    await scoped(freshCtx, async (tx) => {
      const changed = await auth.auth.updateUser({
        password: input.newPassword,
      });
      if (
        changed.error &&
        (!changed.error.status ||
          changed.error.status >= 500 ||
          changed.error.status === 408)
      )
        throw new DomainError(
          "password_change_uncertain",
          "The password change could not be confirmed. Try signing in with your new password before trying again.",
          503,
        );
      requireCondition(
        !changed.error,
        "password_change_failed",
        "Password could not be changed.",
        400,
      );
      await audit(
        tx,
        freshCtx,
        "account.password_changed",
        "membership",
        ctx.userId,
      );
    });
    return { changed: true };
  }
  if (root === "connections" && resource === "health" && method === "GET") {
    integrations.credentialOwner(ctx);
    const buckets = await storageAdmin().storage.listBuckets();
    const bucket = buckets.data?.find((x) => x.id === "mediaflock");
    return {
      backend:
        !buckets.error && bucket && !bucket.public
          ? "connected"
          : "unavailable",
    };
  }
  if (root === "overview" && method === "GET") return domain.overview(ctx);
  if (root === "accounts") {
    if (!resource && method === "GET") return domain.listAccounts(ctx);
    if (resource && !action && method === "GET")
      return domain.accountContext(ctx, resource);
    if (resource && !action && method === "PATCH")
      return domain.updateAccount(
        ctx,
        resource,
        z
          .object({
            audience: z.string().max(2000).optional(),
            writingGuidelines: z.string().max(3000).optional(),
            timezone: z.string().max(100).optional(),
            postingPreferences: z.record(z.string(), z.unknown()).optional(),
          })
          .parse(body),
      );
    if (action === "rules" && method === "POST")
      return domain.addAccountRule(
        ctx,
        resource,
        z.string().min(1).max(2000).parse(body.text),
      );
    if (action === "permissions" && method === "POST")
      return domain.recordCapabilityReview(ctx, resource, body);
    if (action === "disconnect" && method === "POST")
      return domain.disconnectAccount(ctx, resource);
    if (action === "simulate-reconnect" && method === "POST")
      return domain.simulateReconnect(ctx, resource);
  }
  if (root === "connections" && method === "POST" && !resource)
    return domain.beginConnection(
      ctx,
      platform.parse(body.platform),
      z
        .enum([
          "instagram",
          "facebook",
          "organization",
          "personal",
          "oauth1",
          "oauth2",
        ])
        .optional()
        .parse(body.connectionType),
    );
  if (root === "packages") {
    if (!resource && method === "GET") return domain.listPackages(ctx);
    if (!resource && method === "POST") return domain.createPackage(ctx, body);
    if (resource && !action && method === "GET")
      return domain.getPackage(ctx, resource);
    if (resource && !action && method === "PATCH")
      return domain.updatePackage(ctx, resource, body);
    if (action === "generate" && method === "POST")
      return ai.generateVariants(
        ctx,
        resource,
        z
          .array(z.object({ accountId: id, format: z.string().max(40) }))
          .min(1)
          .max(10)
          .parse(body.selections),
      );
  }
  if (root === "variants") {
    if (!resource && method === "POST") return domain.createVariant(ctx, body);
    if (resource && !action && method === "PATCH")
      return domain.editVariant(
        ctx,
        resource,
        id.parse(body.expectedRevisionId),
        body.payload,
      );
    if (action === "revisions" && method === "GET")
      return domain.listRevisions(ctx, resource);
    if (action === "request-approval" && method === "POST")
      return domain.requestApproval(ctx, { ...body, variantId: resource });
  }
  if (root === "approvals") {
    if (!resource && method === "GET") return domain.listApprovals(ctx);
    if (action === "approve" && method === "POST")
      return domain.decideApproval(ctx, resource, "approved");
    if (action === "reject" && method === "POST")
      return domain.decideApproval(
        ctx,
        resource,
        "rejected",
        z
          .string()
          .max(2000)
          .parse(body.reason || ""),
      );
    if (action === "revoke" && method === "POST")
      return domain.revokeApproval(
        ctx,
        resource,
        z
          .string()
          .max(2000)
          .parse(body.reason || "Approval revoked by reviewer"),
      );
    if (action === "schedule" && method === "POST")
      return domain.scheduleApproved(ctx, resource);
  }
  if (root === "publications") {
    if (!resource && method === "GET") return domain.listJobs(ctx);
    if (resource && !action && method === "GET")
      return domain.getJob(ctx, resource);
    if (action === "cancel" && method === "POST")
      return domain.cancelJob(ctx, resource);
    if (action === "reconcile" && method === "POST")
      return domain.requestReconciliation(ctx, resource);
    if (action === "reschedule" && method === "POST")
      return domain.rescheduleJob(
        ctx,
        resource,
        z.iso.datetime({ offset: true }).parse(body.scheduledAt),
      );
    if (action === "metrics" && method === "GET")
      return analytics.postMetrics(ctx, resource);
    if (action === "collect-demo" && method === "POST")
      return analytics.collectDemoNow(ctx, resource);
  }
  if (root === "assets") {
    if (!resource && method === "GET") return media.listAssets(ctx);
    if (action === "process" && method === "POST")
      return media.requestDerivative(ctx, resource, body);
    if (resource && !action && method === "PATCH") {
      authorize(ctx, "draft");
      const data = z
        .object({
          tags: z.array(z.string().max(50)).max(20),
          notes: z.string().max(5000),
        })
        .parse(body);
      return scoped(ctx, async (tx) => {
        const asset = await one(
          tx,
          "update assets set tags=$1,notes=$2 where id=$3 and workspace_id=$4 returning *",
          [data.tags, data.notes, resource, ctx.workspaceId],
        );
        requireCondition(asset, "not_found", "Asset not found.", 404);
        await audit(tx, ctx, "asset.metadata_updated", "asset", resource);
        return asset;
      });
    }
  }
  if (root === "asset-uploads") {
    if (!resource && method === "POST")
      return uploads.beginAssetUpload(ctx, body);
    if (resource && !action && method === "GET")
      return uploads.getAssetUpload(ctx, resource);
    if (resource && action === "complete" && method === "POST")
      return uploads.completeAssetUpload(ctx, resource);
  }
  if (root === "analytics" && method === "GET")
    return analytics.getAnalytics(
      ctx,
      query.get("accountId") || undefined,
      query.has("start") && query.has("end")
        ? {
            start: z.iso.datetime({ offset: true }).parse(query.get("start")),
            end: z.iso.datetime({ offset: true }).parse(query.get("end")),
          }
        : undefined,
    );
  if (root === "experiments") {
    if (!resource && method === "GET") return experiments.listExperiments(ctx);
    if (!resource && method === "POST")
      return experiments.createExperiment(ctx, body);
    if (resource && !action && method === "GET")
      return experiments.experimentResults(ctx, resource);
    if (action === "assign" && method === "POST")
      return experiments.assignVariant(
        ctx,
        resource,
        id.parse(body.variantId),
        id.parse(body.revisionId),
        z.enum(["A", "B"]).parse(body.arm),
      );
    if (action === "evaluate" && method === "POST")
      return experiments.saveRecommendation(ctx, resource);
    if (action === "suggest" && method === "POST")
      return ai.suggestExperiment(ctx, resource);
    if (action === "observation" && method === "POST") {
      const data = z
        .object({
          accountId: id,
          insightId: id,
          text: z.string().min(1).max(2000),
        })
        .parse(body);
      return experiments.proposeObservation(
        ctx,
        data.accountId,
        data.insightId,
        data.text,
      );
    }
  }
  if (root === "observations" && action === "accept" && method === "POST")
    return experiments.acceptObservation(ctx, resource);
  if (root === "ai" && method === "POST") {
    const operation = z
      .enum(["hooks", "summarize", "observation"])
      .parse(body.operation);
    if (operation === "hooks")
      return ai.suggestHooks(
        ctx,
        id.parse(body.accountId),
        z.string().max(10000).parse(body.brief),
      );
    if (operation === "summarize")
      return ai.summarizePost(ctx, id.parse(body.jobId));
    return ai.draftObservation(
      ctx,
      id.parse(body.experimentId),
      id.parse(body.accountId),
    );
  }
  if (root === "integrations") {
    if (!resource && method === "GET")
      return integrations.listIntegrations(ctx);
    if (resource && !action && method === "PUT")
      return integrations.saveIntegration(
        ctx,
        z.enum(["postforme", "elevenlabs"]).parse(resource),
        body,
      );
    if (resource && !action && method === "DELETE")
      return integrations.removeIntegration(
        ctx,
        z.enum(["openai", "postforme", "elevenlabs"]).parse(resource),
      );
    if (resource && action === "check" && method === "POST")
      return integrations.checkIntegration(
        ctx,
        z.literal("postforme").parse(resource),
      );
  }
  if (root === "services") {
    if (!resource && method === "POST")
      return integrations.addService(ctx, body);
    if (resource && method === "DELETE")
      return integrations.removeService(ctx, resource);
  }
  if (root === "activity" && method === "GET") return domain.activity(ctx);
  if (root === "settings" && method === "GET") return domain.settings(ctx);
  if (root === "settings" && method === "PATCH")
    return domain.updateWorkspace(
      ctx,
      z.string().min(1).max(100).parse(body.name),
      z.string().max(100).parse(body.timezone),
    );
  if (root === "tokens") {
    if (!resource && method === "POST") return createToken(ctx, body);
    if (resource && method === "DELETE") return revokeToken(ctx, resource);
  }
  if (root === "worker" && method === "POST") {
    humanReviewer(ctx);
    requireCondition(
      getConfig().mode === "demo",
      "demo_only",
      "Start the live worker explicitly from its dedicated runtime.",
      403,
    );
    const log = resolve(process.cwd(), "artifacts/logs/worker-once.log"),
      fd = openSync(log, "a", 0o600);
    const child = spawn(
      process.execPath,
      [
        resolve(process.cwd(), "node_modules/tsx/dist/cli.mjs"),
        resolve(process.cwd(), "apps/worker/main.ts"),
        "--once",
      ],
      {
        cwd: process.cwd(),
        detached: true,
        stdio: ["ignore", fd, fd],
        env: { ...process.env },
      },
    );
    child.unref();
    return {
      started: true,
      pid: child.pid,
      message:
        "Independent local worker started. Inspect Activity for confirmed results.",
    };
  }
  if (root === "time" && method === "POST")
    return {
      utc: domain.localToUtc(
        z.string().parse(body.local),
        z.string().parse(body.timezone),
        z
          .enum(["reject", "earlier", "later"])
          .parse(body.disambiguation || "reject"),
      ),
    };
  throw new DomainError("not_found", "API operation not found.", 404);
}
export async function handleApi(req: Request, path: string[]) {
  try {
    const ctx = await requestContext(req);
    const url = new URL(req.url);
    let body: any = {};
    if (
      path[0] === "connections" &&
      path[1] === "callback" &&
      req.method === "GET"
    ) {
      const { cookies } = await import("next/headers");
      const jar = await cookies();
      requireCondition(
        !url.searchParams.has("code") && !url.searchParams.has("oauth_token"),
        "callback_stage",
        "Native OAuth responses must complete at Post for Me before returning here.",
        403,
      );
      const state = jar.get("mf_oauth_state")?.value || "";
      requireCondition(
        state && jar.get("mf_oauth_state")?.value === state,
        "oauth_binding",
        "Authorization callback does not match this browser.",
        403,
      );
      const result = await domain.finishConnection(ctx, state, undefined, true);
      // Keep the short-lived cookie: a delayed callback must not clear a newer attempt.
      // Completed attempts return stored results without reapplying authorization.
      return Response.redirect(
        getConfig().origin + "/?screen=accounts&connected=" + result!.id,
        303,
      );
    }
    if (
      path[0] === "assets" &&
      path[1] &&
      path[2] === "file" &&
      req.method === "GET"
    ) {
      const signedUrl = await uploads.assetDownloadUrl(
        ctx,
        id.parse(path[1]),
        url.searchParams.get("derivative") === "true",
      );
      return new Response(null, {
        status: 307,
        headers: {
          Location: signedUrl,
          "Cache-Control": "private, no-store",
          "Referrer-Policy": "no-referrer",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    if (path[0] === "assets" && !path[1] && req.method === "POST") {
      requireCondition(
        !process.env.VERCEL,
        "direct_upload_required",
        "Upload directly to private storage through /api/v1/asset-uploads on this server.",
        400,
      );
      requireCondition(
        Number(req.headers.get("content-length") || 0) <= 54 * 1024 * 1024,
        "file_size",
        "Upload must be 50 MiB or smaller.",
      );
      const bounded = await boundedBody(req, 54 * 1024 * 1024);
      const form = await new Response(bounded, {
        headers: { "Content-Type": req.headers.get("content-type") || "" },
      }).formData();
      const file = form.get("file");
      requireCondition(
        file instanceof File,
        "file_required",
        "Select an image or video.",
      );
      const data = await media.uploadAsset(
        ctx,
        file.name,
        Buffer.from(await file.arrayBuffer()),
        z
          .array(z.string().max(50))
          .max(20)
          .parse(
            String(form.get("tags") || "")
              .split(",")
              .map((x) => x.trim())
              .filter(Boolean),
          ),
        z
          .string()
          .max(5000)
          .parse(String(form.get("notes") || "")),
      );
      return Response.json({ data }, { status: 201 });
    }
    if (!["GET", "HEAD", "DELETE"].includes(req.method)) {
      requireCondition(
        Number(req.headers.get("content-length") || 0) <= 100000,
        "request_size",
        "Request body too large.",
      );
      const bytes = await boundedBody(req, 100000);
      try {
        body = JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        throw new DomainError(
          "invalid_json",
          "Provide a valid JSON body.",
          400,
        );
      }
    }
    const result = await dispatch(
      ctx,
      req.method,
      path,
      body,
      url.searchParams,
    );
    if (path[0] === "connections" && req.method === "POST") {
      const { cookies } = await import("next/headers");
      (await cookies()).set("mf_oauth_state", result.state, {
        httpOnly: true,
        secure: getConfig().secureCookies,
        sameSite: "lax",
        maxAge: 900,
        path: "/api/v1/connections/callback",
      });
      delete result.state;
    }
    return Response.json(
      { data: result },
      {
        headers: { "Cache-Control": "no-store", "X-Request-Id": randomUUID() },
      },
    );
  } catch (e) {
    if (e instanceof z.ZodError)
      return Response.json(
        {
          error: {
            code: "validation_error",
            message: e.issues
              .map((x) => `${x.path.join(".") || "Input"}: ${x.message}`)
              .join("; "),
          },
        },
        { status: 400 },
      );
    console.error(
      path[0] === "subscriptions"
        ? "Subscription request failed: " +
            (e instanceof DomainError ? e.code : "invalid_response")
        : safeError(e),
    );
    return Response.json(
      { error: publicError(e) },
      {
        status: e instanceof DomainError ? e.status : 500,
        headers:
          e instanceof DomainError && e.status === 429
            ? { "Retry-After": "60" }
            : undefined,
      },
    );
  }
}
