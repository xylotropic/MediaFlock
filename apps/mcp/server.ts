import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { tokenContext } from "../../packages/domain/auth";
import { publicError } from "../../packages/domain/errors";
import * as domain from "../../packages/domain";
import { postMetrics } from "../../packages/analytics";
import {
  createExperiment,
  experimentResults,
} from "../../packages/experiments";
import {
  packageInput,
  variantInput,
  experimentInput,
  id,
} from "../../packages/schemas";
import type { Context } from "../../packages/db";
export function createMcpServer(secret: string) {
  const server = new McpServer(
    { name: "MediaFlock", version: "0.1.0" },
    {
      instructions:
        "Workspace-scoped organic distribution harness. Draft and request human approval; never approve your own content. Approval binds an immutable revision, account, media, visibility and time. Scheduling requires scope plus a valid human approval. Simulated receipts and metrics are explicitly labeled; do not claim real publication or causality. Unknown provider outcomes require reconciliation. Tokens are checked on every call.",
    },
  );
  function tool(
    name: string,
    description: string,
    schema: z.ZodObject<any>,
    fn: (ctx: Context, args: any) => Promise<any>,
    readOnly = false,
  ) {
    server.registerTool(
      name,
      {
        description,
        inputSchema: schema.shape,
        annotations: {
          readOnlyHint: readOnly,
          destructiveHint: false,
          idempotentHint: readOnly,
          openWorldHint: false,
        },
      },
      async (args: any) => {
        try {
          const ctx = await tokenContext(secret);
          const result = await fn(ctx, args);
          return {
            content: [
              { type: "text" as const, text: JSON.stringify({ data: result }) },
            ],
          };
        } catch (e) {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({ error: publicError(e) }),
              },
            ],
          };
        }
      },
    );
  }
  tool(
    "list_accounts",
    "List accessible accounts, connection status, formats and capability evidence.",
    z.object({}),
    (ctx) => domain.listAccounts(ctx),
    true,
  );
  tool(
    "get_account_capabilities",
    "Read an account’s verified capabilities; unknown is never supported.",
    z.object({ account_id: id }),
    async (ctx, args) => {
      const a = await domain.getAccount(ctx, args.account_id);
      return {
        accountId: a.id,
        platform: a.platform,
        accountType: a.account_type,
        status: a.status,
        capabilities: a.capabilities,
        provenance: a.provenance,
      };
    },
    true,
  );
  tool(
    "create_content_package",
    "Persist source material, brief, tags and original asset associations.",
    packageInput,
    (ctx, args) => domain.createPackage(ctx, args),
  );
  tool(
    "create_variant",
    "Create an immutable account-specific draft revision. No approval or publishing authority.",
    variantInput,
    (ctx, args) => domain.createVariant(ctx, args),
  );
  tool(
    "request_approval",
    "Request human review of an exact current revision, destination and UTC schedule.",
    z.object({
      variant_id: id,
      revision_id: id,
      scheduled_at: z.iso.datetime({ offset: true }),
    }),
    (ctx, args) =>
      domain.requestApproval(ctx, {
        variantId: args.variant_id,
        revisionId: args.revision_id,
        scheduledAt: args.scheduled_at,
      }),
  );
  tool(
    "schedule_approved_variant",
    "Queue only a current, human-approved snapshot. Requires schedule scope; acceptance is not publication.",
    z.object({ approval_id: id }),
    (ctx, args) => domain.scheduleApproved(ctx, args.approval_id),
  );
  tool(
    "get_publication_status",
    "Inspect delivery state, uncertainty, receipt and durable attempts.",
    z.object({ job_id: id }),
    (ctx, args) => domain.getJob(ctx, args.job_id),
    true,
  );
  tool(
    "get_post_metrics",
    "Read permitted metric snapshots with definitions, horizons, availability and provenance. Requires analytics scope.",
    z.object({ job_id: id }),
    (ctx, args) => postMetrics(ctx, args.job_id),
    true,
  );
  tool(
    "create_experiment",
    "Persist an observational experiment, sample requirements and eligible account/format cohorts.",
    experimentInput,
    (ctx, args) => createExperiment(ctx, args),
  );
  tool(
    "get_experiment_results",
    "Read matched comparisons, evidence and limitations; insufficient evidence is explicit.",
    z.object({ experiment_id: id }),
    (ctx, args) => experimentResults(ctx, args.experiment_id),
    true,
  );
  return server;
}
