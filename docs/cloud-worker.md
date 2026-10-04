# Cloud posting and Analytics

The Cloud Tick uses the same Approved Delivery and Metric Observation workers as the Mac. It cannot approve a post or prepare original media. Native media processing remains on the Mac.

## Current release

The endpoint and durable controls are prepared with real work disabled. A successful empty run proves authentication and cloud database access. It does not prove a social account, publishing permission, provider response, or active timer. No paid hosting upgrade or real post is authorized by an empty run.

Vercel's current Hobby plan permits only personal, noncommercial use and its cron runs only daily. The proposed minute timer requires an approved plan that supports that cadence. Pro currently starts at $20 per month, excluding applicable taxes and excess metered usage. Review the live checkout and spending controls before changing billing. Sources: [Vercel plans](https://vercel.com/pricing), [commercial use](https://vercel.com/docs/limits/fair-use-guidelines), [cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing).

`config/hosted-worker-cron.json` is an inactive configuration proposal. It is deliberately separate from the active `vercel.json`. Do not deploy a minute cron onto Hobby. After the hosting choice is approved, merge only this entry into the verified production configuration.

The database timer candidate was rejected after its actual role permissions could not be narrowed. No production extension, timer, or Vault credential was added for that candidate.

## Execution

The server-only `CRON_SECRET` is 32 random bytes encoded as base64url. It is separate from user sessions, Supabase keys and CSRF credentials. Vercel sends it in the Authorization header of its scheduled GET request. POST with the fixed `{}` body is available for a supervised check. Query parameters, user-cookie fallback and caller-selected work are rejected. See [Vercel cron authentication](https://vercel.com/docs/cron-jobs/manage-cron-jobs).

Both methods authenticate before acquiring database authority. The durable control has separate infrastructure and real-work switches. Admission allows one cycle per database minute and uses a 150-second lease. Completion can release only its own current lease. Closing the durable gate prevents a queued request from starting work and is rechecked before another task.

A cycle alternates its first lane between publishing and Analytics, attempts at most one of each, and skips a lane if its full budget cannot fit. Metrics prioritize the original observation cutoff. Each task has a 45-second provider budget and 55-second database budget; normal cycle work targets 100 seconds, final database work is bounded at 110 seconds, and the route has a 120-second platform maximum. Provider response bodies, storage reads, DNS verification and uploads share the provider budget. Deadline settings use a private database pool so they cannot affect normal app or Mac connections.

Termination retains the existing publication reservation, uncertain-result handling and per-job leases. An expired lease permits recovery; it never proves that a provider did not accept a post. A missed Analytics horizon stays unavailable. The admission token does not fence out late provider receipts.

Settings separates Mac media health, cloud heartbeat, work enablement and workspace results that need attention. Empty runs do not clear a retained work error. Heartbeat freshness is not a provider-success or uptime guarantee. Run history is retained for seven days.

## Activation proof

1. Apply only the new migration to the verified production baseline. Confirm browser and app roles cannot read or write the control and run tables.
2. Deploy and verify the endpoint, its 120-second configuration, exact source delta, closed admission flags and unchanged real-posting flags.
3. Provision `CRON_SECRET` privately in the production server environment only. Check unauthenticated rejection and an authenticated empty run with real work disabled. Confirm the secret is absent from browser assets and outputs.
4. Enable the infrastructure gate. After the plan is approved, add the minute schedule and observe at least two real platform-originated invocations. Temporarily stop only the Mac worker while there are no active real jobs; restore it after the check. Leave Mac power settings unchanged.
5. Actual publishing and metrics retrieval require verified account permissions, credentials, reachable approved media bytes and the owner's approval of each exact real post. Those are separate gates. Only then enable real cloud work.

An empty manual run is not completion of step 4. Tests with isolated fixtures are not completion of step 5.

## Rollback

Close `cloud_worker_control.enabled` and `work_enabled` before removing the timer or restoring the previous deployment. Let admitted work settle or reach its bounded termination. Keep reservations and receipts; do not clear job leases or mark uncertain posts failed to make rollback appear complete. Keep additive control tables until recovery evidence is no longer needed. Restore the verified previous web and Mac releases; preserve unrelated configuration and integrations.
