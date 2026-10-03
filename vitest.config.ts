import { defineConfig } from "vitest/config";
process.env.MEDIAFLOCK_ENV_FILE = ".env.demo";
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 30000,
  },
});
