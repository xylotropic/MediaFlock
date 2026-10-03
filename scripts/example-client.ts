import { config } from "dotenv";
config({ quiet: true });
const origin = process.env.APP_ORIGIN || "http://127.0.0.1:3210",
  token = process.env.MEDIAFLOCK_API_TOKEN;
if (!token)
  throw new Error(
    "Create a workspace API token in Administration and set MEDIAFLOCK_API_TOKEN. This client never approves or publishes.",
  );
async function api(path: string, method = "GET", body?: unknown) {
  const r = await fetch(origin + "/api/v1/" + path, {
    method,
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(result.error));
  return result.data;
}
const accounts = await api("accounts");
console.log(
  "Accounts:",
  accounts.map((a: any) => ({
    id: a.id,
    platform: a.platform,
    handle: a.handle,
    status: a.status,
    provenance: a.provenance,
  })),
);
if (process.argv.includes("--draft")) {
  const account = accounts.find(
    (a: any) => a.capabilities.formats.text === "supported",
  );
  if (!account) throw new Error("No eligible text account.");
  const pkg = await api("packages", "POST", {
    title: "API client example",
    sourceNotes: "Source created by the local example client.",
    brief: "Describe one clear operational takeaway.",
    tags: ["api-example"],
    assetIds: [],
  });
  const variant = await api("variants", "POST", {
    packageId: pkg.id,
    accountId: account.id,
    format: "text",
    payload: {
      hook: "One useful observation.",
      caption: "An API-created draft for human review.",
      title: "",
      description: "",
      cta: "",
      visibility: "public",
      settings: {},
      media: [],
      utm: "",
    },
  });
  const approval = await api(
    "variants/" + variant.id + "/request-approval",
    "POST",
    {
      revisionId: variant.current_revision_id,
      scheduledAt: new Date(Date.now() + 3600000).toISOString(),
    },
  );
  console.log({
    packageId: pkg.id,
    variantId: variant.id,
    approvalId: approval.id,
    status: "Human review required",
  });
}
