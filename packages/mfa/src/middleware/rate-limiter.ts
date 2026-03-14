/**
 * MFA Rate Limiting / Lockout Middleware
 *
 * Uses KV_RATE_LIMIT to track failed MFA attempts per user.
 * After 5 consecutive failures within the TTL window, sets users.locked_at in DB.
 * Clears the counter on successful MFA verification.
 */
import type { Context, Next } from "hono";
import type { Env } from "@logingov/shared";
import { KV_KEYS, KV_TTL, kvGet, kvPut, kvDelete } from "@logingov/shared";
import { RateLimitError, UnauthorizedError, errorResponse } from "@logingov/shared";
import { users } from "@logingov/shared";
import { eq } from "drizzle-orm";
import { getDb } from "@logingov/shared/db";

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_WINDOW_SECONDS = 15 * 60; // 15-minute sliding window

interface RateLimitEntry {
  attempts: number;
  firstAttemptAt: string;
}

// ── Middleware: Check rate limit before MFA attempt ──────────

/**
 * Checks whether the user is locked out or has exceeded the MFA attempt limit.
 * Attach this middleware before any MFA verification handler.
 */
export function checkMfaRateLimit() {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    const userId = c.req.header("X-User-Id");
    if (!userId) {
      return errorResponse(new UnauthorizedError("Missing user identity"));
    }

    // Check if account is locked
    const db = getDb(c.env);
    const [user] = await db
      .select({ lockedAt: users.lockedAt })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (user?.lockedAt) {
      return c.json(
        {
          error: "account_locked",
          message: "Account is locked due to too many failed MFA attempts. Contact support.",
          locked_at: user.lockedAt,
        },
        423
      );
    }

    // Check KV rate limit counter
    const rlKey = KV_KEYS.rateLimit(`mfa:${userId}`);
    const entry = await kvGet<RateLimitEntry>(c.env.KV_RATE_LIMIT, rlKey);

    if (entry && entry.attempts >= MAX_FAILED_ATTEMPTS) {
      // Lock the account
      await db
        .update(users)
        .set({ lockedAt: new Date().toISOString() })
        .where(eq(users.id, userId));

      return c.json(
        {
          error: "account_locked",
          message: "Account locked after too many failed MFA attempts",
        },
        423
      );
    }

    c.set("userId" as never, userId);
    await next();
  };
}

// ── Record failed MFA attempt ────────────────────────────────

/**
 * Increment the failed attempt counter for a user.
 * Returns the new attempt count.
 */
export async function recordFailedAttempt(env: Env, userId: string): Promise<number> {
  const rlKey = KV_KEYS.rateLimit(`mfa:${userId}`);
  const entry = await kvGet<RateLimitEntry>(env.KV_RATE_LIMIT, rlKey);

  const newEntry: RateLimitEntry = {
    attempts: (entry?.attempts ?? 0) + 1,
    firstAttemptAt: entry?.firstAttemptAt ?? new Date().toISOString(),
  };

  await kvPut(env.KV_RATE_LIMIT, rlKey, newEntry, LOCKOUT_WINDOW_SECONDS);

  // If this pushes us to the limit, lock the account
  if (newEntry.attempts >= MAX_FAILED_ATTEMPTS) {
    const db = getDb(env);
    await db
      .update(users)
      .set({ lockedAt: new Date().toISOString() })
      .where(eq(users.id, userId));
  }

  return newEntry.attempts;
}

// ── Clear rate limit on success ──────────────────────────────

/**
 * Clear the failed attempt counter after a successful MFA verification.
 */
export async function clearRateLimit(env: Env, userId: string): Promise<void> {
  const rlKey = KV_KEYS.rateLimit(`mfa:${userId}`);
  await kvDelete(env.KV_RATE_LIMIT, rlKey);
}
