/**
 * Service Provider lookup with KV caching.
 * Loads SP config from PlanetScale and caches in KV_SP_CONFIG.
 */
import { getDb } from "@logingov/shared/db";
import { eq } from "drizzle-orm";
import { serviceProviders } from "@logingov/shared";
import type { Env, ServiceProvider } from "@logingov/shared";
import { kvGet, kvPut, KV_KEYS, KV_TTL } from "@logingov/shared";

/**
 * Look up a service provider by its issuer URI (client_id).
 * Checks KV cache first, then PlanetScale. Returns null if not found.
 */
export async function lookupServiceProvider(
  spId: string,
  env: Env
): Promise<ServiceProvider | null> {
  // Check KV cache
  const cached = await kvGet<ServiceProvider>(env.KV_SP_CONFIG, KV_KEYS.spConfig(spId));
  if (cached) {
    return cached;
  }

  // Query PlanetScale
  const db = getDb(env);
  const rows = await db
    .select()
    .from(serviceProviders)
    .where(eq(serviceProviders.id, spId))
    .limit(1);

  if (rows.length === 0) {
    return null;
  }

  const row = rows[0];
  let postLogoutRedirectUris: string[] | null = null;
  if (row.postLogoutRedirectUris) {
    try {
      postLogoutRedirectUris = JSON.parse(row.postLogoutRedirectUris);
    } catch {
      // Column contains non-JSON data; treat as null
    }
  }

  const sp: ServiceProvider = {
    id: row.id,
    name: row.name,
    ialMax: row.ialMax as 1 | 2,
    aalMax: row.aalMax as 1 | 2,
    redirectUris: JSON.parse(row.redirectUris),
    publicKey: row.publicKey,
    samlMetadataUrl: row.samlMetadataUrl,
    pushNotificationUrl: row.pushNotificationUrl,
    postLogoutRedirectUris,
    createdAt: row.createdAt,
  };

  // Cache in KV
  await kvPut(env.KV_SP_CONFIG, KV_KEYS.spConfig(spId), sp, KV_TTL.SP_CONFIG);

  return sp;
}
