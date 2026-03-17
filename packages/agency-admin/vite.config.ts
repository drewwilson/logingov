import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import devServer from "@hono/vite-dev-server";

export default defineConfig({
  server: {
    port: 5176,
  },
  plugins: [
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
