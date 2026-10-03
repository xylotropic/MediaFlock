import { defineConfig, globalIgnores } from "eslint/config";
import { fixupConfigRules } from "@eslint/compat";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
export default defineConfig([
  { settings: { next: { rootDir: "apps/web/" } } },
  ...fixupConfigRules([...nextVitals, ...nextTs]),
  // Upstream EvilCharts keeps its imperative ECharts runtime in a stable ref.
  // It is used without React Compiler; browser tests verify the actual lifecycle.
  {
    files: ["apps/web/components/evilcharts/**/*.tsx"],
    rules: { "react-hooks/refs": "off" },
  },
  globalIgnores([
    "**/.next/**",
    "**/.next-demo/**",
    "artifacts/**",
    "docs/**",
    "supabase/**",
  ]),
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@next/next/no-img-element": "off",
    },
  },
]);
