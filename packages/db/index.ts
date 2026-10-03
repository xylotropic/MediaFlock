import pg from "pg";
import { attachDatabasePool } from "@vercel/functions";
import { readFileSync } from "node:fs";
import { getConfig } from "../domain/config";
import { DomainError } from "../domain/errors";
import { guardContextSecurity } from "../domain/session-security";
export interface Context {
  workspaceId: string;
  userId: string;
  role: "owner" | "reviewer" | "editor" | "viewer";
  kind: "human" | "token" | "worker";
  scopes: string[];
  tokenId?: string;
  authSessionId?: string;
  localInteractive?: boolean;
}
export type Tx = pg.PoolClient;
let pool: pg.Pool | undefined;
export function db() {
  if (!pool) {
    pool = new pg.Pool({
      connectionString: getConfig().databaseUrl,
      ssl:
        getConfig().databaseTls ||
        getConfig().databaseCaFile ||
        getConfig().databaseCa
          ? {
              ca:
                getConfig().databaseCa ||
                (getConfig().databaseCaFile
                  ? readFileSync(getConfig().databaseCaFile!, "utf8")
                  : undefined),
              rejectUnauthorized: true,
            }
          : undefined,
      max: getConfig().databasePoolMax,
      idleTimeoutMillis: 5000,
      connectionTimeoutMillis: 5000,
      statement_timeout: 15000,
      lock_timeout: 10000,
      idle_in_transaction_session_timeout: 20000,
    });
    if (process.env.VERCEL) attachDatabasePool(pool);
    pool.on("error", () => {
      console.error("Database pool connection interrupted.");
    });
  }
  return pool;
}
export async function scoped<T>(
  ctx: Context,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  const tx = await db().connect();
  try {
    await tx.query("begin");
    await guardContextSecurity(tx, ctx);
    await tx.query("set local role mediaflock_app");
    await tx.query(
      "select set_config('request.jwt.claim.sub',$1,true),set_config('mediaflock.workspace',$2,true),set_config('mediaflock.service',$3,true),set_config('mediaflock.server_verified','1',true)",
      [ctx.userId, ctx.workspaceId, ctx.kind === "worker" ? "1" : "0"],
    );
    const workspace = (
      await tx.query("select mode from workspaces where id=$1", [
        ctx.workspaceId,
      ])
    ).rows[0];
    if (!workspace || workspace.mode !== getConfig().mode)
      throw new DomainError(
        "workspace_denied",
        "Workspace is unavailable in this environment.",
        403,
      );
    if (ctx.kind !== "worker") {
      const member = (
        await tx.query(
          "select role from memberships where workspace_id=$1 and user_id=$2",
          [ctx.workspaceId, ctx.userId],
        )
      ).rows[0];
      if (!member || member.role !== ctx.role)
        throw new DomainError(
          "membership_changed",
          "Membership changed. Refresh before continuing.",
          403,
        );
      if (ctx.kind === "token") {
        const token = (
          await tx.query(
            "select scopes from api_tokens where id=$1 and workspace_id=$2 and user_id=$3 and revoked_at is null and expires_at>now()",
            [ctx.tokenId, ctx.workspaceId, ctx.userId],
          )
        ).rows[0];
        if (!token || ctx.scopes.some((x) => !token.scopes.includes(x)))
          throw new DomainError(
            "invalid_token",
            "API token expired or was revoked.",
            401,
          );
      }
    }
    const value = await fn(tx);
    await tx.query("commit");
    return value;
  } catch (e) {
    await tx.query("rollback");
    throw e;
  } finally {
    tx.release();
  }
}
export async function closeDb() {
  await pool?.end();
  pool = undefined;
}
export async function one<T = { id: string; [key: string]: any }>(
  tx: Tx,
  sql: string,
  args: unknown[] = [],
): Promise<T | undefined> {
  return (await tx.query(sql, args)).rows[0];
}
export async function audit(
  tx: Tx,
  ctx: Context,
  action: string,
  type: string,
  id: string | null,
  details: unknown = {},
) {
  await tx.query(
    "insert into audit_events(workspace_id,actor_id,actor_kind,action,resource_type,resource_id,details) values($1,$2,$3,$4,$5,$6,$7)",
    [
      ctx.workspaceId,
      ctx.kind === "worker" ? null : ctx.userId,
      ctx.kind,
      action,
      type,
      id,
      details,
    ],
  );
}
export function workerContext(workspaceId: string): Context {
  return {
    workspaceId,
    userId: "00000000-0000-0000-0000-000000000000",
    role: "owner",
    kind: "worker",
    scopes: ["worker"],
  };
}
