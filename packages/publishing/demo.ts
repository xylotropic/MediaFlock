import { db, scoped, one, workerContext } from "../db";
import { contentHash } from "../domain/auth";
import { getConfig } from "../domain/config";
import {
  ProviderError,
  type PublishingProvider,
  type DeliveryEnvelope,
  type Receipt,
  type FeedPost,
} from "./provider";
export class DeterministicDemoProvider implements PublishingProvider {
  constructor() {
    if (getConfig().mode !== "demo")
      throw new ProviderError(
        "unavailable",
        "Simulated provider is disabled in live mode.",
      );
  }
  async submit(
    envelope: DeliveryEnvelope,
    localKey: string,
    snapshotHash: string,
  ): Promise<Receipt> {
    if (envelope.provenance !== "simulated")
      throw new ProviderError(
        "validation",
        "Demo provider only accepts simulated records.",
      );
    const result = await scoped(
      workerContext(envelope.workspaceId),
      async (tx) => {
        await tx.query(
          "insert into demo_provider_calls(workspace_id,local_key,operation) values($1,$2,'submit')",
          [envelope.workspaceId, localKey],
        );
        const existing = await one(
          tx,
          "select * from demo_provider_jobs where local_key=$1 and workspace_id=$2",
          [localKey, envelope.workspaceId],
        );
        if (existing) return { job: existing, fault: undefined };
        const account = await one(
          tx,
          "select * from social_accounts where id=$1 and workspace_id=$2",
          [envelope.accountId, envelope.workspaceId],
        );
        if (account?.status !== "connected")
          throw new ProviderError("auth", "Simulated account is disconnected.");
        const fault = account.posting_preferences.demoFault as
          string | undefined;
        if (fault === "rate_limit_once") {
          const previous = await one(
            tx,
            "select count(*)::int as n from demo_provider_calls where local_key=$1 and operation='submit'",
            [localKey],
          );
          if (previous!.n === 1) return { job: undefined, fault };
        }
        const id =
          "demo_" +
          contentHash({ workspaceId: envelope.workspaceId, localKey }).slice(
            0,
            20,
          );
        const job = await one(
          tx,
          "insert into demo_provider_jobs(id,workspace_id,local_key,account_id,snapshot_hash,payload,state,scheduled_at,fault) values($1,$2,$3,$4,$5,$6,'scheduled',$7,$8) returning *",
          [
            id,
            envelope.workspaceId,
            localKey,
            envelope.accountId,
            snapshotHash,
            envelope,
            envelope.scheduledAt,
            fault || null,
          ],
        );
        return { job, fault };
      },
    );
    if (result.fault === "rate_limit_once" && !result.job)
      throw new ProviderError(
        "rate_limited",
        "Simulated rate limit; retry in one second.",
        true,
        1,
      );
    if (result.fault === "timeout_after_acceptance")
      throw new ProviderError(
        "ambiguous",
        "Simulated connection loss after acceptance. Reconciliation required.",
      );
    return this.receipt(result.job!);
  }
  private receipt(row: Record<string, any>): Receipt {
    return {
      providerJobId: row.id,
      state: row.state,
      platformPostId: row.platform_post_id || undefined,
      url: row.platform_post_id
        ? `https://example.invalid/simulated/${row.platform_post_id}`
        : undefined,
      scheduledAt: new Date(row.scheduled_at).toISOString(),
      error:
        row.state === "failed"
          ? "Simulated platform rejection for this destination."
          : undefined,
      raw: {
        id: row.id,
        state: row.state,
        provenance: "simulated",
        local_key: row.local_key,
        snapshot_hash: row.snapshot_hash,
      },
      authoritative: true,
    };
  }
  async status(id: string, envelope: DeliveryEnvelope): Promise<Receipt> {
    return scoped(workerContext(envelope.workspaceId), async (tx) => {
      const job = await one(
        tx,
        "select * from demo_provider_jobs where id=$1 and workspace_id=$2 for update",
        [id, envelope.workspaceId],
      );
      if (!job)
        throw new ProviderError(
          "ambiguous",
          "Simulated provider job not found.",
        );
      if (
        job.state === "scheduled" &&
        new Date(job.scheduled_at) <= new Date()
      ) {
        const state = job.fault === "partial_failure" ? "failed" : "published";
        await tx.query(
          "update demo_provider_jobs set state=$1,platform_post_id=$2 where id=$3",
          [
            state,
            state === "published"
              ? "sim_" + contentHash(job.id).slice(0, 14)
              : null,
            id,
          ],
        );
        job.state = state;
        job.platform_post_id =
          state === "published"
            ? "sim_" + contentHash(job.id).slice(0, 14)
            : null;
      }
      return this.receipt(job);
    });
  }
  async reconcile(
    localKey: string,
    snapshotHash: string,
    envelope: DeliveryEnvelope,
  ): Promise<Receipt | null> {
    const row = await scoped(workerContext(envelope.workspaceId), (tx) =>
      one(
        tx,
        "select * from demo_provider_jobs where local_key=$1 and workspace_id=$2",
        [localKey, envelope.workspaceId],
      ),
    );
    if (!row) return null;
    if (
      row.snapshot_hash !== snapshotHash ||
      row.account_id !== envelope.accountId ||
      contentHash(row.payload) !== contentHash(envelope)
    )
      throw new ProviderError(
        "ambiguous",
        "Correlation mismatch. Operator review required.",
      );
    return this.status(row.id, envelope);
  }
  async cancel(id: string, envelope: DeliveryEnvelope): Promise<Receipt> {
    return scoped(workerContext(envelope.workspaceId), async (tx) => {
      const row = await one(
        tx,
        "select * from demo_provider_jobs where id=$1 and workspace_id=$2 for update",
        [id, envelope.workspaceId],
      );
      if (!row)
        throw new ProviderError(
          "ambiguous",
          "Provider job is unknown; cancellation is unconfirmed.",
        );
      if (row.state === "scheduled") {
        if (new Date(row.scheduled_at) <= new Date()) {
          row.state = row.fault === "partial_failure" ? "failed" : "published";
          row.platform_post_id =
            row.state === "published"
              ? "sim_" + contentHash(row.id).slice(0, 14)
              : null;
        } else row.state = "cancelled";
        await tx.query(
          "update demo_provider_jobs set state=$1,platform_post_id=$2 where id=$3",
          [row.state, row.platform_post_id || null, id],
        );
      }
      return this.receipt(row);
    });
  }
  async feed(
    providerAccountId: string,
    platformPostId?: string,
  ): Promise<FeedPost[]> {
    const account = (
      await db().query(
        "select id,workspace_id from social_accounts where provider_account_id=$1 and provenance='simulated'",
        [providerAccountId],
      )
    ).rows[0];
    if (!account) return [];
    return scoped(workerContext(account.workspace_id), async (tx) => {
      const rows = (
        await tx.query(
          "select * from demo_provider_jobs where account_id=$1 and workspace_id=$2 and state='published' and ($3::text is null or platform_post_id=$3)",
          [account.id, account.workspace_id, platformPostId || null],
        )
      ).rows;
      return rows.map((row) => {
        const n = parseInt(contentHash(row.local_key).slice(0, 6), 16);
        return {
          platformPostId: row.platform_post_id,
          metrics: {
            views: 1000 + (n % 4000),
            likes: 50 + (n % 200),
            comments: 3 + (n % 20),
            shares: 8 + (n % 40),
          },
          raw: {
            provenance: "simulated",
            generator: "sha256(local_key)",
            id: row.platform_post_id,
          },
        };
      });
    });
  }
}
