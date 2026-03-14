/**
 * Risk Engine — Fraud signal evaluation and step-up trigger.
 *
 * Evaluates a set of signals about the current request and returns
 * a risk score (0–100) with recommended actions. Used by the authorize
 * flow to determine if step-up authentication should be forced.
 */
import type { Env } from "@logingov/shared";
import { kvGet, KV_KEYS } from "@logingov/shared";

// ── Types ───────────────────────────────────────────────────

export interface RiskSignals {
  ip: string;
  userId?: string;
  userAgent?: string;
  geo?: { country?: string; city?: string };
  failedAttempts?: number;
  isNewDevice?: boolean;
  sessionAge?: number; // seconds since last login
}

export type RiskAction = "allow" | "step_up_mfa" | "captcha" | "block" | "rate_limit";

export type RiskLevel = "low" | "medium" | "high";

export interface RiskResult {
  score: number;
  level: RiskLevel;
  actions: RiskAction[];
}

// ── Scoring constants ───────────────────────────────────────

const SCORE_FAILED_ATTEMPTS_THRESHOLD = 3;
const SCORE_FAILED_ATTEMPTS = 30;
const SCORE_NEW_DEVICE = 10;
const SCORE_GEO_MISMATCH = 20;
const SCORE_BLOCKED_IP = 40;
const SCORE_RECENTLY_LOCKED = 25;

// ── Action thresholds ───────────────────────────────────────

const THRESHOLD_STEP_UP = 31;
const THRESHOLD_CAPTCHA = 51;
const THRESHOLD_BLOCK = 71;

// ── Engine ──────────────────────────────────────────────────

/**
 * Evaluate risk signals and return a score with recommended actions.
 */
export async function evaluateRisk(
  signals: RiskSignals,
  env: Env
): Promise<RiskResult> {
  let score = 0;

  // 1. Failed attempts (from KV rate limit counters)
  if (signals.failedAttempts !== undefined && signals.failedAttempts > SCORE_FAILED_ATTEMPTS_THRESHOLD) {
    score += SCORE_FAILED_ATTEMPTS;
  } else if (signals.userId) {
    // Check KV for recent failures
    const rlKey = KV_KEYS.rateLimit(`mfa:${signals.userId}`);
    const stored = await kvGet<{ count: number }>(env.KV_RATE_LIMIT, rlKey);
    if (stored && stored.count > SCORE_FAILED_ATTEMPTS_THRESHOLD) {
      score += SCORE_FAILED_ATTEMPTS;
    }
  }

  // 2. New device (no remembered session)
  if (signals.isNewDevice) {
    score += SCORE_NEW_DEVICE;
  }

  // 3. Geo mismatch — check last known country against current
  if (signals.userId && signals.geo?.country) {
    const lastCountryKey = `risk:last_country:${signals.userId}`;
    const lastCountry = await env.KV_FLAGS.get(lastCountryKey);
    if (lastCountry && lastCountry !== signals.geo.country) {
      score += SCORE_GEO_MISMATCH;
    }
    // Update last known country
    await env.KV_FLAGS.put(lastCountryKey, signals.geo.country, { expirationTtl: 30 * 24 * 60 * 60 });
  }

  // 4. Known blocked IP
  const blockedIps = await kvGet<string[]>(env.KV_FLAGS, "blocked_ips");
  if (blockedIps && blockedIps.includes(signals.ip)) {
    score += SCORE_BLOCKED_IP;
  }

  // 5. Account recently locked
  if (signals.userId) {
    const lockedKey = `risk:recently_locked:${signals.userId}`;
    const wasLocked = await env.KV_FLAGS.get(lockedKey);
    if (wasLocked) {
      score += SCORE_RECENTLY_LOCKED;
    }
  }

  // Clamp score to 0-100
  score = Math.min(100, Math.max(0, score));

  // Determine actions
  const actions = determineActions(score);
  const level = determineLevel(score);

  return { score, level, actions };
}

function determineActions(score: number): RiskAction[] {
  if (score >= THRESHOLD_BLOCK) {
    return ["block"];
  }
  if (score >= THRESHOLD_CAPTCHA) {
    return ["captcha", "step_up_mfa"];
  }
  if (score >= THRESHOLD_STEP_UP) {
    return ["step_up_mfa"];
  }
  return ["allow"];
}

function determineLevel(score: number): RiskLevel {
  if (score >= THRESHOLD_BLOCK) return "high";
  if (score >= THRESHOLD_STEP_UP) return "medium";
  return "low";
}

/**
 * Record that an account was recently locked (for risk scoring).
 * Called by fraud/lockout handlers.
 */
export async function recordAccountLock(env: Env, userId: string): Promise<void> {
  await env.KV_FLAGS.put(
    `risk:recently_locked:${userId}`,
    "1",
    { expirationTtl: 7 * 24 * 60 * 60 } // 7 days
  );
}
