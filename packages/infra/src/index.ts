/**
 * @logingov/infra Worker — Infrastructure services.
 *
 * Exports:
 *  - Rate limiter middleware
 *  - Session management helpers
 *  - i18n translation framework
 *  - Queue producer + base consumer
 *  - Observability (tracing middleware + structured logger)
 *  - JWKS key rotation (cron)
 *
 * Wires:
 *  - Cron Triggers: JWKS rotation (hourly), cleanup (5min), audit flush (daily)
 *  - Queue consumers: QUEUE_AUDIT
 */

import { Hono } from "hono";
import type { Env } from "@logingov/shared";

// ── Feature modules ─────────────────────────────────────────

// Rate limiting
export { rateLimiter, DEFAULT_RATE_LIMITS } from "./rate-limiter.js";
export type { RateLimitConfig, RateLimiterOptions, RateLimitKeyExtractor } from "./rate-limiter.js";

// Session management
export { createSession, getSession, updateSession, destroySession } from "./session/helpers.js";
export type { CreateSessionParams, SessionResponse } from "./session/helpers.js";

// i18n
export { t, detectLocale, SUPPORTED_LOCALES } from "./i18n/index.js";
export type { SupportedLocale } from "./i18n/index.js";

// Queue infrastructure
export { BaseConsumer } from "./queue/base-consumer.js";
export type { ConsumerContext, ConsumerOptions } from "./queue/base-consumer.js";
export { enqueue, enqueueBatch } from "./queue/producer.js";

// Audit consumer
export { AuditConsumer, auditConsumer } from "./consumers/audit-consumer.js";

// Key rotation
export { handleKeyRotation, getPublicJWKS, getCurrentSigningKid } from "./cron/key-rotation.js";
export type { JWK, JWKS } from "./cron/key-rotation.js";

// Risk engine
export { evaluateRisk, recordAccountLock } from "./risk/engine.js";
export type { RiskSignals, RiskResult, RiskAction, RiskLevel } from "./risk/engine.js";

// Observability
export { tracing, getTraceContext } from "./observability/otel.js";
export type { TraceContext, TracingOptions } from "./observability/otel.js";
export { Logger, logger } from "./observability/logger.js";
export type { LogLevel, LogContext } from "./observability/logger.js";
export { ALERT_THRESHOLDS, SERVICE_LEVEL_OBJECTIVES, HEALTH_CHECKS } from "./observability/alerts.js";
export type { AlertThreshold, SLO, Severity, HealthCheckConfig } from "./observability/alerts.js";

// ── Internal imports for wiring ─────────────────────────────

import { rateLimiter } from "./rate-limiter.js";
import { tracing } from "./observability/otel.js";
import { getPublicJWKS, handleKeyRotation } from "./cron/key-rotation.js";
import { handleCleanup } from "./cron/cleanup.js";
import { auditConsumer } from "./consumers/audit-consumer.js";
import type { QueueMessage, AuditWritePayload } from "@logingov/shared";

// ── Hono app ────────────────────────────────────────────────

const app = new Hono<{ Bindings: Env }>();

// Global middleware
app.use("*", tracing({ serviceName: "infra" }));
app.use("*", rateLimiter());

// Health check
app.get("/health", (c) => c.json({ ok: true, service: "infra" }));

// JWKS endpoint (public keys for token verification)
app.get("/.well-known/jwks.json", async (c) => {
  const jwks = await getPublicJWKS(c.env);
  return c.json(jwks, 200, {
    "Cache-Control": "public, max-age=3600",
  });
});

// ── Worker export with cron + queue handlers ────────────────

export default {
  fetch: app.fetch,

  /**
   * Cron Trigger handler.
   * Dispatches based on the cron schedule defined in wrangler.toml:
   *   - "0 *\/1 * * *"  → JWKS rotation check (hourly)
   *   - "*\/5 * * * *"  → expired code cleanup (every 5 min)
   *   - "0 0 * * *"     → audit log daily flush (handled by queue consumer)
   */
  async scheduled(
    event: ScheduledEvent,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    switch (event.cron) {
      case "0 */1 * * *":
        // Hourly JWKS rotation check
        ctx.waitUntil(handleKeyRotation(env));
        break;

      case "*/5 * * * *":
        // Expired auth code cleanup (every 5 min)
        ctx.waitUntil(handleCleanup(env));
        break;

      case "0 0 * * *":
        // Daily — no-op here, audit is continuous via queue consumer.
        // This slot is available for future daily maintenance tasks.
        break;

      default:
        console.log(
          JSON.stringify({
            level: "warn",
            message: "Unknown cron schedule",
            cron: event.cron,
            timestamp: new Date().toISOString(),
          })
        );
    }
  },

  /**
   * Queue consumer handler.
   * Routes batches to the appropriate consumer based on queue name.
   */
  async queue(
    batch: MessageBatch<QueueMessage<AuditWritePayload>>,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    switch (batch.queue) {
      case "logingov-audit":
        await auditConsumer.handle(batch, env, ctx);
        break;

      default:
        console.log(
          JSON.stringify({
            level: "warn",
            message: "Unhandled queue",
            queue: batch.queue,
            batchSize: batch.messages.length,
            timestamp: new Date().toISOString(),
          })
        );
        // Ack to avoid infinite retry
        for (const msg of batch.messages) {
          msg.ack();
        }
    }
  },
};
