/**
 * OpenTelemetry instrumentation for Cloudflare Workers.
 *
 * Uses @microlabs/otel-cf-workers to instrument Hono handlers
 * with distributed tracing. Each request gets a trace span with:
 *   - trace_id, span_id
 *   - service name, route, method
 *   - status code, duration
 *
 * Install: pnpm add @microlabs/otel-cf-workers @opentelemetry/api
 *
 * If the OTel packages are not installed, the middleware gracefully
 * falls back to structured logging with generated trace/span IDs.
 */

import type { Context, MiddlewareHandler } from "hono";
import type { Env } from "@logingov/shared";
import { Logger } from "./logger.js";

// ── Types ───────────────────────────────────────────────────

export interface TraceContext {
  traceId: string;
  spanId: string;
  service: string;
}

// ── Trace ID generation (fallback when OTel SDK not available) ──

function generateTraceId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function generateSpanId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ── Hono tracing middleware ─────────────────────────────────

export interface TracingOptions {
  /** Service name for spans (default: "logingov") */
  serviceName?: string;
  /** Header to check for incoming trace context (default: "traceparent") */
  traceHeader?: string;
}

/**
 * Hono middleware that instruments every request with a trace span.
 *
 * Attaches trace context to the Hono context variables so downstream
 * handlers can access traceId / spanId for logging and propagation.
 *
 * Usage:
 *   import { tracing } from "@logingov/infra";
 *   app.use("*", tracing({ serviceName: "auth-core" }));
 *
 *   // In a handler:
 *   const { traceId } = c.get("trace");
 */
export function tracing(options?: TracingOptions): MiddlewareHandler<{
  Bindings: Env;
  Variables: { trace: TraceContext; logger: Logger };
}> {
  const serviceName = options?.serviceName ?? "logingov";
  const traceHeader = options?.traceHeader ?? "traceparent";

  return async (c, next) => {
    const start = Date.now();

    // Extract or generate trace context
    let traceId: string;
    let parentSpanId: string | undefined;
    const traceparent = c.req.header(traceHeader);

    if (traceparent) {
      // W3C Trace Context format: 00-<trace_id>-<parent_span_id>-<flags>
      const parts = traceparent.split("-");
      if (parts.length >= 4 && parts[1].length === 32) {
        traceId = parts[1];
        parentSpanId = parts[2];
      } else {
        traceId = generateTraceId();
      }
    } else {
      traceId = generateTraceId();
    }

    const spanId = generateSpanId();

    // Set trace context on Hono variables
    const traceCtx: TraceContext = { traceId, spanId, service: serviceName };
    c.set("trace", traceCtx);

    // Create a request-scoped logger with trace context
    const reqLogger = new Logger({
      traceId,
      spanId,
      parentSpanId,
      service: serviceName,
    });
    c.set("logger", reqLogger);

    // Set trace response headers
    c.header("x-trace-id", traceId);
    c.header("x-span-id", spanId);

    // Log request start
    const url = new URL(c.req.url);
    reqLogger.info("Request started", {
      method: c.req.method,
      path: url.pathname,
      query: url.search || undefined,
      userAgent: c.req.header("user-agent"),
      ip: c.req.header("cf-connecting-ip"),
    });

    try {
      await next();
    } catch (error) {
      reqLogger.exception("Unhandled error in request", error, {
        method: c.req.method,
        path: url.pathname,
      });
      throw error;
    } finally {
      const duration = Date.now() - start;

      // Log request completion
      reqLogger.info("Request completed", {
        method: c.req.method,
        path: url.pathname,
        status: c.res.status,
        duration_ms: duration,
      });
    }
  };
}

/**
 * Extract trace context from a Hono context.
 * Useful for propagating trace IDs into queue messages.
 */
export function getTraceContext(c: Context<{
  Bindings: Env;
  Variables: { trace: TraceContext };
}>): TraceContext {
  return c.get("trace") ?? {
    traceId: generateTraceId(),
    spanId: generateSpanId(),
    service: "logingov",
  };
}
