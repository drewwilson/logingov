/**
 * Structured JSON logging helper with trace context.
 *
 * Outputs JSON to console.log — Cloudflare Workers automatically
 * ships these to Logpush if configured.
 */

// ── Types ───────────────────────────────────────────────────

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogContext {
  traceId?: string;
  spanId?: string;
  service?: string;
  userId?: string;
  requestId?: string;
  [key: string]: unknown;
}

// ── Logger class ────────────────────────────────────────────

export class Logger {
  private defaultContext: LogContext;

  constructor(context?: LogContext) {
    this.defaultContext = context ?? {};
  }

  /**
   * Create a child logger with additional default context.
   */
  child(context: LogContext): Logger {
    return new Logger({ ...this.defaultContext, ...context });
  }

  debug(message: string, data?: Record<string, unknown>): void {
    this.write("debug", message, data);
  }

  info(message: string, data?: Record<string, unknown>): void {
    this.write("info", message, data);
  }

  warn(message: string, data?: Record<string, unknown>): void {
    this.write("warn", message, data);
  }

  error(message: string, data?: Record<string, unknown>): void {
    this.write("error", message, data);
  }

  /**
   * Log an error object with stack trace.
   */
  exception(message: string, err: unknown, data?: Record<string, unknown>): void {
    const errorData: Record<string, unknown> = {
      ...data,
    };

    if (err instanceof Error) {
      errorData.errorName = err.name;
      errorData.errorMessage = err.message;
      errorData.stack = err.stack;
    } else {
      errorData.errorMessage = String(err);
    }

    this.write("error", message, errorData);
  }

  private write(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    const entry = {
      level,
      message,
      timestamp: new Date().toISOString(),
      ...this.defaultContext,
      ...data,
    };

    // Use console methods that map to Cloudflare log levels
    switch (level) {
      case "debug":
        console.debug(JSON.stringify(entry));
        break;
      case "warn":
        console.warn(JSON.stringify(entry));
        break;
      case "error":
        console.error(JSON.stringify(entry));
        break;
      default:
        console.log(JSON.stringify(entry));
    }
  }
}

// ── Singleton logger ────────────────────────────────────────

/**
 * Default logger instance. Create child loggers for request-scoped context:
 *
 *   const reqLog = logger.child({ traceId, service: "auth-core" });
 *   reqLog.info("Token issued", { userId, spId });
 */
export const logger = new Logger({ service: "logingov" });
