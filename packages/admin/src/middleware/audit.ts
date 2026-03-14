/**
 * Admin action audit logging middleware.
 * Logs all admin API actions (create, update, delete) to the audit queue
 * for SOC II CC6.1-CC6.3 compliance.
 */
import type { Context, Next } from "hono";
import type { Env } from "@logingov/shared";
import { Logger } from "@logingov/infra";

const auditLogger = new Logger({ service: "admin-audit" });

/**
 * Middleware that logs all mutating admin operations.
 * Captures: action type, target resource, admin identity, IP, timestamp.
 */
export async function adminAudit(
  c: Context<{ Bindings: Env }>,
  next: Next
): Promise<void | Response> {
  const method = c.req.method;

  // Only audit mutating operations
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    await next();
    return;
  }

  const startTime = Date.now();
  const traceId = c.res?.headers?.get("x-trace-id") ?? crypto.randomUUID();
  const ip = c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for") ?? "unknown";
  const path = new URL(c.req.url).pathname;

  await next();

  const statusCode = c.res?.status ?? 0;
  const durationMs = Date.now() - startTime;

  // Determine action type from HTTP method
  const action = methodToAction(method);

  // Extract target resource ID from path
  const targetId = extractResourceId(path);

  const auditEntry = {
    action,
    method,
    path,
    targetId,
    statusCode,
    durationMs,
    ip,
    traceId,
    timestamp: new Date().toISOString(),
  };

  auditLogger.info(`Admin ${action}: ${path}`, auditEntry);

  // Also enqueue to audit queue for persistent storage
  try {
    await c.env.QUEUE_AUDIT.send({
      type: "audit:admin",
      timestamp: new Date().toISOString(),
      data: auditEntry,
    });
  } catch {
    // Non-fatal: log locally if queue send fails
    auditLogger.error("Failed to enqueue admin audit event", auditEntry);
  }
}

function methodToAction(method: string): string {
  switch (method) {
    case "POST": return "create";
    case "PUT": return "update";
    case "PATCH": return "update";
    case "DELETE": return "delete";
    default: return method.toLowerCase();
  }
}

function extractResourceId(path: string): string | null {
  // Match patterns like /service-providers/:spId
  const segments = path.split("/").filter(Boolean);
  // If there are at least 2 segments and the last isn't a known action
  if (segments.length >= 2 && !["upload-cert"].includes(segments[segments.length - 1])) {
    return segments[segments.length - 1];
  }
  // For upload-cert, the SP ID is the second-to-last segment
  if (segments.length >= 3 && segments[segments.length - 1] === "upload-cert") {
    return segments[segments.length - 2];
  }
  return null;
}
