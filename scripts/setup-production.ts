import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import { db, closeDb } from "../packages/db";
import { getConfig } from "../packages/domain/config";
import { storageAdmin } from "../packages/domain/auth";

// Explicit live configuration; no fixture seeding, email sending, or social writes.
async function main() {
  const config = getConfig();
  if (config.mode !== "live")
    throw new Error("Production setup requires live mode.");
  const tx = await db().connect();
  try {
    await tx.query("select pg_advisory_lock(721041321)");
    await tx.query("create schema if not exists mediaflock_deployment");
    await tx.query(
      "create table if not exists mediaflock_deployment.migrations(name text primary key,checksum text not null,applied_at timestamptz not null default now())",
    );
    for (const name of (await readdir("supabase/migrations"))
      .filter((x) => x.endsWith(".sql"))
      .sort()) {
      const source = await readFile("supabase/migrations/" + name, "utf8");
      const checksum = createHash("sha256").update(source).digest("hex");
      const prior = (
        await tx.query(
          "select checksum from mediaflock_deployment.migrations where name=$1",
          [name],
        )
      ).rows[0];
      if (prior) {
        if (prior.checksum !== checksum)
          throw new Error("Applied migration changed: " + name);
        continue;
      }
      await tx.query("begin");
      try {
        await tx.query(source);
        await tx.query(
          "insert into mediaflock_deployment.migrations(name,checksum) values($1,$2)",
          [name, checksum],
        );
        await tx.query("commit");
        console.log("Applied " + name);
      } catch (error) {
        await tx.query("rollback");
        throw error;
      }
    }
  } finally {
    await tx.query("select pg_advisory_unlock(721041321)");
    tx.release();
  }
  const admin = storageAdmin();
  const buckets = await admin.storage.listBuckets();
  if (buckets.error) throw buckets.error;
  if (!buckets.data.some((x) => x.id === "mediaflock")) {
    const result = await admin.storage.createBucket("mediaflock", {
      public: false,
      fileSizeLimit: 52428800,
    });
    if (result.error) throw result.error;
  }
  const ownerEmail = process.env.MEDIAFLOCK_OWNER_EMAIL;
  if (
    !ownerEmail &&
    (
      await db().query(
        "select 1 from memberships m join workspaces w on w.id=m.workspace_id where m.role='owner' and w.mode='live' limit 1",
      )
    ).rowCount
  ) {
    console.log(
      "Existing production owner and workspace preserved. No fixtures added.",
    );
    return;
  }
  if (!ownerEmail)
    throw new Error(
      "Set MEDIAFLOCK_OWNER_EMAIL to the authenticated owner's identity for initial setup.",
    );
  const users = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (users.error) throw users.error;
  let user = users.data.users.find(
    (x) => x.email?.toLowerCase() === ownerEmail.toLowerCase(),
  );
  if (!user) {
    const password = randomBytes(36).toString("base64url");
    const created = await admin.auth.admin.createUser({
      email: ownerEmail,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: process.env.MEDIAFLOCK_OWNER_NAME || "Owner",
      },
    });
    if (created.error || !created.data.user)
      throw created.error || new Error("Owner creation failed.");
    user = created.data.user;
    await mkdir("artifacts/deployment/private", {
      recursive: true,
      mode: 0o700,
    });
    await writeFile(
      "artifacts/deployment/private/owner-login.json",
      JSON.stringify({ email: ownerEmail, password }),
      { mode: 0o600 },
    );
    console.log(
      "Owner credentials saved privately in artifacts/deployment/private/owner-login.json. No email sent.",
    );
  }
  // The first owner is bound to the validated operator identity, never a public sign-up.
  const existing = (
    await db().query(
      "select w.id from workspaces w join memberships m on m.workspace_id=w.id where m.user_id=$1 and m.role='owner' and w.mode='live'",
      [user.id],
    )
  ).rows[0];
  if (!existing) {
    const client = await db().connect();
    try {
      await client.query("begin");
      const workspace = (
        await client.query(
          "insert into workspaces(name,mode) values('MediaFlock','live') returning id",
        )
      ).rows[0];
      await client.query(
        "insert into memberships(workspace_id,user_id,role) values($1,$2,'owner')",
        [workspace.id, user.id],
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }
  console.log(
    "Production workspace initialized without sample accounts, posts, or metrics.",
  );
}
main()
  .catch((error) => {
    console.error(
      error instanceof Error ? error.message : "Production setup failed.",
    );
    process.exitCode = 1;
  })
  .finally(closeDb);
