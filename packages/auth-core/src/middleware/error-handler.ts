/**
 * Global error handler middleware.
 * Catches AppError instances and returns structured JSON error responses.
 */
import type { Context, Next } from "hono";
import type { Env } from "@logingov/shared";
import { AppError, errorResponse } from "@logingov/shared";

export async function errorHandlerMiddleware(
  c: Context<{ Bindings: Env }>,
  next: Next
): Promise<void | Response> {
  try {
    await next();
  } catch (err) {
    if (err instanceof AppError) {
      return errorResponse(err);
    }

    console.error("Unhandled error:", err);
    return errorResponse(
      new AppError("server_error", "Internal server error", 500)
    );
  }
}
