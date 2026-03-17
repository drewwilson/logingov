import { defineConfig } from "vitest/config";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    globals: true,
    include: ["packages/**/src/**/*.test.ts", "tests/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@logingov/shared": path.resolve(__dirname, "packages/shared/src"),
      "@logingov/infra": path.resolve(__dirname, "packages/infra/src/index.ts"),
      "@logingov/session-do": path.resolve(
        __dirname,
        "packages/session-do/src/index.ts",
      ),
      "@logingov/auth-core/routes/certs": path.resolve(
        __dirname,
        "packages/auth-core/src/routes/certs.ts",
      ),
      "@logingov/auth-core/routes/userinfo": path.resolve(
        __dirname,
        "packages/auth-core/src/routes/userinfo.ts",
      ),
      "@logingov/auth-core/routes/logout": path.resolve(
        __dirname,
        "packages/auth-core/src/routes/logout.ts",
      ),
      "@logingov/auth-core": path.resolve(
        __dirname,
        "packages/auth-core/src/index.ts",
      ),
      hono: path.resolve(__dirname, "packages/auth-core/node_modules/hono"),
    },
  },
});
