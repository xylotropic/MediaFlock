import { config as dotenv } from "dotenv";
import { resolve } from "node:path";
dotenv({
  path: resolve(
    /* turbopackIgnore: true */ process.cwd(),
    process.env.MEDIAFLOCK_ENV_FILE || ".env",
  ),
  quiet: true,
});
export type Mode = "demo" | "live";
export function getConfig() {
  const mode = process.env.MEDIAFLOCK_MODE;
  if (mode !== "demo" && mode !== "live")
    throw new Error(
      "Set MEDIAFLOCK_MODE to demo or live. Use .env.live.example for production or pnpm setup:demo for isolated tests.",
    );
  if (
    mode === "demo" &&
    (process.env.POSTFORME_API_KEY ||
      process.env.OPENAI_API_KEY ||
      process.env.MEDIAFLOCK_LIVE_PUBLISHING_ENABLED === "true")
  )
    throw new Error(
      "Demo mode refuses live credentials. Use a separate live environment and workspace.",
    );
  const url = process.env.SUPABASE_URL || "";
  if (
    mode === "demo" &&
    !["localhost", "127.0.0.1"].includes(
      new URL(process.env.DATABASE_URL || "http://invalid").hostname,
    )
  )
    throw new Error("Demo database must be local.");
  if (
    mode === "demo" &&
    !["localhost", "127.0.0.1"].includes(new URL(url).hostname)
  )
    throw new Error("Demo Auth and Storage must be local.");
  for (const key of [
    "DATABASE_URL",
    "SUPABASE_URL",
    "SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "CSRF_SECRET",
  ])
    if (!process.env[key])
      throw new Error(
        `Missing ${key}. Run pnpm setup or configure the live environment.`,
      );
  const origin = process.env.APP_ORIGIN || "http://127.0.0.1:3210";
  const parsedOrigin = new URL(origin);
  if (
    mode === "live" &&
    parsedOrigin.protocol !== "https:" &&
    !["127.0.0.1", "localhost", "[::1]"].includes(parsedOrigin.hostname)
  )
    throw new Error("Live access requires HTTPS or a private loopback origin.");
  const database = new URL(process.env.DATABASE_URL!);
  const databaseTls =
    mode === "live" &&
    !["127.0.0.1", "localhost", "[::1]"].includes(database.hostname);
  if (databaseTls) {
    // URL SSL options must not replace the explicit verified TLS configuration.
    for (const key of ["sslmode", "sslcert", "sslkey", "sslrootcert"])
      database.searchParams.delete(key);
  }
  return {
    mode,
    databaseTls,
    origin,
    databaseCaFile: process.env.DATABASE_SSL_CA_FILE,
    databaseCa: process.env.DATABASE_SSL_CA,
    databasePoolMax: Math.min(
      12,
      Math.max(1, Number(process.env.DB_POOL_MAX) || 12),
    ),
    secureCookies: parsedOrigin.protocol === "https:",
    databaseUrl: database.toString(),
    supabaseUrl: url,
    anonKey: process.env.SUPABASE_ANON_KEY!,
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    csrfSecret: process.env.CSRF_SECRET!,
    livePublishing: process.env.MEDIAFLOCK_LIVE_PUBLISHING_ENABLED === "true",
  };
}
