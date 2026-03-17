/**
 * Tests for GET /api/openid_connect/userinfo
 *
 * The userinfo endpoint validates a Bearer access token from KV,
 * fetches the user, checks account lock status, computes pairwise sub,
 * and returns claims filtered by scopes.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { AppError, errorResponse } from "@logingov/shared";
import { userinfoRoute } from "@logingov/auth-core/routes/userinfo";
import { createMockEnv } from "./helpers.js";

function createTestApp(route: any) {
  const app = new Hono<{ Bindings: any }>();
  app.onError((err, c) => {
    if (err instanceof AppError) return errorResponse(err);
    return c.json({ error: "server_error", message: err.message }, 500);
  });
  app.route("/", route);
  return app;
}

describe("GET /api/openid_connect/userinfo", () => {
  let env: ReturnType<typeof createMockEnv>;
  let app: ReturnType<typeof createTestApp>;

  beforeEach(() => {
    env = createMockEnv();
    app = createTestApp(userinfoRoute);
  });

  // ── Token extraction / validation (no DB needed) ──────────────

  it("returns 401 when Authorization header is missing", async () => {
    const res = await app.request(
      "https://secure.login.gov/api/openid_connect/userinfo",
      {},
      env
    );

    expect(res.status).toBe(401);
    const body = await res.json() as any;
    expect(body.error).toBe("invalid_token");
    expect(body.message).toContain("Bearer token required");
  });

  it("returns 401 when Bearer token is empty", async () => {
    const res = await app.request(
      "https://secure.login.gov/api/openid_connect/userinfo",
      { headers: { Authorization: "Bearer " } },
      env
    );

    expect(res.status).toBe(401);
    const body = await res.json() as any;
    expect(body.error).toBe("invalid_token");
    expect(body.message).toContain("required");
  });

  it("returns 401 when access token is invalid or expired", async () => {
    // Seed a valid token so we can verify a *different* token is rejected
    await env.KV_SESSIONS.put(
      "access_token:test-token",
      JSON.stringify({
        userId: "user-123",
        spId: "sp-123",
        scopes: ["openid", "email"],
      })
    );

    const res = await app.request(
      "https://secure.login.gov/api/openid_connect/userinfo",
      { headers: { Authorization: "Bearer wrong-token" } },
      env
    );

    expect(res.status).toBe(401);
    const body = await res.json() as any;
    expect(body.error).toBe("invalid_token");
    expect(body.message).toContain("invalid or expired");
  });

  it("returns 401 when Authorization header uses non-Bearer scheme", async () => {
    const res = await app.request(
      "https://secure.login.gov/api/openid_connect/userinfo",
      { headers: { Authorization: "Basic dXNlcjpwYXNz" } },
      env
    );

    expect(res.status).toBe(401);
    const body = await res.json() as any;
    expect(body.error).toBe("invalid_token");
  });

  // ── DB-dependent scenarios ────────────────────────────────────

  it.todo("returns 403 when account is locked", async () => {
    // Requires DB: seed a locked user and a valid access token
  });

  it.todo("returns user claims for a valid token", async () => {
    // Requires DB: seed a user, issue an access token, verify claims
  });

  it.todo("returns claims scoped to requested scopes", async () => {
    // Requires DB: seed user, issue token with limited scopes,
    // verify only matching claims are returned
  });

  it.todo("email scope returns email and email_verified claims", async () => {
    // Requires DB: seed user, issue token with openid+email scopes,
    // verify email and email_verified are present
  });

  it.todo("IAL2 scopes return PII when user is proofed", async () => {
    // Requires DB: seed a proofed (IAL2) user, issue token with
    // profile scope, verify PII claims (given_name, family_name, etc.)
  });
});
