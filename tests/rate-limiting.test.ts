/**
 * Tests for rate limiting patterns used across login.gov.
 *
 * Tests the KV-based rate limiting storage pattern used by MFA routes
 * (packages/mfa/src/middleware/rate-limiter.ts) and SMS OTP send limiting
 * (packages/mfa/src/routes/sms-otp.ts).
 *
 * Based on upstream spec/requests/rack_attack_spec.rb.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { MockKV, createMockEnv } from "./helpers.js";

// ── Constants matching production code ───────────────────────

const MFA_MAX_ATTEMPTS = 5;
const MFA_LOCKOUT_WINDOW_SECONDS = 15 * 60;

const SMS_SEND_MAX = 3;
const SMS_SEND_WINDOW_SECONDS = 10 * 60;

// ── KV helpers (mirror packages/shared/src/kv.ts) ───────────

function rlKey(scope: string): string {
  return `rl:${scope}`;
}

async function kvGet<T>(kv: MockKV, key: string): Promise<T | null> {
  const value = await kv.get(key);
  if (value === null) return null;
  return JSON.parse(value) as T;
}

async function kvPut<T>(
  kv: MockKV,
  key: string,
  value: T,
  ttlSeconds?: number
): Promise<void> {
  await kv.put(key, JSON.stringify(value), ttlSeconds ? { expirationTtl: ttlSeconds } : undefined);
}

// ── Rate limit entry types ──────────────────────────────────

interface MfaRateLimitEntry {
  attempts: number;
  firstAttemptAt: string;
}

interface SmsSendRateEntry {
  count: number;
  firstSendAt: string;
}

// ── Simulate the MFA rate limit logic ───────────────────────

async function recordFailedMfaAttempt(kv: MockKV, userId: string): Promise<number> {
  const key = rlKey(`mfa:${userId}`);
  const entry = await kvGet<MfaRateLimitEntry>(kv, key);

  const newEntry: MfaRateLimitEntry = {
    attempts: (entry?.attempts ?? 0) + 1,
    firstAttemptAt: entry?.firstAttemptAt ?? new Date().toISOString(),
  };

  await kvPut(kv, key, newEntry, MFA_LOCKOUT_WINDOW_SECONDS);
  return newEntry.attempts;
}

async function checkMfaLocked(kv: MockKV, userId: string): Promise<boolean> {
  const key = rlKey(`mfa:${userId}`);
  const entry = await kvGet<MfaRateLimitEntry>(kv, key);
  return entry !== null && entry.attempts >= MFA_MAX_ATTEMPTS;
}

async function clearMfaRateLimit(kv: MockKV, userId: string): Promise<void> {
  const key = rlKey(`mfa:${userId}`);
  await kv.delete(key);
}

// ── Simulate the SMS send rate limit logic ──────────────────

async function recordSmsSend(kv: MockKV, userId: string): Promise<{ allowed: boolean; count: number }> {
  const key = rlKey(`sms_send:${userId}`);
  const entry = await kvGet<SmsSendRateEntry>(kv, key);

  if (entry && entry.count >= SMS_SEND_MAX) {
    return { allowed: false, count: entry.count };
  }

  const newEntry: SmsSendRateEntry = {
    count: (entry?.count ?? 0) + 1,
    firstSendAt: entry?.firstSendAt ?? new Date().toISOString(),
  };

  await kvPut(kv, key, newEntry, SMS_SEND_WINDOW_SECONDS);
  return { allowed: true, count: newEntry.count };
}

// ── Tests ────────────────────────────────────────────────────

describe("Rate Limiting (KV-based)", () => {
  let kv: MockKV;

  beforeEach(() => {
    kv = new MockKV();
  });

  // ── Basic KV counter tracking ─────────────────────────────

  it("tracks request counts in KV", async () => {
    const count = await recordFailedMfaAttempt(kv, "user-123");
    expect(count).toBe(1);

    const entry = await kvGet<MfaRateLimitEntry>(kv, rlKey("mfa:user-123"));
    expect(entry).not.toBeNull();
    expect(entry!.attempts).toBe(1);
    expect(entry!.firstAttemptAt).toBeDefined();
  });

  it("rate limit counter increments correctly", async () => {
    for (let i = 1; i <= 4; i++) {
      const count = await recordFailedMfaAttempt(kv, "user-abc");
      expect(count).toBe(i);
    }

    const entry = await kvGet<MfaRateLimitEntry>(kv, rlKey("mfa:user-abc"));
    expect(entry!.attempts).toBe(4);
  });

  // ── First request is not limited ──────────────────────────

  it("first request is not rate limited", async () => {
    const isLocked = await checkMfaLocked(kv, "fresh-user");
    expect(isLocked).toBe(false);
  });

  // ── Requests within limit pass through ────────────────────

  it("requests within limit pass through", async () => {
    for (let i = 0; i < MFA_MAX_ATTEMPTS - 1; i++) {
      await recordFailedMfaAttempt(kv, "user-within");
    }
    const isLocked = await checkMfaLocked(kv, "user-within");
    expect(isLocked).toBe(false);
  });

  // ── Exceeding max requests triggers lockout ───────────────

  it("exceeding max requests returns locked status", async () => {
    for (let i = 0; i < MFA_MAX_ATTEMPTS; i++) {
      await recordFailedMfaAttempt(kv, "user-exceed");
    }
    const isLocked = await checkMfaLocked(kv, "user-exceed");
    expect(isLocked).toBe(true);
  });

  // ── Window expiration ─────────────────────────────────────

  it("rate limit window expires and requests pass again", async () => {
    // Simulate: put an entry that has already expired
    // MockKV uses epoch seconds for expiration
    const expiredEntry: MfaRateLimitEntry = {
      attempts: MFA_MAX_ATTEMPTS,
      firstAttemptAt: new Date(Date.now() - MFA_LOCKOUT_WINDOW_SECONDS * 1000 - 1000).toISOString(),
    };
    // Store with a TTL of 1 second (already nearly expired)
    // We simulate expiration by setting expirationTtl to 0 — MockKV will
    // compute expiration as now + 0 = now, so get() sees it as expired.
    const key = rlKey("mfa:user-expired");
    const store = kv._getStore();
    store.set(key, {
      value: JSON.stringify(expiredEntry),
      expiration: Math.floor(Date.now() / 1000) - 1, // already in the past
    });

    // Should return null (expired)
    const entry = await kvGet<MfaRateLimitEntry>(kv, key);
    expect(entry).toBeNull();

    // New attempts start fresh
    const isLocked = await checkMfaLocked(kv, "user-expired");
    expect(isLocked).toBe(false);
  });

  // ── Independent rate limits per user ──────────────────────

  it("different users have independent rate limits", async () => {
    // Lock out user-A
    for (let i = 0; i < MFA_MAX_ATTEMPTS; i++) {
      await recordFailedMfaAttempt(kv, "user-A");
    }

    // user-B should be unaffected
    await recordFailedMfaAttempt(kv, "user-B");

    expect(await checkMfaLocked(kv, "user-A")).toBe(true);
    expect(await checkMfaLocked(kv, "user-B")).toBe(false);
  });

  // ── Clearing rate limit on success ────────────────────────

  it("clearing rate limit resets the counter", async () => {
    // Accumulate some failures
    for (let i = 0; i < 3; i++) {
      await recordFailedMfaAttempt(kv, "user-clear");
    }
    expect((await kvGet<MfaRateLimitEntry>(kv, rlKey("mfa:user-clear")))!.attempts).toBe(3);

    // Successful MFA clears the counter
    await clearMfaRateLimit(kv, "user-clear");
    const entry = await kvGet<MfaRateLimitEntry>(kv, rlKey("mfa:user-clear"));
    expect(entry).toBeNull();

    // User can attempt again
    const isLocked = await checkMfaLocked(kv, "user-clear");
    expect(isLocked).toBe(false);
  });

  // ── Rate limit response concept (Retry-After) ────────────

  it("rate limit entries include timing for Retry-After calculation", async () => {
    const before = new Date().toISOString();
    await recordFailedMfaAttempt(kv, "user-retry");
    const entry = await kvGet<MfaRateLimitEntry>(kv, rlKey("mfa:user-retry"));

    expect(entry).not.toBeNull();
    expect(entry!.firstAttemptAt).toBeDefined();

    // firstAttemptAt should be a valid ISO timestamp at or after our marker
    const firstAttempt = new Date(entry!.firstAttemptAt);
    expect(firstAttempt.getTime()).toBeGreaterThanOrEqual(new Date(before).getTime());

    // A Retry-After value could be computed as:
    // windowEnd = firstAttemptAt + LOCKOUT_WINDOW_SECONDS
    const windowEnd = firstAttempt.getTime() + MFA_LOCKOUT_WINDOW_SECONDS * 1000;
    const retryAfterSeconds = Math.ceil((windowEnd - Date.now()) / 1000);
    expect(retryAfterSeconds).toBeGreaterThan(0);
    expect(retryAfterSeconds).toBeLessThanOrEqual(MFA_LOCKOUT_WINDOW_SECONDS);
  });
});

// ── MFA Verify Rate Limiting ────────────────────────────────

describe("MFA Verify Rate Limiting", () => {
  let kv: MockKV;

  beforeEach(() => {
    kv = new MockKV();
  });

  it("allows up to 5 failed MFA attempts", async () => {
    for (let i = 1; i <= MFA_MAX_ATTEMPTS - 1; i++) {
      const count = await recordFailedMfaAttempt(kv, "mfa-user");
      expect(count).toBe(i);
    }
    expect(await checkMfaLocked(kv, "mfa-user")).toBe(false);
  });

  it("locks account on 5th failed attempt", async () => {
    for (let i = 1; i <= MFA_MAX_ATTEMPTS; i++) {
      await recordFailedMfaAttempt(kv, "mfa-lockout");
    }
    expect(await checkMfaLocked(kv, "mfa-lockout")).toBe(true);
  });

  it("6th attempt still shows locked", async () => {
    for (let i = 1; i <= MFA_MAX_ATTEMPTS + 1; i++) {
      await recordFailedMfaAttempt(kv, "mfa-over");
    }
    expect(await checkMfaLocked(kv, "mfa-over")).toBe(true);

    const entry = await kvGet<MfaRateLimitEntry>(kv, rlKey("mfa:mfa-over"));
    expect(entry!.attempts).toBe(MFA_MAX_ATTEMPTS + 1);
  });
});

// ── SMS Send Rate Limiting ──────────────────────────────────

describe("SMS Send Rate Limiting", () => {
  let kv: MockKV;

  beforeEach(() => {
    kv = new MockKV();
  });

  it("allows up to 3 sends per 10 minutes", async () => {
    for (let i = 1; i <= SMS_SEND_MAX; i++) {
      const result = await recordSmsSend(kv, "sms-user");
      expect(result.allowed).toBe(true);
      expect(result.count).toBe(i);
    }
  });

  it("rejects 4th send within window", async () => {
    // Use up the limit
    for (let i = 0; i < SMS_SEND_MAX; i++) {
      await recordSmsSend(kv, "sms-blocked");
    }

    // 4th attempt should be rejected
    const result = await recordSmsSend(kv, "sms-blocked");
    expect(result.allowed).toBe(false);
    expect(result.count).toBe(SMS_SEND_MAX); // counter not incremented
  });

  it("different users have independent SMS send limits", async () => {
    // Exhaust user-A's SMS sends
    for (let i = 0; i < SMS_SEND_MAX; i++) {
      await recordSmsSend(kv, "sms-user-A");
    }

    // user-B should still be able to send
    const result = await recordSmsSend(kv, "sms-user-B");
    expect(result.allowed).toBe(true);
    expect(result.count).toBe(1);
  });

  it("SMS send window expires and allows new sends", async () => {
    // Directly set an expired entry in the store
    const key = rlKey("sms_send:sms-expired");
    const expiredEntry: SmsSendRateEntry = {
      count: SMS_SEND_MAX,
      firstSendAt: new Date(Date.now() - SMS_SEND_WINDOW_SECONDS * 1000 - 1000).toISOString(),
    };
    const store = kv._getStore();
    store.set(key, {
      value: JSON.stringify(expiredEntry),
      expiration: Math.floor(Date.now() / 1000) - 1, // already past
    });

    // Expired entry should be gone
    const entry = await kvGet<SmsSendRateEntry>(kv, key);
    expect(entry).toBeNull();

    // New send should succeed
    const result = await recordSmsSend(kv, "sms-expired");
    expect(result.allowed).toBe(true);
    expect(result.count).toBe(1);
  });

  it("stores SMS send entries with the correct KV key pattern", async () => {
    await recordSmsSend(kv, "user-42");

    const entry = await kvGet<SmsSendRateEntry>(kv, "rl:sms_send:user-42");
    expect(entry).not.toBeNull();
    expect(entry!.count).toBe(1);
    expect(entry!.firstSendAt).toBeDefined();
  });
});
