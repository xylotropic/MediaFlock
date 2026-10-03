# Personal production installation

The verified installation uses a real Supabase database, Auth and private Storage plus two private macOS LaunchAgents. It is reachable at http://127.0.0.1:3210 on the host Mac. This is not a public website; the Mac must be logged in and awake. The worker owns no fake production records.

## Environment and first owner

Copy `.env.live.example` to `.env.live`; restrict permissions to 0600. Configure a dedicated Supabase project, its server-side database URL, public anon key and private service-role key. Use a verified TLS connection for remote Postgres. Set `DATABASE_SSL_CA_FILE` if the provider needs a CA bundle; the included Supabase public CA certificate can be used with its documented pooler. Certificate validation is never disabled.

Generate independent random values for `CSRF_SECRET` and the 32-byte base64 `CREDENTIAL_ENCRYPTION_KEY`. Keep the vault key in a secure backup; changing it without re-encrypting stored credentials makes them unreadable. Do not place secrets in Git, browser storage, logs or the MCP prompt.

For a private Mac set `APP_ORIGIN=http://127.0.0.1:3210`. For an explicitly requested public deployment, configure HTTPS, reverse-proxy limits, exact Auth redirect URLs, backup/restore procedures, owner admission and an always-running worker before exposing the service. Non-loopback HTTP is rejected. Disable public Supabase sign-ups for a single-owner installation.

Set `MEDIAFLOCK_OWNER_EMAIL` and optionally `MEDIAFLOCK_OWNER_NAME` for the first setup:

```sh
MEDIAFLOCK_ENV_FILE=.env.live pnpm setup:production
MEDIAFLOCK_ENV_FILE=.env.live pnpm build
pnpm service:install
pnpm service:status
```

Setup applies checksum-recorded migrations under a dedicated advisory lock, creates a private bucket, and creates the first owner only when needed. The generated login is saved at `artifacts/deployment/private/owner-login.json` with mode 0600. It sends no email. Subsequent setup preserves the owner and data.

Use `pnpm service:restart`, `service:stop`, or `service:start` to operate the two services. Installation creates a private versioned runtime under `~/Library/Application Support/MediaFlock/releases`, copies the built app and its pinned dependencies, and saves `current.json` there. Source files remain in your checkout. Runtime logs are under the release's `artifacts/logs`. The LaunchAgents are `org.mediaflock.personal.web` and `org.mediaflock.personal.worker` in the host user's `Library/LaunchAgents` directory. They read the release's private `.env.live`; they do not require an open terminal or Documents-folder access. After changing your source environment, rebuild and run `service:install` to install the reviewed release. Sign in with the saved login, then use Settings to change your password if desired.

## Post for Me

In Connections, enter your own API key, choose the credential mode, and configure the fixed Project Redirect URL shown there in your provider project. Confirm that setup in MediaFlock. The connection check is an authenticated account-list read; it does not create a post.

Authorize social accounts yourself. The completed callback imports every connected account whose server-verified external binding and platform match the pending attempt. Returned native access tokens are never stored in MediaFlock. Imported account types, formats and operation permissions start unknown.

Review each account in Accounts, select its actual native type and permitted formats, and record the evidence you checked. Unchecked feed access remains unknown. Reviews expire after 30 days and bind the current connection and provider configuration. Reauthorization or key/configuration changes invalidate prior eligibility.

Publication needs both the server ceiling `MEDIAFLOCK_LIVE_PUBLISHING_ENABLED=true` and the owner checkbox **Allow publication of posts I explicitly approve** in the Post for Me connection. Keep the owner checkbox off until you are ready. Every delivery still needs a fresh human approval of the exact content, media, account, privacy and time. The verified personal installation starts with no provider key, no connected social accounts and no allowed live publication.

## OpenAI

Optional. Enter an API key and explicit model in Connections, then set daily token and output ceilings. The connection check only reads model access. Generating a draft uses your API account and may incur charges; automated tests never invoke it. Manual creation and editing require no AI key.

## Changes, backups and rollback

Before an update, record the running build ID, served JS/CSS digests, source commit and migration inventory. Preserve `.env.live`, the vault key, private bucket and database backups. Stop the two services, preserve the existing `.next` release, apply only reviewed migrations, build the reviewed source, and restart. Verify actual served assets and Auth/Storage/worker health afterward.

For a code rollback, stop both services, restore the previous saved LaunchAgent files pointing to the previous versioned runtime, then start and verify the prior build ID and served hashes. Keep the source commit, environment and runtime manifest for each release. Never drop production tables or run a test database reset as rollback. Schema migrations in this MVP are additive; assess compatibility before rolling code backward. Unknown external deliveries must retain attempts and reconciliation state across rollback.

## Other hosts

On Linux, run the same production web and worker commands under separate systemd units or an existing process supervisor, using the repository as WorkingDirectory and a private environment file. Keep the worker running across request/process lifetimes. A web service that scales to zero cannot replace this worker. The macOS helper is not a Linux installer.
