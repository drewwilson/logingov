/**
 * Rate limiter middleware — Application-layer sliding window counter.
 *
 * Two layers of rate limiting protect Login.gov:
 *
 * ## Layer 1: Edge (Cloudflare WAF)
 * Configure via Cloudflare Dashboard > Security > WAF > Rate Limiting Rules:
 *   - Rule: "Login endpoint" — /auth/authorize, /auth/token
 *     - Threshold: 30 requests per 60 seconds per IP
 *     - Action: Block for 60 seconds, return 429
 *   - Rule: "MFA verification" — /mfa/verify
 *     - Threshold: 10 requests per 60 seconds per IP
 *     - Action: Block for 120 seconds, return 429
 *   - Rule: "Global" — all paths
 *     - Threshold: 300 requests per 60 seconds per IP
 *     - Action: Challenge for 300 seconds
 *
 * ## Layer 2: Application (this middleware)
 * Uses KV_RATE_LIMIT for a sliding window counter per key.
 * More granular — can rate limit by user_id, endpoint, or composite key.
 */

import type { Context, MiddlewareHandler } from "hono";
import type { Env } from "@logingov/shared";
import { KV_KEYS, KV_TTL, kvGet, kvPut, RateLimitError, errorResponse } from "@logingov/shared";

// ── Rate limit thresholds per endpoint pattern ──────────────

export interface RateLimitConfig {
  /** Max requests in the window */
  maxRequests: number;
  /** Window duration in seconds */
  windowSeconds: number;
}

/**
 * Default thresholds keyed by endpoint pattern.
 * Override by passing a custom config to the middleware factory.
 */
export const DEFAULT_RATE_LIMITS: Record<string, RateLimitConfig> = {
  "POST /auth/token": { maxRequests: 20, windowSeconds: 60 },
  "POST /auth/authorize": { maxRequests: 30, windowSeconds: 60 },
  "POST /mfa/verify": { maxRequests: 5, windowSeconds: 60 },
  "POST /mfa/send": { maxRequests: 3, windowSeconds: 60 },
  "POST /account/password": { maxRequests: 5, windowSeconds: 300 },
  "POST /proofing/submit": { maxRequests: 3, windowSeconds: 300 },
  _default: { maxRequests: 60, windowSeconds: 60 },
};

// ── Sliding window state stored in KV ───────────────────────

interface WindowState {
  /** Timestamps of requests in the current window */
  timestamps: number[];
}

// ── Key extractor ───────────────────────────────────────────

export type RateLimitKeyExtractor = (c: Context<{ Bindings: Env }>) => string;

/**
 * Default key: IP address + method + path
 */
export const defaultKeyExtractor: RateLimitKeyExtractor = (c) => {
  const ip = c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for") ?? "unknown";
  return `${ip}:${c.req.method}:${new URL(c.req.url).pathname}`;
};

// ── Middleware factory ──────────────────────────────────────

export interface RateLimiterOptions {
  /** Custom thresholds per route pattern */
  limits?: Record<string, RateLimitConfig>;
  /** Custom key extractor (default: IP + method + path) */
  keyExtractor?: RateLimitKeyExtractor;
}

// Security-critical endpoints where race-condition bypass is most dangerous.
// For these, we reduce the effective KV limit to account for potential TOCTOU
// concurrent bypass (KV read-then-write is not atomic).
const SECURITY_CRITICAL_PATTERNS = new Set([
  "POST /mfa/verify",
  "POST /mfa/send",
  "POST /account/password",
  "POST /proofing/submit",
]);

/**
 * Hono middleware that enforces sliding-window rate limits via KV_RATE_LIMIT.
 *
 * Usage:
 *   app.use("*", rateLimiter());
 *   app.use("/auth/*", rateLimiter({ limits: { ... } }));
 *
 * SECURITY NOTE: The KV read-then-write cycle is not atomic (TOCTOU race).
 * Under high concurrency, a burst of requests between read and write can
 * bypass the limit. For security-critical endpoints, the effective limit is
 * reduced to Math.ceil(configuredLimit * 0.6) to account for potential races.
 * TODO: migrate to Durable Object counters for atomic rate limiting
 */
export function rateLimiter(options?: RateLimiterOptions): MiddlewareHandler<{ Bindings: Env }> {
  const limits = { ...DEFAULT_RATE_LIMITS, ...options?.limits };
  const extractKey = options?.keyExtractor ?? defaultKeyExtractor;

  return async (c, next) => {
    const kv = c.env.KV_RATE_LIMIT;
    const routeKey = `${c.req.method} ${new URL(c.req.url).pathname}`;

    // Find matching config: exact match > default
    const config = limits[routeKey] ?? limits._default;
    const { windowSeconds } = config;

    // For security-critical endpoints, tighten the effective limit to
    // compensate for KV's non-atomic read-then-write race window.
    const effectiveMaxRequests = SECURITY_CRITICAL_PATTERNS.has(routeKey)
      ? Math.ceil(config.maxRequests * 0.6)
      : config.maxRequests;

    const rateLimitKey = KV_KEYS.rateLimit(extractKey(c));
    const now = Date.now();
    const windowStart = now - windowSeconds * 1000;

    // Read current window state
    // TODO: migrate to Durable Object counters for atomic rate limiting
    const state = await kvGet<WindowState>(kv, rateLimitKey);
    const timestamps = state?.timestamps.filter((ts) => ts > windowStart) ?? [];

    if (timestamps.length >= effectiveMaxRequests) {
      // Find when the oldest request in the window will expire
      const oldestInWindow = Math.min(...timestamps);
      const retryAfter = Math.ceil((oldestInWindow + windowSeconds * 1000 - now) / 1000);
      return errorResponse(new RateLimitError(Math.max(retryAfter, 1)));
    }

    // Record this request
    timestamps.push(now);
    await kvPut(kv, rateLimitKey, { timestamps } satisfies WindowState, windowSeconds);

    // Set rate limit headers for client visibility (expose configured limit, not internal effective limit)
    c.header("X-RateLimit-Limit", String(config.maxRequests));
    c.header("X-RateLimit-Remaining", String(effectiveMaxRequests - timestamps.length));
    c.header("X-RateLimit-Reset", String(Math.ceil((windowStart + windowSeconds * 1000) / 1000)));

    await next();
  };
}
