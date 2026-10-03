# MediaFlock

MediaFlock is a next generation social media harness built for brands trying to scale. It includes an API and MCP interface. Create drafts for each account, review them, schedule approved posts, and check delivery and performance.

The interface uses a monochrome palette, Instrument Serif headings, an animated sidebar, and the EvilCharts ECharts bar component. It has nine navigation items: Overview, Content, Library, Approvals, Calendar, Analytics, Accounts, Connections, and Settings. Experiment tools remain available through the API and MCP. Calendar shows publication history.

The public website is [mediaflock.vercel.app](https://mediaflock.vercel.app). The public page is `/`, with its privacy policy at `/privacy`. Sign in at `/signin` and open the workspace at `/app`. The `/signup` page creates a separate workspace when registration is enabled. Registration starts closed. Email confirmation and email password reset need configured delivery. The owner selected verified email. The owner deferred email setup until a sending domain is available. Public signup and email recovery remain closed until an SMTP sender passes a real delivery check. An optional recovery-code flow is implemented separately and remains disabled.

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

Open http://127.0.0.1:3211/app. Local-only login: `floyd@mediaflock.local` / `MediaFlock-demo-2026!`. The test environment has labeled accounts, media fixtures, posts, approvals, delivery results, missing metrics, and an observational experiment. Production setup adds none of these records.

[Local setup and walkthrough](docs/local-demo.md) · [Production and credentials](docs/deployment.md) · [Verification matrix](docs/completion.md)

## Run a real workspace

Create `.env.live` from `.env.live.example` with your Supabase configuration. Set `MEDIAFLOCK_OWNER_EMAIL` for the first setup. The script creates an owner with a random password. It saves the login in a private ignored file and sends no email.

Live media parsing requires the isolated Docker image and `MEDIAFLOCK_MEDIA_ISOLATION=docker`. Install and verify it using the [worker isolation instructions](docs/deployment.md#isolated-media-worker) before starting the worker. The local demo can use the host FFmpeg installation for trusted fixtures.

```sh
MEDIAFLOCK_ENV_FILE=.env.live pnpm setup:production
MEDIAFLOCK_ENV_FILE=.env.live pnpm build
MEDIAFLOCK_ENV_FILE=.env.live pnpm start
MEDIAFLOCK_ENV_FILE=.env.live pnpm worker
```

For a persistent private macOS installation, run `pnpm service:install`. The installer creates a private versioned runtime in `~/Library/Application Support/MediaFlock`. Two LaunchAgents start the web app and worker when you log in. They read the copied `.env.live` and restart failed processes. Worker startup checks the installed parser image and can start the dedicated Colima profile on macOS. The web app binds to loopback. The Mac must remain awake.

Configure Post for Me in Connections and save its fixed Project Redirect URL. Authorize your accounts and review their permissions. Enable approved publication explicitly. OpenAI is optional. Manual drafting works without it. These integrations use your own service accounts. The open source license does not include third-party service access or API usage.

## Deploy the web app on Vercel

Vercel can host the public page, account pages, workspace, and API. The existing Mac worker handles upload validation, FFmpeg, publication, and analytics. It connects directly to the same Supabase project. The web app does not start a worker during a request.

Browsers upload originals directly to private Supabase Storage with signed upload URLs. The worker checks their hashes and media details in a container before creating a separate immutable original. Authorized downloads use short signed URLs. Originals, staging, quarantine, and derivatives share a 1 GiB workspace allowance, 20 media requests in 24 hours, and three pending jobs. A separate global storage allowance defaults to 1 GiB in live mode and must fit the actual Supabase project capacity.

Follow the [public deployment instructions](docs/deployment.md#vercel-web-and-api). They include build settings, verified database TLS, account admission, email delivery, worker updates, and production checks. The first public deployment passed 82 production checks on October 3, 2026, including a direct 5.8 MiB private upload, worker validation, download checksum, byte ranges, and cleanup. See the [verification record](docs/completion.md) for tested results and remaining account-admission prerequisites.

## Verify

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:browser
```

`pnpm test` uses `.env.demo` and refuses remote databases. Start `pnpm dev:demo` and `pnpm worker:demo` before the Chrome browser journey. Tests exercise local Auth, Postgres, private Storage, and FFmpeg. To require the container canaries, install the documented parser image and run `MEDIAFLOCK_MEDIA_ISOLATION=docker pnpm test`. Without that image or daemon, optional demo runs report skipped isolation cases; requested Docker checks fail closed. Provider tests use isolated fixture transports. See [test evidence](docs/completion.md) for verified results.

## API and MCP

Create a token in Settings → API access. Default scopes are `read`, `draft`, and `request_approval`. Scheduling needs a separate scope and a current human approval. No machine token or MCP tool can approve content.

```sh
MEDIAFLOCK_API_TOKEN=your_token pnpm exec tsx scripts/example-client.ts
MEDIAFLOCK_API_TOKEN=your_token pnpm mcp
```

The versioned API is `/api/v1`. The `/api/openapi` route serves the [OpenAPI specification](docs/openapi.json). The example client lists accounts by default. Use `--draft` to create a draft and request human approval. See [API/MCP configuration](docs/api-mcp.md).

## Design and reliability

[Architecture](docs/architecture.md) · [Decisions](docs/decisions.md) · [Provider contracts](docs/provider-capabilities.md) · [Security](SECURITY.md) · [Third-party notices](THIRD_PARTY_NOTICES.md)

Approval binds the exact revision, media hashes, privacy, destination, account connection, provider settings, and UTC schedule. The worker checks current permission before it sends a post. It checks unknown submission results without another blind submission. Provider acceptance and confirmed platform publication are separate states.

Licensed under MIT. Fonts and third-party components retain their own licenses. The repository includes application code, tests, migrations, media fixtures, and setup instructions. It excludes credentials and private deployment records.
