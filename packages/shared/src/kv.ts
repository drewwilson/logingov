/**
 * KV key naming conventions and typed helpers.
 */

// ── Key patterns ────────────────────────────────────────────

export const KV_KEYS = {
  /** Session token → session data */
  session: (tokenHash: string) => `session:${tokenHash}`,

  /** Service provider config cache */
  spConfig: (spId: string) => `sp:${spId}`,

  /** JWKS public key set */
  jwks: () => "jwks:current",

  /** Individual signing key by kid */
  signingKey: (kid: string) => `key:${kid}`,

  /** Feature flag */
  flag: (name: string) => `flag:${name}`,

  /** OTP code (10min TTL) */
  otp: (userId: string, purpose: string) => `otp:${userId}:${purpose}`,

  /** Rate limit counter */
  rateLimit: (key: string) => `rl:${key}`,
} as const;

// ── TTL constants (seconds) ─────────────────────────────────

export const KV_TTL = {
  SESSION: 15 * 60, // 15 minutes (auth flow)
  SESSION_REMEMBERED: 30 * 24 * 60 * 60, // 30 days (remembered device)
  SP_CONFIG: 60 * 60, // 1 hour
  JWKS: 7 * 24 * 60 * 60, // 7 days — cron refreshes hourly but keys must survive cron failures
  OTP: 10 * 60, // 10 minutes
  RATE_LIMIT: 60, // 1 minute window
  ACCESS_TOKEN: 15 * 60, // 15 minutes
} as const;

// ── Typed KV get/put helpers ────────────────────────────────

export async function kvGet<T>(kv: KVNamespace, key: string): Promise<T | null> {
  const value = await kv.get(key, "text");
  if (value === null) return null;
  return JSON.parse(value) as T;
}

export async function kvPut<T>(
  kv: KVNamespace,
  key: string,
  value: T,
  ttlSeconds?: number
): Promise<void> {
  await kv.put(key, JSON.stringify(value), ttlSeconds ? { expirationTtl: ttlSeconds } : undefined);
}

export async function kvDelete(kv: KVNamespace, key: string): Promise<void> {
  await kv.delete(key);
}

// ── Feature flag helpers ──────────────────────────────────

/**
 * Read a boolean feature flag from KV_FLAGS.
 * Values "true" or "1" are truthy; anything else (including missing) returns fallback.
 */
export async function getFlag(kv: KVNamespace, flag: string, fallback = false): Promise<boolean> {
  const val = await kv.get(KV_KEYS.flag(flag));
  if (val === null) return fallback;
  return val === "true" || val === "1";
}

/**
 * Read multiple feature flags in parallel.
 */
export async function getFlags(kv: KVNamespace, flags: string[]): Promise<Record<string, boolean>> {
  const results: Record<string, boolean> = {};
  await Promise.all(flags.map(async (f) => { results[f] = await getFlag(kv, f); }));
  return results;
}
