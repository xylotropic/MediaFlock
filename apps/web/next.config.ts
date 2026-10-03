import type { NextConfig } from "next";
const config: NextConfig = {
  reactStrictMode: true,
  distDir:
    process.env.MEDIAFLOCK_ENV_FILE === ".env.demo" ? ".next-demo" : ".next",
  devIndicators: false,
  serverExternalPackages: ["pg", "dotenv"],
  poweredByHeader: false,
  outputFileTracingRoot: process.cwd(),
  turbopack: { root: process.cwd() },
};
export default config;
