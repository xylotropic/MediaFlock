# Isolated local setup

Use a separate local test environment. Its `.env.demo` file and port 3211 are independent of the real workspace on port 3210. Live keys and remote Supabase endpoints are rejected in demo mode.

Install Node 22+, pnpm 10, a Docker-compatible runtime, and FFmpeg with libass. On macOS the free runtimes can be installed with Homebrew:

```sh
brew install colima docker ffmpeg-full
colima start --profile mediaflock --cpu 4 --memory 6 --disk 35
pnpm install --frozen-lockfile
pnpm setup:demo
pnpm dev:demo
```

FFmpeg-full is keg-only. The app detects `/opt/homebrew/opt/ffmpeg-full/bin`; custom installations can set `FFMPEG_BIN` and `FFPROBE_BIN`. On Linux install FFmpeg from your distribution with the `subtitles` filter available. Setup checks executable availability and libass before continuing.

Setup starts dedicated local Supabase services on ports 55321/55322, applies migrations, creates private Storage, and seeds local-only credentials. Repeating setup preserves existing edits. Do not reset the database as part of a routine setup.

Log in at http://127.0.0.1:3211 with `floyd@mediaflock.local` / `MediaFlock-demo-2026!`. Run `pnpm worker:demo` in another terminal.

1. Upload an original image or video in Library. Metadata and SHA-256 are stored; processing writes a separate derivative.
2. Create a source package, add source notes and a brief, and choose accounts in Content Studio.
3. Generate labeled fixture variants or write them manually. Save a new revision when editing.
4. Request approval with an exact time. Inspect the account, media, caption, privacy and revision; approve as the signed-in human.
5. Schedule the approved destinations. Calendar shows each independent result. Inspect receipts and attempts from a publication.
6. Open Analytics, inspect the 24-hour observations and comparable baseline evidence, and switch between publication-period performance and observed metric changes.
7. Use the API/MCP experiment operations to create a hypothesis, assign independent source posts, collect labeled observations and inspect an observational comparison. The integration suite demonstrates the complete six-post loop.

```sh
pnpm test
pnpm test:browser
```

The browser test uses Google Chrome, exercises nine screens at desktop and mobile sizes, captures screenshots in `artifacts/screenshots`, verifies original hashes, checks the command palette and sidebar, and records console/HTTP errors. It creates labeled local test data. Production is never a test fixture.

```sh
pnpm exec supabase stop
colima stop --profile mediaflock
```

These stop local test services without erasing their data. They do not stop the private production LaunchAgents or cloud database.
