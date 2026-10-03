import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./server";
import { getConfig } from "../../packages/domain/config";
import { closeDb } from "../../packages/db";
getConfig();
const secret = process.env.MEDIAFLOCK_API_TOKEN;
if (!secret) {
  console.error(
    "Set MEDIAFLOCK_API_TOKEN to a workspace token created in Administration. Default scopes: read, draft, request_approval. No token can approve.",
  );
  process.exit(1);
}
const server = createMcpServer(secret);
await server.connect(new StdioServerTransport());
async function stop() {
  await server.close();
  await closeDb();
  process.exit(0);
}
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
