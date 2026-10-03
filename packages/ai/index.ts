import { z } from "zod";
import { writingGuidance } from "./writing-guidance";
import { getConfig } from "../domain/config";
import { authorize } from "../domain/auth";
import { requireCondition } from "../domain/errors";
import { db, scoped, one, type Context } from "../db";
import { chatgptRuntime } from "../chatgpt/runtime";
import { InferenceError } from "../chatgpt/protocol";
import { accountContext, getPackage, createVariant } from "../domain/content";
import { postMetrics } from "../analytics";
import { experimentResults } from "../experiments";
const variantOutput = z.object({
  hook: z.string().max(300),
  caption: z.string().max(10000),
  title: z.string().max(120),
  description: z.string().max(10000),
  cta: z.string().max(500),
});
const hooksOutput = z.object({
  hooks: z.array(z.string().max(300)).min(1).max(5),
});
const summaryOutput = z.object({
  summary: z.string().max(3000),
  evidenceIds: z.array(z.uuid()).max(100),
  limitations: z.string().max(2000),
});
const nextOutput = z.object({
  hypothesis: z.string().max(2000),
  changedVariable: z.enum(["hook", "format", "cta", "publishing_window"]),
  nextAction: z.string().max(2000),
  evidenceIds: z.array(z.uuid()).max(100),
  limitations: z.string().max(2000),
});
const observationOutput = z.object({
  observation: z.string().max(2000),
  evidenceIds: z.array(z.uuid()).min(1).max(100),
  limitations: z.string().max(2000),
});
export interface AIBackend {
  run<T>(
    ctx: Context,
    operation: string,
    input: Record<string, any>,
    schema: z.ZodType<T>,
  ): Promise<{ output: T; provenance: "demo_ai" | "openai"; label: string }>;
}
export class DeterministicDemoAI implements AIBackend {
  async run<T>(
    _ctx: Context,
    operation: string,
    input: Record<string, any>,
    schema: z.ZodType<T>,
  ) {
    requireCondition(
      getConfig().mode === "demo",
      "demo_only",
      "Fixture AI is unavailable in live mode.",
    );
    const brief = String(
      input.brief || "A practical look at the creative process",
    ).slice(0, 350);
    let output: unknown;
    if (operation === "variants") {
      const rule = input.rules?.map((x: any) => x.text).join(" ") || "";
      const simple = brief.split(/[.!?]\s/)[0];
      output = {
        hook:
          input.platform === "linkedin"
            ? "A practical lesson from this project."
            : "One small change. A clearer result.",
        caption: `${simple}\n\n${input.platform === "x" ? "A short, useful observation to test." : "Here is the process, the decision, and what we would test next."}${rule.toLowerCase().includes("no hashtag") ? "" : " #CreativeProcess"}`,
        title: simple.slice(0, 90),
        description: `${brief}\n\nA local MediaFlock example.`,
        cta:
          input.platform === "youtube"
            ? "See the full process."
            : "Which part would you try?",
      };
    } else if (operation === "hooks")
      output = {
        hooks: [
          "One small change. A clearer result.",
          "The part of the process we nearly skipped.",
          "A practical lesson in under a minute.",
        ],
      };
    else if (operation === "summarize")
      output = {
        summary: `${input.observations.length} supplied observations reviewed. Available metrics are listed in the evidence; missing values remain unavailable.`,
        evidenceIds: input.observations.map((x: any) => x.id),
        limitations:
          "Simulated example data; descriptive observations do not establish causation.",
      };
    else if (operation === "next_experiment")
      output = {
        hypothesis:
          "A concrete opening may be associated with a different median view count at the same observation horizon.",
        changedVariable: "hook",
        nextAction: input.comparison.nextAction,
        evidenceIds: input.evidence.map((x: any) => x.id),
        limitations: input.comparison.limitations,
      };
    else
      output = {
        observation:
          "Consider testing a concrete opening again before treating the observed difference as a writing rule.",
        evidenceIds: input.evidence.map((x: any) => x.id),
        limitations:
          "Proposed only; small, observational, simulated sample. Requires user acceptance.",
      };
    return {
      output: schema.parse(output),
      provenance: "demo_ai" as const,
      label: "Deterministic demo AI · fixture response · no model call",
    };
  }
}
export class ChatGPTSubscriptionBackend implements AIBackend {
  async run<T>(
    ctx: Context,
    operation: string,
    input: Record<string, any>,
    schema: z.ZodType<T>,
  ) {
    const runtime = chatgptRuntime(),
      profile = await runtime.admittedProfile(ctx);
    const encoded = JSON.stringify(input);
    requireCondition(
      encoded.length <= 24000,
      "ai_context_size",
      "Reduce the source/context to 24,000 characters.",
    );
    // Admission estimate only. The plan flow has no provider token-limit field.
    const reserve = Buffer.byteLength(encoded, "utf8") + 11000;
    const trackedOperation = `subscription:${profile.id}:${operation}`;
    const usage = await scoped(ctx, async (tx) => {
      await tx.query("select id from workspaces where id=$1 for update", [
        ctx.workspaceId,
      ]);
      const used = await one(
        tx,
        "select coalesce(sum(coalesce(used_tokens,reserved_tokens)),0)::int as n from ai_usage where workspace_id=$1 and operation like $2 and created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'",
        [ctx.workspaceId, `subscription:${profile.id}:%`],
      );
      requireCondition(
        used!.n + reserve <= profile.dailyTokenEstimate,
        "ai_ceiling",
        "The local daily usage estimate has been reached. Manage your actual allowance in ChatGPT or continue editing manually.",
        429,
      );
      return one(
        tx,
        "insert into ai_usage(workspace_id,operation,model,reserved_tokens,state) values($1,$2,$3,$4,'reserved') returning id",
        [ctx.workspaceId, trackedOperation, profile.model, reserve],
      );
    });
    let usedTokens: number | undefined;
    // This closure settles only the server-created reservation, including after
    // logout. It cannot authorize content writes or read any other usage row.
    const settle = async (state: "complete" | "failed") => {
      await db().query(
        "update ai_usage set state=$1,used_tokens=$2 where id=$3 and workspace_id=$4 and operation=$5 and state='reserved'",
        [
          state,
          usedTokens ?? null,
          usage!.id,
          ctx.workspaceId,
          trackedOperation,
        ],
      );
    };
    try {
      const evidence = new Set(
        (input.evidence || input.observations || []).map((x: any) => x.id),
      );
      const result = await runtime.run(
        ctx,
        profile,
        { operation, context: input },
        schema,
        (output) => {
          if (output && typeof output === "object" && "evidenceIds" in output)
            requireCondition(
              (output as any).evidenceIds.every((id: string) =>
                evidence.has(id),
              ),
              "ai_evidence",
              "ChatGPT referenced an unknown evidence record. Existing content was preserved.",
              503,
            );
        },
      );
      usedTokens = result.usedTokens;
      const output = result.output;
      await settle("complete");
      return {
        output,
        provenance: "openai" as const,
        label: `ChatGPT subscription draft · ${profile.model}${usedTokens === undefined ? " · usage unavailable" : ""}`,
      };
    } catch (error) {
      if (error instanceof InferenceError) usedTokens = error.usedTokens;
      await settle("failed");
      throw error;
    }
  }
}
export function aiBackend(): AIBackend {
  return getConfig().mode === "demo"
    ? new DeterministicDemoAI()
    : new ChatGPTSubscriptionBackend();
}
export async function generateVariants(
  ctx: Context,
  packageId: string,
  selections: { accountId: string; format: string }[],
) {
  authorize(ctx, "draft");
  requireCondition(
    selections.length > 0 && selections.length <= 10,
    "selection",
    "Select one to ten destinations.",
  );
  const pkg = await getPackage(ctx, packageId);
  const backend = aiBackend();
  const variants = [];
  for (const s of selections) {
    const data = await accountContext(ctx, s.accountId);
    const generated = await backend.run(
      ctx,
      "variants",
      {
        brief: pkg.brief,
        sourceNotes: pkg.source_notes,
        platform: data.account.platform,
        format: s.format,
        writingGuidance: writingGuidance(data.account.platform, s.format),
        audience: data.account.audience,
        guidelines: data.account.writing_guidelines,
        rules: data.rules,
        observations: data.observations.filter((x) => x.status === "accepted"),
      },
      variantOutput,
    );
    variants.push(
      await createVariant(
        ctx,
        {
          packageId,
          accountId: s.accountId,
          format: s.format,
          payload: {
            ...generated.output,
            visibility: "public",
            settings: {},
            media: pkg.assets.map((x) => ({
              assetId: x.id,
              derivativeId: null,
            })),
            utm: "",
          },
        },
        generated.provenance,
      ),
    );
  }
  return {
    variants,
    label:
      getConfig().mode === "demo"
        ? "Deterministic demo AI · fixture responses · no model calls"
        : "OpenAI generated drafts; review required",
  };
}
export async function suggestHooks(
  ctx: Context,
  accountId: string,
  brief: string,
) {
  authorize(ctx, "draft");
  const context = await accountContext(ctx, accountId);
  return aiBackend().run(
    ctx,
    "hooks",
    {
      brief,
      rules: context.rules,
      platform: context.account.platform,
      writingGuidance: writingGuidance(context.account.platform, "hook"),
    },
    hooksOutput,
  );
}
export async function summarizePost(ctx: Context, jobId: string) {
  authorize(ctx, "analytics");
  const observations = await postMetrics(ctx, jobId);
  return aiBackend().run(ctx, "summarize", { observations }, summaryOutput);
}
export async function suggestExperiment(ctx: Context, id: string) {
  authorize(ctx, "analytics");
  const result = await experimentResults(ctx, id);
  return aiBackend().run(
    ctx,
    "next_experiment",
    { comparison: result.comparison, evidence: result.evidence },
    nextOutput,
  );
}
export async function draftObservation(
  ctx: Context,
  id: string,
  accountId: string,
) {
  authorize(ctx, "draft");
  const result = await experimentResults(ctx, id);
  const evidence = result.evidence.filter((x) => x.account_id === accountId);
  requireCondition(
    evidence.length > 0,
    "no_evidence",
    "No observations support a proposal for this account.",
  );
  return aiBackend().run(
    ctx,
    "observation",
    { evidence, accountId, comparison: result.comparison },
    observationOutput,
  );
}
