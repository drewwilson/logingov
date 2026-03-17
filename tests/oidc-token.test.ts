/**
 * Tests for POST /api/openid_connect/token
 *
 * The token endpoint exchanges an authorization code for tokens.
 * Most test cases require a real DB (PlanetScale via Hyperdrive) and RSA
 * keys, so they are marked as `it.todo`. Tests that exercise pure parameter
 * validation before DB access can run against the Hono app directly.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { tokenRoute } from "../packages/auth-core/src/routes/token.js";
import { AppError, errorResponse } from "@logingov/shared";
import { createMockEnv } from "./helpers.js";

// ── Test app with error handling ─────────────────────────────

function createTestApp() {
  const app = new Hono<{ Bindings: any }>();
  app.onError((err, c) => {
    if (err instanceof AppError) return errorResponse(err);
    return c.json({ error: "server_error", message: err.message }, 500);
  });
  app.route("/", tokenRoute);
  return app;
}

// ── Helpers ──────────────────────────────────────────────────

function tokenRequest(body: Record<string, string>) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(body)) {
    params.set(k, v);
  }
  return new Request("https://secure.login.gov/api/openid_connect/token", {
    method: "POST",
    body: params.toString(),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
}

// ── Tests ────────────────────────────────────────────────────

describe("POST /api/openid_connect/token", () => {
  let app: ReturnType<typeof createTestApp>;
  let env: ReturnType<typeof createMockEnv>;

  beforeEach(() => {
    app = createTestApp();
    env = createMockEnv();
  });

  // ── grant_type validation (runs without DB) ────────────────

  describe("grant_type validation", () => {
    it("rejects missing grant_type", async () => {
      const res = await app.request(
        "/api/openid_connect/token",
        {
          method: "POST",
          body: new URLSearchParams().toString(),
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
        },
        env,
      );

      expect(res.status).toBe(400);
      const json = await res.json() as any;
      expect(json.error).toBe("unsupported_grant_type");
    });

    it("rejects invalid grant_type", async () => {
      const body = new URLSearchParams();
      body.set("grant_type", "client_credentials");

      const res = await app.request(
        "/api/openid_connect/token",
        {
          method: "POST",
          body: body.toString(),
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
        },
        env,
      );

      expect(res.status).toBe(400);
      const json = await res.json() as any;
      expect(json.error).toBe("unsupported_grant_type");
      expect(json.message).toContain("authorization_code");
    });

    it("rejects implicit grant_type", async () => {
      const body = new URLSearchParams();
      body.set("grant_type", "implicit");

      const res = await app.request(
        "/api/openid_connect/token",
        {
          method: "POST",
          body: body.toString(),
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
        },
        env,
      );

      expect(res.status).toBe(400);
      const json = await res.json() as any;
      expect(json.error).toBe("unsupported_grant_type");
    });
  });

  // ── client_assertion_type validation (runs without DB) ─────

  describe("client_assertion_type validation", () => {
    it("rejects missing client_assertion_type", async () => {
      const body = new URLSearchParams();
      body.set("grant_type", "authorization_code");

      const res = await app.request(
        "/api/openid_connect/token",
        {
          method: "POST",
          body: body.toString(),
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
        },
        env,
      );

      expect(res.status).toBe(400);
      const json = await res.json() as any;
      expect(json.error).toBe("invalid_request");
      expect(json.message).toContain("client_assertion_type");
    });

    it("rejects wrong client_assertion_type", async () => {
      const body = new URLSearchParams();
      body.set("grant_type", "authorization_code");
      body.set("client_assertion_type", "urn:ietf:params:oauth:client-assertion-type:saml2-bearer");

      const res = await app.request(
        "/api/openid_connect/token",
        {
          method: "POST",
          body: body.toString(),
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
        },
        env,
      );

      expect(res.status).toBe(400);
      const json = await res.json() as any;
      expect(json.error).toBe("invalid_request");
      expect(json.message).toContain("jwt-bearer");
    });
  });

  // ── client_assertion validation (runs without DB) ──────────

  describe("client_assertion validation", () => {
    it("rejects missing client_assertion", async () => {
      const body = new URLSearchParams();
      body.set("grant_type", "authorization_code");
      body.set(
        "client_assertion_type",
        "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
      );

      const res = await app.request(
        "/api/openid_connect/token",
        {
          method: "POST",
          body: body.toString(),
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
        },
        env,
      );

      expect(res.status).toBe(400);
      const json = await res.json() as any;
      expect(json.error).toBe("invalid_request");
      expect(json.message).toContain("client_assertion");
    });
  });

  // ── HTTP method guard ──────────────────────────────────────

  describe("HTTP method", () => {
    it("rejects GET requests", async () => {
      const res = await app.request(
        "/api/openid_connect/token",
        { method: "GET" },
        env,
      );

      // Hono returns 404 for unmatched method since route is POST-only
      expect(res.status).toBe(404);
    });
  });

  // ── Validation order ──────────────────────────────────────

  describe("validation order", () => {
    it("checks grant_type before client_assertion_type", async () => {
      // Send both invalid grant_type and missing client_assertion_type
      const body = new URLSearchParams();
      body.set("grant_type", "client_credentials");

      const res = await app.request(
        "/api/openid_connect/token",
        {
          method: "POST",
          body: body.toString(),
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
        },
        env,
      );

      const json = await res.json() as any;
      // grant_type error should come first
      expect(json.error).toBe("unsupported_grant_type");
    });

    it("checks client_assertion_type before client_assertion", async () => {
      // Valid grant_type but missing client_assertion_type
      const body = new URLSearchParams();
      body.set("grant_type", "authorization_code");

      const res = await app.request(
        "/api/openid_connect/token",
        {
          method: "POST",
          body: body.toString(),
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
        },
        env,
      );

      const json = await res.json() as any;
      expect(json.error).toBe("invalid_request");
      expect(json.message).toContain("client_assertion_type");
    });
  });

  // ── Tests requiring DB / real crypto (todo) ────────────────

  describe("authorization code exchange (requires DB)", () => {
    it.todo("returns tokens for a valid authorization code");

    it.todo("returns access_token, token_type, expires_in, and id_token in response");

    it.todo("sets token_type to Bearer");

    it.todo("sets expires_in to 900 (15 minutes)");

    it.todo("returns a signed RS256 id_token JWT");
  });

  describe("authorization code single-use enforcement (requires DB)", () => {
    it.todo("rejects an already-used authorization code");

    it.todo("atomically prevents concurrent replay of the same code");
  });

  describe("authorization code expiration (requires DB)", () => {
    it.todo("rejects an expired authorization code");
  });

  describe("client binding (requires DB)", () => {
    it.todo("rejects a code that was not issued to the requesting client");
  });

  describe("redirect_uri validation (requires DB)", () => {
    it.todo("rejects when redirect_uri is missing");

    it.todo("rejects when redirect_uri does not match the one used at authorization");
  });

  describe("PKCE verification (requires DB)", () => {
    it.todo("rejects missing code_verifier when code_challenge was provided");

    it.todo("rejects an invalid code_verifier format");

    it.todo("rejects an incorrect code_verifier (wrong value)");

    it.todo("accepts a correct code_verifier with S256 method");
  });

  describe("id_token claims (requires DB)", () => {
    it.todo("includes sub, aud, acr, ial, aal, at_hash in id_token");

    it.todo("includes nonce in id_token when provided at authorization");

    it.todo("omits nonce from id_token when not provided at authorization");
  });

  describe("pairwise subject identifier (requires DB)", () => {
    it.todo("returns different sub values for different service providers");

    it.todo("returns consistent sub for the same user and service provider");
  });

  describe("access token storage (requires DB)", () => {
    it.todo("stores the access token in KV_SESSIONS with a TTL");
  });

  describe("audit logging (requires DB)", () => {
    it.todo("enqueues an audit event on successful token issuance");
  });
});
