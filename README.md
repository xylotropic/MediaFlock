# MediaFlock

A personal publishing workspace with an API and MCP interface. Turn source material into account-specific drafts, approve the exact content and media, schedule delivery, inspect confirmed results, and compare permitted performance observations.

The interface uses a monochrome palette, Instrument Serif headings, a collapsible animated sidebar, and the actual EvilCharts ECharts bar component. It has nine navigation items: Overview, Content Studio, Library, Approvals, Calendar, Analytics, Accounts, Connections, and Settings. Experiment tools remain available through the API and MCP; publication history is available from Calendar receipts.

## Run the isolated local workflow

Prerequisites: Node 22 or later, pnpm 10, Docker, and FFmpeg/ffprobe with libass. Everything in this workflow runs without paid API credentials.

```sh
pnpm install --frozen-lockfile
pnpm setup:demo
pnpm dev:demo
```

In another terminal:

```sh
pnpm worker:demo
```

Open http://127.0.0.1:3211. Local-only login: `floyd@mediaflock.local` / `MediaFlock-demo-2026!`. The test environment has ten labeled accounts, original image/video fixtures, history, pending approvals, mixed delivery results, missing metrics, and an observational experiment. Production setup adds none of these records.

[Local setup and walkthrough](docs/local-demo.md) · [Production and credentials](docs/deployment.md) · [Verification matrix](docs/completion.md)

## Run a real workspace

Create `.env.live` from `.env.live.example` with your Supabase configuration. Set `MEDIAFLOCK_OWNER_EMAIL` for the first setup. The script creates an owner with a random password, saves it in a private ignored file, and sends no email.

```sh
MEDIAFLOCK_ENV_FILE=.env.live pnpm setup:production
MEDIAFLOCK_ENV_FILE=.env.live pnpm build
MEDIAFLOCK_ENV_FILE=.env.live pnpm start
MEDIAFLOCK_ENV_FILE=.env.live pnpm worker
```

For a persistent private macOS installation, run `pnpm service:install`. The installer creates a private versioned runtime in `~/Library/Application Support/MediaFlock`. The two LaunchAgents read its copied `.env.live`, bind the web app to loopback, restart failed processes, and start when you log in. The Mac must remain awake. No tunnel or public website is created.

Configure Post for Me in Connections, save its fixed Project Redirect URL, authorize your accounts, and review account permissions. Enable approved publication explicitly. OpenAI is optional; manual drafting works without it. These integrations use your own service accounts. The open source license does not include third-party service access or API usage.

## Verify

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:browser
```

`pnpm test` uses `.env.demo` and refuses remote databases. Start `pnpm dev:demo` before the Chrome browser journey. Tests exercise real local Auth, Postgres, private Storage and FFmpeg; provider calls use isolated fixture transports. See [test evidence](docs/completion.md) for what was actually verified.

## API and MCP

Create a token in Settings → API access. Default scopes are `read`, `draft`, and `request_approval`. Scheduling needs a separate scope and a current human approval. No machine token or MCP tool can approve content.

```sh
MEDIAFLOCK_API_TOKEN=your_token pnpm exec tsx scripts/example-client.ts
MEDIAFLOCK_API_TOKEN=your_token pnpm mcp
```

The versioned API is `/api/v1`; `/api/openapi` serves the [OpenAPI specification](docs/openapi.json). The example client lists accounts by default; `--draft` creates a draft and requests human approval. See [API/MCP configuration](docs/api-mcp.md).

## Design and reliability

[Architecture](docs/architecture.md) · [Decisions](docs/decisions.md) · [Provider contracts](docs/provider-capabilities.md) · [Security](SECURITY.md) · [Third-party notices](THIRD_PARTY_NOTICES.md)

Approval captures immutable revisions, ordered content digests, effective media metadata, privacy, destination, account connection generation, provider configuration, and UTC schedule. The worker rechecks eligibility before authorizing a send. Unknown submission results enter reconciliation; they are never blindly reposted. Provider acceptance and confirmed native publication are separate states.

Licensed under MIT. Fonts and third-party components retain their own licenses. All application code, tests, migrations, original fixture assets, and reproducible instructions are included; credentials and private operational records are excluded.
