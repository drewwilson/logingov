/**
 * Centralized database connection helper for PlanetScale via Hyperdrive.
 * Uses Hyperdrive in deployed environments, DATABASE_URL for local dev.
 *
 * Local dev: point DATABASE_URL at a PlanetScale-compatible HTTP proxy
 * (see scripts/ps-proxy.ts) since @planetscale/database is HTTP-only.
 */
import { Client } from "@planetscale/database";
import { drizzle } from "drizzle-orm/planetscale-serverless";
import type { Env } from "./env.js";

export function getDb(env: Env) {
  const url = env.DATABASE_URL ?? env.HYPERDRIVE?.connectionString;
  if (!url) throw new Error("No database connection: set HYPERDRIVE or DATABASE_URL");
  const client = new Client({ url });
  return drizzle(client);
}
