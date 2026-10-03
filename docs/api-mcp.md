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

## Upload originals

Use the HTTP API to upload media. The MCP tools do not upload local files. Original bytes go directly to the private Storage bucket, and the worker validates them before the API exposes a usable asset.

1. Calculate the file's SHA-256 checksum and send `POST /api/v1/asset-uploads` with `requestId` (a fresh UUID), `filename`, `bytes`, `mimeType`, `checksum`, and optional `tags` and `notes`. Use a token with `draft` scope. Supported types are PNG, JPEG, WebP, MP4 and QuickTime, with a maximum size of 50 MiB.
2. Send the unchanged file bytes with `PUT` to the returned `signedUrl`. Set `Content-Type` to the declared media type and `x-upsert: false`. This grant targets one server-generated staging path, lasts two hours and cannot overwrite an existing object. It never grants access to the final original path. Treat the URL as a temporary secret.
3. Send `POST /api/v1/asset-uploads/{id}/complete` with `{}` to queue validation. The worker reads at most 50 MiB, checks MIME, picture metadata and SHA-256, and stores those identical bytes at a separate immutable original path. It reads that final object back and confirms its hash before registering an asset. A recovered worker reuses a matching final object and never overwrites it. Poll `GET /api/v1/asset-uploads/{id}` with `read` scope and at least 1.5 seconds between requests. Status progresses from `awaiting_upload` through `queued` and `validating` to `ready`; failures return `failed` and an explanation. Only `ready` includes the verified `asset`, whose ID can enter a content package or approval.

Reuse the same `requestId` and metadata when retrying the same upload. Preparation returns the same pending link or ready asset. Completion also accepts retries, including a lost response from the original PUT. A failed or expired upload needs a fresh request ID. The Mac worker must be running for validation and derivatives.

The workspace allowance is 1 GiB across originals, retained staging files, derivatives and reserved uploads, with 20 new uploads or derivatives per 24 hours and three pending media jobs. Each unverified upload reserves 100 MiB for a possible 50 MiB staging file and 50 MiB immutable original. Once ready, both copies count at their verified byte size. Failed files remain quarantined and count toward the allowance. Abandoned grants expire; the worker releases capacity only for objects confirmed absent after the grant and its in-flight buffer have ended. Stored originals are retained unchanged.

A global allowance covers all workspaces and also counts unregistered objects left by interrupted work. New reservations take a global database lock before checking capacity, so parallel workspaces cannot bypass this allowance. `MEDIAFLOCK_STORAGE_TOTAL_BYTES` sets the deployment's total byte ceiling. Live mode defaults to 1 GiB; isolated demo mode defaults to 20 GiB for test fixtures. Configure a lower live ceiling when the storage plan needs spare capacity. Only server roles can read the aggregate. API calls return `storage_capacity` when the shared allowance is full.

`GET /api/v1/assets/{id}/file` authorizes workspace access and redirects to a private URL valid for 60 seconds. Follow the redirect to receive bytes; Storage supports `Range` requests. Use `?derivative=true` with a ready derivative ID. Local installations also retain the multipart `POST /api/v1/assets` endpoint. Cloud callers use the direct upload workflow to avoid web function size limits.

## Local subscription drafting

Live ChatGPT subscription drafting is restricted to the installed owner's authenticated local web session. API/MCP tokens, workers, hosted requests, and other users or workspaces cannot consume that subscription. Machine tokens can still create and edit manual drafts through the ordinary domain operations. Demo AI remains labeled, deterministic fixture output. The local subscription endpoints in OpenAPI use human cookie authentication and same-origin CSRF; they never expose access or refresh tokens.
