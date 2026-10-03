# API and MCP

The HTTP API lives under `/api/v1` and shares services with the MCP server. Use an expiring token created by a signed-in owner in Settings. Token secrets are shown once, hashed at rest, scoped to one workspace, rate-limited and revocable. Default scopes: `read`, `draft`, `request_approval`. Add `schedule` only when needed.

```sh
MEDIAFLOCK_API_TOKEN=your_token pnpm exec tsx scripts/example-client.ts
```

Add `--draft` to create a source package, a variant and a pending approval. The client does not approve or publish content. Set `MEDIAFLOCK_ENV_FILE=.env.demo` and `APP_ORIGIN=http://127.0.0.1:3211` for the isolated local environment.

A local Codex MCP configuration can invoke the included stdio entry point:

```toml
[mcp_servers.mediaflock]
command = "pnpm"
args = ["--dir", "/absolute/path/to/MediaFlock", "mcp"]

[mcp_servers.mediaflock.env]
MEDIAFLOCK_API_TOKEN = "your_scoped_token"
MEDIAFLOCK_ENV_FILE = "/absolute/path/to/MediaFlock/.env.live"
```

Keep this configuration private. Start from the repository directory so package/runtime resolution is correct. The MCP server obtains a fresh token/membership check for each call. It exposes `list_accounts`, `get_account_capabilities`, `create_content_package`, `create_variant`, `request_approval`, `schedule_approved_variant`, `get_publication_status`, `get_post_metrics`, `create_experiment`, and `get_experiment_results`. There is no human-approval tool.

`pnpm api:generate` regenerates the included OpenAPI schema. Cookie-authenticated writes require matching Origin and `x-mediaflock-csrf`; bearer tokens still require workspace/scopes and cannot impersonate a human. Credentials, permission reviews and connection configuration are owner-only.

Official reference: [Codex MCP configuration](https://developers.openai.com/codex/mcp/).
