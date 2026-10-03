# Production deployment

The verified baseline uses cloud Supabase and two private macOS LaunchAgents. Its web app is at `http://127.0.0.1:3210` on the host Mac. The worker processes real workspace data. The isolated local test app uses port 3211 and a separate database.

The public web app is [mediaflock.vercel.app](https://mediaflock.vercel.app), deployed on October 3, 2026 with the existing Mac worker. The first deployment passed its live transport and responsive checks. Registration, email delivery, and recovery-code activation remain closed pending the owner’s selected account flow. Check [the verification record](completion.md) for tested releases.

## Environment and first owner

Copy `.env.live.example` to `.env.live`. Restrict its permissions to 0600. Configure a dedicated Supabase project, database URL, public anon key, and private service-role key.

Use verified TLS for remote Postgres. On the Mac, set `DATABASE_SSL_CA_FILE` when the database needs a CA certificate. The repository includes a public Supabase CA certificate. On Vercel, put the certificate PEM in `DATABASE_SSL_CA`. The application verifies the certificate and hostname. Do not disable certificate validation.

Generate separate random values for `CSRF_SECRET` and the 32-byte base64 `CREDENTIAL_ENCRYPTION_KEY`. Back up the vault key securely. Keep the same vault key on every web and worker runtime that uses this database. A different key cannot decrypt saved integration credentials. Keep secrets outside Git, browser storage, logs, and MCP prompts.

For a private Mac, set `APP_ORIGIN=http://127.0.0.1:3210`. Disable public Supabase signups for a single-owner installation. Keep `MEDIAFLOCK_SELF_SIGNUP_ENABLED=false`. Existing owners can still sign in. The application rejects non-loopback HTTP in live mode.

Set `MEDIAFLOCK_OWNER_EMAIL` and optionally `MEDIAFLOCK_OWNER_NAME` for the first setup:

```sh
MEDIAFLOCK_ENV_FILE=.env.live pnpm setup:production
MEDIAFLOCK_ENV_FILE=.env.live pnpm build
pnpm service:install
pnpm service:status
```

Setup locks migration changes and records their checksums. It creates a private bucket and the first owner only when needed. It saves the login at `artifacts/deployment/private/owner-login.json` with mode 0600. It sends no email. Repeated setup preserves existing owners and data.

## Private Mac web app and worker

Use `pnpm service:restart`, `service:stop`, or `service:start` to control both services. Installation copies the built app and pinned dependencies into `~/Library/Application Support/MediaFlock/releases`. It saves the current release in `current.json`. Runtime logs are in the release's `artifacts/logs` folder.

The LaunchAgents are `org.mediaflock.personal.web` and `org.mediaflock.personal.worker`. Their files are in the host user's `Library/LaunchAgents` folder. They read the release's private `.env.live`. They restart failed processes and start after login. They need no open terminal or Documents-folder access.

After a reviewed source or environment change, build the release and run `pnpm service:install`. Open `/signin` with the saved login. The workspace is at `/app`. The Mac must stay logged in, awake, and connected to Supabase. Live worker startup now requires the isolated parser below. It verifies the installed image before queue work starts and records its exact ID and FFmpeg version. A ten-second heartbeat updates independently of media jobs.

## Isolated media worker

Install Docker and Colima on the Mac, then build the parser from the reviewed source. The dedicated context is `colima-mediaflock`:

```sh
colima start --profile mediaflock --cpu 4 --memory 6 --disk 35
docker --context colima-mediaflock build --pull=false --tag mediaflock-media-parser:debian-bookworm-v1-dee25505aaaf tools/media-parser
docker --context colima-mediaflock image inspect mediaflock-media-parser:debian-bookworm-v1-dee25505aaaf --format '{{.Id}}'
```

The Dockerfile pins an official multi-architecture Debian digest. It installs Debian FFmpeg 5.1.9, libass support, DejaVu fonts, and a small trusted output helper. The restricted build context contains only these source files. No application environment or media is included. The versioned tag contains the Dockerfile checksum prefix; record the full resulting image ID for this worker.

Add these settings to the worker's private `.env.live` before starting or reinstalling its service:

| Variable                                      | Value or purpose                                             |
| --------------------------------------------- | ------------------------------------------------------------ |
| `MEDIAFLOCK_MEDIA_ISOLATION=docker`           | Required for every live media probe and conversion           |
| `MEDIAFLOCK_DOCKER_CONTEXT=colima-mediaflock` | Dedicated local Docker context                               |
| `MEDIAFLOCK_MEDIA_IMAGE`                      | Exact `sha256:` image ID returned by the build inspection    |
| `MEDIAFLOCK_STORAGE_TOTAL_BYTES=786432000`    | 750 MiB global allowance; keep the same value on the web app |

Worker startup can start this existing Colima profile on macOS after login. The parser image must already be installed. Runtime does not pull or rebuild it. A stopped daemon, missing image, or invalid isolation setting prevents live parsing; there is no host fallback. Keep the Mac awake. On Linux, use a separately configured Docker context and build the same reviewed image for that host.

Each parser job gets a new container with no network, a read-only root filesystem, all capabilities dropped, no privilege escalation, and UID 65532. Only that job's copied inputs are mounted read-only. The container receives no application credentials or host home mount. Limits are 512 MiB of memory with no extra swap, two CPU cores, 64 processes, 128 MiB of writable work tmpfs, and 16 MiB of temporary tmpfs. Media commands have a bounded runtime and output limit.

A fixed output helper stops decoder descendants, rejects symlinks and files above 50 MiB, and streams only the named result through a bounded pipe. This avoids a writable host mount. Cleanup deletes the job container on success, failure, or timeout. Startup and periodic cleanup recover only app-owned containers and private staging directories older than five minutes.

Verify the installed image and container behavior with:

```sh
MEDIAFLOCK_MEDIA_ISOLATION=docker pnpm exec vitest run tests/parser-isolation.test.ts tests/media-uploads.test.ts tests/integration.test.ts
```

These tests use isolated local Auth, Postgres, Storage, and fixtures. Requested Docker tests fail if the daemon or image is missing. Optional demo test runs report skipped container cases when isolation is unavailable; a skipped case is not verification of a live worker.

## Vercel web and API

Vercel serves `/`, `/signin`, `/signup`, `/app`, and the API. Supabase stores identities, workspace data, and private media. The Mac worker validates originals, creates derivatives, sends approved posts, and collects analytics. It reads the same database and vault key as Vercel.

[Vercel Hobby](https://vercel.com/docs/limits/fair-use-guidelines) permits personal, noncommercial projects. Use the plan that matches the deployment's actual use. These steps require no added hosting service for the worker.

Use these [build settings](https://vercel.com/docs/builds/configure-a-build):

| Setting           | Value                                  |
| ----------------- | -------------------------------------- |
| Root Directory    | Leave blank, using the repository root |
| Framework Preset  | Next.js                                |
| Build Command     | `pnpm build`                           |
| Output Directory  | `apps/web/.next`                       |
| Node.js Version   | `24.x`                                 |
| Build environment | `ENABLE_EXPERIMENTAL_COREPACK=1`       |

Corepack selects the repository's pinned pnpm version. The current Vercel CLI used for deployment preparation is 62.2.0. Keep the framework preset as Next.js so Vercel creates the API functions. A static export cannot serve this application.

Configure these server environment variables for the production deployment:

| Variable                             | Purpose                                                         |
| ------------------------------------ | --------------------------------------------------------------- |
| `MEDIAFLOCK_MODE=live`               | Select the real workspace environment                           |
| `APP_ORIGIN`                         | Exact production HTTPS origin, without a trailing slash         |
| `DATABASE_URL`                       | Supabase transaction pooler connection for the web app          |
| `DB_POOL_MAX=1`                      | Limit each web instance's Postgres connections                  |
| `DATABASE_SSL_CA`                    | Inline PEM for verified database TLS                            |
| `SUPABASE_URL`                       | Existing Supabase project URL                                   |
| `SUPABASE_ANON_KEY`                  | Auth client key                                                 |
| `SUPABASE_SERVICE_ROLE_KEY`          | Server-only Auth and private Storage access                     |
| `CSRF_SECRET`                        | Random server secret for request and recovery checks            |
| `CREDENTIAL_ENCRYPTION_KEY`          | Existing vault key, identical to the worker's key               |
| `MEDIAFLOCK_LIVE_PUBLISHING_ENABLED` | Keep `false` until publication is explicitly enabled            |
| `MEDIAFLOCK_SELF_SIGNUP_ENABLED`     | Keep `false` until account admission is ready                   |
| `MEDIAFLOCK_AUTH_EMAIL_ENABLED`      | Keep `false` until custom Auth email delivery works             |
| `MEDIAFLOCK_RECOVERY_CODES_ENABLED`  | Keep `false` until the recovery method is selected and verified |
| `MEDIAFLOCK_STORAGE_TOTAL_BYTES`     | Global media allowance in bytes, identical to the worker        |

The Mac worker can keep its persistent session pooler connection and default `DB_POOL_MAX=12`. Vercel uses the [transaction pooler](https://supabase.com/docs/guides/database/connecting-to-postgres) for short-lived web instances. Application transactions use `SET LOCAL` and unnamed queries. Do not put database credentials or service keys in `NEXT_PUBLIC_*` variables.

Inline `DATABASE_SSL_CA` avoids a missing certificate file in a Vercel function bundle. A Mac path in `DATABASE_SSL_CA_FILE` cannot work on Vercel. If you use a file instead, include it explicitly in the Next.js function traces and verify its runtime path.

Keep server-wide `POSTFORME_API_KEY` empty when users supply their own provider key. Each workspace owner configures Post for Me in Connections. Live AI drafting uses the local ChatGPT subscription flow below and never falls back to `OPENAI_API_KEY`.

For the first public release:

1. Capture the current production release, served asset hashes, migration inventory, and worker state.
2. Review the source and deployment changes against that baseline.
3. Apply only the reviewed database migrations.
4. Install the isolated parser image, configure its exact ID, and update the Mac worker before the public app accepts direct uploads.
5. Configure the Vercel project and production environment.
6. Configure Supabase Auth redirects for the exact public origin.
7. Deploy the reviewed release through Vercel CLI or the Git integration.
8. Verify the actual public page, sign-in, private workspace, database TLS, media transport, and worker heartbeat.
9. Record the deployment URL, deployment ID, source commit, and production checks.

Do not use production credentials for an unrelated preview deployment. A different preview origin will also fail the application's exact-origin request checks.

## Account admission and Auth email

The `/signup` page uses Supabase Auth and creates one private workspace for each admitted user. It grants that user ownership only within their new workspace. Request metadata cannot select another workspace. Repeated sign-ins preserve existing membership.

Registration starts closed through `MEDIAFLOCK_SELF_SIGNUP_ENABLED=false`. Set this flag only after the chosen account flow passes production checks. The default limits allow 25 new workspaces per UTC day and 500 total registrations. Change them with `MEDIAFLOCK_SIGNUP_DAILY_WORKSPACES` and `MEDIAFLOCK_SIGNUP_MAX_WORKSPACES`.

Account endpoints also limit requests by global traffic, client address, and email address. They store hashes of addresses in the limit table. Passwords need at least 12 characters. Confirmed identities receive a workspace only after the server verifies them.

`MEDIAFLOCK_AUTH_EMAIL_ENABLED` controls confirmation resend and email password recovery separately from account admission. It does not configure an SMTP server. Set it to `true` only after email delivery works for an address outside the Supabase organization.

The existing Supabase project has no configured custom Auth SMTP. The owner selected verified email and deferred SMTP setup until a sending domain is available; confirmation remains required. The production Auth site URL is `https://mediaflock.vercel.app`, and its exact `/api/auth/callback` URL is allowed alongside the preserved private Mac origin and callback. Public signup and email recovery remain closed until an SMTP sender passes an actual delivery check. Do not claim an email was delivered because the request returned successfully.

[Supabase's default SMTP](https://supabase.com/docs/guides/auth/auth-smtp) only sends to project organization members and has a low email limit. Email-confirmed public signup needs custom SMTP. Keep registration closed until the selected signup method and recovery method are ready.

An optional recovery-code flow is implemented behind `MEDIAFLOCK_RECOVERY_CODES_ENABLED=false`. It can issue one high-entropy code after authenticated admission, stores only a peppered hash, and requires the current password to create a replacement. A reset claims the code before the privileged password update. An unknown update result remains blocked for review rather than being retried blindly. Application session fences prevent earlier sessions from continuing after recovery.

A saved code can replace email delivery for password recovery after that flow is selected and verified. It does not prove ownership of an email address or change the project's signup confirmation policy. The owner selected verified email, so public recovery codes remain disabled. Keep admission closed until email delivery is verified. If codes are enabled, use a stable private `MEDIAFLOCK_RECOVERY_PEPPER` of at least 32 characters on every web runtime; otherwise the code hash uses `CSRF_SECRET`. Store the code securely when it is first shown. Lost codes are not recoverable from their stored hashes.

Set the Supabase Auth Site URL to `APP_ORIGIN`. Allow the exact `APP_ORIGIN/api/auth/callback` redirect. The server uses fixed redirects to `/app` or `/reset-password`. It does not accept a client-supplied redirect destination.

## Direct private media

Vercel functions limit request and response bodies to [4.5 MB](https://vercel.com/docs/functions/limitations). MediaFlock sends large files directly between the browser and Supabase Storage. Its API prepares a signed upload URL for a server-generated path. It does not accept a client-selected storage path or overwrite an existing object.

An original can contain up to 50 MiB. The client submits the file's expected SHA-256 hash and details before upload. The worker reads the stored bytes, checks the hash, and probes the actual media. The upload URL targets a staging object. The worker saves verified metadata, creates a separate immutable original without overwrite, and checks that final copy before exposing an asset. Recovery from a crash reuses an identical final copy; it rejects a different copy without replacing it. Only that validated immutable original becomes an asset that a post can use.

Originals and derivatives share each workspace's limits. These limits allow 1 GiB of media, 20 media requests in 24 hours, and three pending jobs. Reservations cover both a full-size staging object and a separate full-size original. Staging, unvalidated, and quarantined files count against capacity. Failed or abandoned uploads do not silently remove original bytes.

A separate `MEDIAFLOCK_STORAGE_TOTAL_BYTES` allowance applies across all workspaces. The example sets 750 MiB to leave project headroom; the code defaults to 1 GiB in live mode when omitted. Server-side aggregate checks and transaction locks prevent parallel reservations from exceeding it. Configure the same value on web and worker, and keep it within the actual Supabase project storage budget. Workspace allowances do not increase the project's storage or transfer quota.

Authenticated asset GET requests check workspace ownership, then return a 307 redirect to a signed Storage URL valid for 60 seconds. Supabase serves file bodies and byte ranges. The worker verifies checksums again before it forwards media to a provider. Keep the bucket private.

The public app does not start FFmpeg or a detached worker inside an HTTP request. On Vercel, the legacy multipart asset endpoint rejects uploads and directs clients to `/api/v1/asset-uploads`; it cannot invoke a host parser. [Hobby cron](https://vercel.com/docs/cron-jobs/usage-and-pricing) runs at most daily and cannot replace this worker. If the Mac sleeps, uploads and queued jobs wait for its return.

## Post for Me

In Connections, enter your own API key and choose the credential mode. Configure the fixed Project Redirect URL shown there in your provider project. Confirm that setup in MediaFlock. The connection check reads the provider's account list. It does not create a post.

Authorize social accounts yourself. The callback imports accounts only when their external binding and platform match the pending attempt. MediaFlock does not store returned native access tokens. Imported account types, formats, and permissions start unknown.

In Accounts, select the actual account type and permitted formats. Record the permission evidence you checked. Unchecked feed access stays unknown. Reviews expire after 30 days and bind the current connection and provider configuration. New authorization or changed credentials require another review.

Publication needs `MEDIAFLOCK_LIVE_PUBLISHING_ENABLED=true` and the owner checkbox **Allow publication of posts I explicitly approve** in Connections. Keep the checkbox off until you are ready. Each delivery also needs human approval of its exact content, media, account, privacy, and time. The verified baseline has no provider key, connected social accounts, or enabled live publication.

## OpenAI

OpenAI is optional. Enter an API key and explicit model in Connections. Set daily token and output limits. The connection check only reads model access. Draft generation uses your API account and can incur charges. Automated tests do not make these calls. Manual creation and editing need no AI key.

## Changes, backups and rollback

Before an update, record the running build ID, served JS/CSS hashes, source commit, and migration inventory. Preserve the private environment, vault key, bucket, and database backups. Review the exact deployment changes against production. Preserve the existing release before you replace it. Verify served assets and Auth, Storage, and worker health afterward.

For a Mac rollback, stop both services and restore their saved LaunchAgent files. Start the previous runtime and verify its build ID and served hashes. Keep each release's source commit, environment, runtime manifest, and installed parser image ID. Do not restore host parsing as a rollback for live media.

For a Vercel rollback, restore the previous verified deployment and check its actual public behavior. Assess database compatibility before either code rollback. Keep publication attempts and unknown delivery results intact. Never drop production tables or reset the database as a rollback.

## Other hosts

On Linux, run the production web and worker commands under separate systemd units or an existing process supervisor. Use the repository as WorkingDirectory and a private environment file. Keep the worker independent of request lifetimes. A web service that stops between requests cannot replace it. The macOS helper does not install Linux services.

## Local ChatGPT subscription

Use the official [Sign in with ChatGPT registration flow](https://developers.openai.com/siwc/token-sharing-open-source/sign-in) and [plan preview limits](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations). Subscription use is available only in the installed Mac web process bound to 127.0.0.1. It requires the installed owner's authenticated local browser session. Vercel, workers, API tokens, other workspaces, and other users cannot open the local credential vault or start inference.

Run `pnpm setup:subscriptions --owner-record /absolute/path/to/private-owner-record.json` with the previously verified administrator provision record containing userId, workspaceId, and email. It must be an owner-only file. Setup validates that identity against the live database, compiles MediaFlock's own keychain helper, creates a separate local encryption key, and preserves a stable host ID. It never assigns installation ownership from the first HTTP caller. An existing different binding fails without changing stored connections.

Set `MEDIAFLOCK_LOCAL_SUBSCRIPTIONS=true` only in the Mac's private environment. The installed web and worker services receive separate process-role values; only the web role can use subscriptions. Build and install the reviewed release. Open Connections locally, choose Continue with ChatGPT, complete the native account and plan-consent screen in Chrome, return to MediaFlock, and choose an available model. The identity-verified callback stays in memory until the same authenticated local session finalizes it. Never copy credentials from Codex, a browser profile, or the cloud credential vault.

Local encrypted state is in the Mac Application Support subscriptions directory, with owner-only permissions. Its key is in the login keychain. Tokens never enter cloud rows, logs, URLs, or browser storage. Disconnect clears local credentials and reports whether remote session revocation was confirmed. It preserves the issued client/identity mapping for reconnecting. A stale process lock is not automatically deleted: stop the local service, verify the recorded process is dead, remove only that installation's session.lock directory, and restart. Preserve the encrypted vault and binding.

Drafting has no automatic retries or paid API fallback. Daily estimates reserve context plus response allowance; unknown usage remains reserved even on failure. These estimates and the bounded stream are not guaranteed provider token caps. Actual allowance and permission to use extra credits are managed in [ChatGPT settings](https://chatgpt.com/settings/usage). This flow supports text drafting, not transcription, audio/video inputs, or image generation. Manual editing remains available. ElevenLabs is a website handoff until the owner selects and authorizes a supported subscription-credit connection.

Token renewal distinguishes temporary pre-transmission outages, client configuration errors, confirmed unusable grants, and uncertain rotation. Explicit reduced plan scopes replace the old grant atomically while inference stays disabled. Enable plan usage is an explicit local action that requests consent with the retained client. Ordinary reconnect does not force consent. Ambiguous rotation is never automatically replayed, and unconfirmed remote revocation is reported even after local tokens have been cleared.
