import { z } from "zod";
import { writeFile } from "node:fs/promises";
import {
  packageInput,
  variantInput,
  approvalInput,
  experimentInput,
  tokenInput,
  mediaRecipe,
} from "../packages/schemas";
import { capabilityReview } from "../packages/domain/accounts";
import { integrationInput } from "../packages/domain/integrations";
const paths: Record<string, any> = {};
const reference = (name: string) => ({ $ref: "#/components/schemas/" + name });
function op(
  path: string,
  method: string,
  summary: string,
  scope: string,
  schema?: string,
  human = false,
) {
  const params = [
    ...(path.includes("{service}")
      ? [
          {
            name: "service",
            in: "path",
            required: true,
            schema: { type: "string", enum: ["postforme", "openai"] },
          },
        ]
      : []),
    ...(path.includes("{id}")
      ? [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ]
      : []),
  ];
  const item: any = {
    operationId: method + "_" + path.replace(/[^a-zA-Z0-9]/g, "_"),
    summary,
    description: human
      ? "Authenticated human only. API and MCP tokens are rejected."
      : "Required token scope: " + scope,
    security: human
      ? [{ cookieAuth: [] }]
      : [{ bearerAuth: [] }, { cookieAuth: [] }],
    parameters: params,
    responses: {
      "200": {
        description: "Persisted domain result",
        content: {
          "application/json": {
            schema: { type: "object", properties: { data: {} } },
          },
        },
      },
      "400": { description: "Validation failure" },
      "401": { description: "Authentication expired or token revoked" },
      "403": { description: "Scope, workspace, role or CSRF denied" },
      "409": { description: "Revision/state conflict or uncertainty" },
      "429": { description: "Rate limited; Retry-After header" },
      "503": { description: "Exact integration prerequisite unavailable" },
    },
  };
  if (schema)
    item.requestBody = {
      required: true,
      content: { "application/json": { schema: reference(schema) } },
    };
  paths[path] ??= {};
  paths[path][method] = item;
}
op("/accounts", "get", "List accounts and capabilities", "read");
op(
  "/accounts/{id}",
  "get",
  "Read account-specific rules and observations",
  "read",
);
op("/accounts/{id}", "patch", "Update account context", "draft");
op("/accounts/{id}/rules", "post", "Add an explicit account rule", "draft");
op("/packages", "get", "List persisted source packages", "read");
op("/packages", "post", "Create a source package", "draft", "ContentPackage");
op("/packages/{id}", "get", "Get source and account variants", "read");
op(
  "/packages/{id}",
  "patch",
  "Create a new source revision",
  "draft",
  "ContentPackage",
);
op(
  "/packages/{id}/generate",
  "post",
  "Generate labeled account-specific drafts",
  "draft",
);
op(
  "/variants",
  "post",
  "Create account-specific immutable revision",
  "draft",
  "Variant",
);
op(
  "/variants/{id}",
  "patch",
  "Edit with expected current revision ID",
  "draft",
);
op(
  "/variants/{id}/revisions",
  "get",
  "Read immutable revision history",
  "read",
);
op(
  "/variants/{id}/request-approval",
  "post",
  "Request exact-revision human review",
  "request_approval",
  "ApprovalRequest",
);
op("/approvals", "get", "List exact approval snapshots", "read");
for (const action of ["approve", "reject", "revoke"])
  op(
    "/approvals/{id}/" + action,
    "post",
    "Human approval " + action,
    "",
    "Decision",
    true,
  );
op(
  "/approvals/{id}/schedule",
  "post",
  "Queue an approved delivery intent",
  "schedule",
);
op("/publications", "get", "List destination-specific jobs", "read");
op("/publications/{id}", "get", "Inspect job, attempts and receipt", "read");
for (const action of ["cancel", "reschedule", "reconcile"])
  op(
    "/publications/{id}/" + action,
    "post",
    "Request " + action + "; confirmation is separate",
    "schedule",
  );
op(
  "/publications/{id}/metrics",
  "get",
  "Read permitted metric snapshots",
  "analytics",
);
op("/analytics", "get", "Inspect observations and availability", "analytics");
op("/experiments", "get", "List experiments", "read");
op("/experiments", "post", "Create experiment", "draft", "Experiment");
op(
  "/experiments/{id}",
  "get",
  "Read comparison and supporting evidence",
  "read",
);
op(
  "/experiments/{id}/assign",
  "post",
  "Assign exact variant revision",
  "draft",
);
op(
  "/experiments/{id}/evaluate",
  "post",
  "Persist qualified recommendation and evidence",
  "draft",
);
op("/assets", "get", "List private originals and derivatives", "read");
op("/assets/{id}/file", "get", "Read authorized private media bytes", "read");
op(
  "/assets/{id}/process",
  "post",
  "Queue local media processing",
  "draft",
  "MediaRecipe",
);
op(
  "/tokens",
  "post",
  "Create hashed workspace token",
  "",
  "TokenRequest",
  true,
);
op("/tokens/{id}", "delete", "Revoke a workspace token", "", undefined, true);
op(
  "/connections",
  "post",
  "Begin session-bound authorization",
  "",
  undefined,
  true,
);
op(
  "/connections/callback",
  "get",
  "Confirm bound account authorization",
  "",
  undefined,
  true,
);
op("/activity", "get", "Read append-only audit events", "read");
op("/settings", "get", "Read workspace readiness", "read");
op("/settings", "patch", "Update workspace settings", "", undefined, true);
op(
  "/integrations",
  "get",
  "List masked credential and service status",
  "",
  undefined,
  true,
);
for (const service of ["openai", "postforme"]) {
  op(
    "/integrations/" + service,
    "put",
    "Save or rotate encrypted service configuration",
    "",
    "Integration",
    true,
  );
  op(
    "/integrations/" + service,
    "delete",
    "Revoke stored service secret",
    "",
    undefined,
    true,
  );
  op(
    "/integrations/" + service + "/check",
    "post",
    "Inspect configuration readiness; no external call",
    "",
    undefined,
    true,
  );
}
op("/services", "post", "Register a service reference", "", undefined, true);
op(
  "/services/{id}",
  "delete",
  "Remove a service reference",
  "",
  undefined,
  true,
);
paths["/assets"].post = {
  summary: "Validate and store original media privately",
  security: [{ bearerAuth: [] }, { cookieAuth: [] }],
  requestBody: {
    required: true,
    content: {
      "multipart/form-data": {
        schema: {
          type: "object",
          required: ["file"],
          properties: {
            file: { type: "string", format: "binary" },
            tags: { type: "string" },
            notes: { type: "string" },
          },
        },
      },
    },
  },
  responses: {
    "201": { description: "Original stored with metadata and checksum" },
  },
};
op(
  "/accounts/{id}/permissions",
  "post",
  "Record generation-bound owner permission evidence",
  "",
  "CapabilityReview",
  true,
);
op(
  "/connections/health",
  "get",
  "Verify private backend availability",
  "",
  undefined,
  true,
);
op(
  "/integrations/{service}/check",
  "post",
  "Authenticated read-only service check",
  "",
  undefined,
  true,
);
const spec = {
  openapi: "3.1.0",
  info: {
    title: "MediaFlock API",
    version: "0.1.0",
    description:
      "Workspace-scoped distribution harness. Cookie-authenticated writes require same-origin and x-mediaflock-csrf. Machine credentials cannot approve. Simulated records cannot enter live publishing.",
  },
  servers: [
    {
      url: "http://127.0.0.1:3210/api/v1",
      description: "Private personal service",
    },
  ],
  paths,
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        description: "Hashed, scoped, expiring workspace API token.",
      },
      cookieAuth: {
        type: "apiKey",
        in: "cookie",
        name: "Supabase SSR auth cookies",
        description:
          "Verified Supabase session; writes require CSRF token and same Origin.",
      },
    },
    schemas: Object.fromEntries(
      Object.entries({
        CapabilityReview: capabilityReview,
        Integration: integrationInput,
        ContentPackage: packageInput,
        Variant: variantInput,
        ApprovalRequest: approvalInput,
        Experiment: experimentInput,
        TokenRequest: tokenInput,
        MediaRecipe: mediaRecipe,
        Decision: z.object({ reason: z.string().max(2000).optional() }),
      }).map(([name, schema]) => [
        name,
        z.toJSONSchema(schema, { target: "draft-2020-12" }),
      ]),
    ),
  },
};
await writeFile("docs/openapi.json", JSON.stringify(spec, null, 2) + "\n");
console.log("OpenAPI specification generated.");
