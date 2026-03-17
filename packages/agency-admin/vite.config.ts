import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import devServer from "@hono/vite-dev-server";

export default defineConfig({
  server: {
    port: 5176,
  },
  plugins: [
    // Rewrite .js imports to .ts/.tsx for TypeScript ESM compatibility
    {
      name: "resolve-ts-extensions",
      enforce: "pre",
      async resolveId(source, importer) {
        if (!importer || !source.endsWith(".js")) return null;
        if (source.includes("node_modules") || importer.includes("node_modules")) return null;
        for (const ext of [".ts", ".tsx"]) {
          const tsSource = source.slice(0, -3) + ext;
          const resolved = await this.resolve(tsSource, importer, { skipSelf: true });
          if (resolved) return resolved;
        }
        return null;
      },
    },
    react(),
    devServer({
      entry: "src/server.ts",
      exclude: [
        /^\/$/,
        /^\/@.+$/,
        /^\/src\/.+/,
        /^\/node_modules\/.*/,
        /^\/.+\.(css|ts|tsx|js|jsx|html|svg|png|ico|json)$/,
      ],
      injectClientScript: false,
    }),
  ],
});
