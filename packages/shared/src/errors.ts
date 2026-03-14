/**
 * Shared error types and HTTP response helpers.
 */

export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 400,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "AppError";
  }
}

// ── Common errors ───────────────────────────────────────────

export class UnauthorizedError extends AppError {
  constructor(message = "Unauthorized") {
    super("unauthorized", message, 401);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Forbidden") {
    super("forbidden", message, 403);
  }
}

export class NotFoundError extends AppError {
  constructor(resource = "Resource") {
    super("not_found", `${resource} not found`, 404);
  }
}

export class ConflictError extends AppError {
  constructor(message = "Conflict") {
    super("conflict", message, 409);
  }
}

export class RateLimitError extends AppError {
  constructor(retryAfter: number) {
    super("rate_limited", "Too many requests", 429, { retryAfter });
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(retryAfter?: number) {
    super("service_unavailable", "Service temporarily unavailable", 503, {
      retryAfter: retryAfter ?? 30,
    });
  }
}

// ── JSON error response ─────────────────────────────────────

export function errorResponse(error: AppError): Response {
  return new Response(
    JSON.stringify({
      error: error.code,
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
    }),
    {
      status: error.statusCode,
      headers: {
        "Content-Type": "application/json",
        ...(error.code === "rate_limited" && error.details?.retryAfter
          ? { "Retry-After": String(error.details.retryAfter) }
          : {}),
      },
    }
  );
}

export function jsonResponse(data: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
  });
}
