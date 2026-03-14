import { defineConfig } from "vitest/config";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    globals: true,
    include: ["packages/**/src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@logingov/shared": path.resolve(__dirname, "packages/shared/src"),
      "@logingov/infra": path.resolve(__dirname, "packages/infra/src/index.ts"),
      "@logingov/session-do": path.resolve(
        __dirname,
        "packages/session-do/src/index.ts",
      ),
    },
  },
});
