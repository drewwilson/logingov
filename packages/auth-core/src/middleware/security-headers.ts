/**
 * Security headers middleware.
 * Sets HSTS, X-Frame-Options, X-Content-Type-Options, CSP, and other
 * headers required for SOC II CC7.1 compliance.
 */
import type { Context, Next } from "hono";
import type { Env } from "@logingov/shared";

export async function securityHeaders(
  c: Context<{ Bindings: Env }>,
  next: Next
): Promise<void | Response> {
  await next();

  // HSTS — enforce HTTPS for 2 years, include subdomains, allow preload
  c.header(
    "Strict-Transport-Security",
    "max-age=63072000; includeSubDomains; preload"
  );

  // Prevent clickjacking
  c.header("X-Frame-Options", "DENY");

  // Prevent MIME-type sniffing
  c.header("X-Content-Type-Options", "nosniff");

  // Disable referrer for cross-origin requests
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");

  // Content Security Policy — restrictive default for an API service
  // Demo routes set their own relaxed CSP; don't overwrite it.
  if (!c.req.path.startsWith("/demo")) {
    c.header(
      "Content-Security-Policy",
      [
        "default-src 'none'",
        "frame-ancestors 'none'",
        "form-action 'self'",
        "base-uri 'none'",
      ].join("; ")
    );
  }

  // Opt out of FLoC / Topics API tracking
  c.header("Permissions-Policy", "interest-cohort=()");

  // Prevent caching of authenticated responses
  c.header("Cache-Control", "no-store");
  c.header("Pragma", "no-cache");
}
