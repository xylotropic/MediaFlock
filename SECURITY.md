# Security

Report a vulnerability privately through GitHub's private vulnerability reporting if enabled. Do not post credentials, private media or exploit data in a public issue.

The app requires Supabase authentication, checks membership and role for every request, and runs scoped database transactions through an RLS-constrained role. Cross-workspace foreign keys, immutable records and append-only audit events enforce data boundaries. Service credentials stay server-side; the vault uses AES-256-GCM with workspace/service-associated data. Machine tokens are hashed, scoped, expiring and revocable; they cannot approve content or manage credentials.

Browser writes require same Origin and a user-bound CSRF token. OAuth attempts use random browser nonces, exact server-generated external bindings, expiry, single pending attempts and idempotent completion. Account permission attestations bind connection generations and provider configuration, expire after 30 days and remain explicitly owner evidence. Worker dispatch rechecks approval and current enablement before recording send authorization. Changes after that authorization may race an already-in-flight external request.

Private originals and derivatives are authenticated and content-hashed. Remote provider upload hosts must resolve exclusively to public addresses; HTTPS connects to a pinned validated address, validates the original hostname and rejects redirects. Request sizes and FFmpeg runtime/threads/output are bounded. Uploaded source text is rendered as text, never trusted application instructions.

The private Mac installation uses loopback HTTP with host-local cookies. Public access requires HTTPS and Secure cookies. It does not create a public tunnel. Demo mode rejects remote databases and live API keys. Never run fixture tests against production.

Keep `.env.live`, owner-login files, tokens, private operational metadata and the credential encryption key outside public Git. Back up the database and private bucket together with the vault key. The optional external provider and model services have their own security and billing boundaries.
