/**
 * Tests for POST /api/openid_connect/par (Pushed Authorization Request)
 *
 * RFC 9126: Clients push authorization parameters to the AS and receive
 * a request_uri to use on /authorize. Most tests require real client
 * authentication (private_key_jwt) and are marked as `it.todo`.
 * Parameter validation tests that fire before `validateClientAssertion`
 * can run against the Hono app directly.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { parRoute } from "../packages/auth-core/src/routes/par.js";
import { AppError, errorResponse } from "@logingov/shared";
import { createMockEnv, seedSP, TEST_SP, TEST_SP_IAL1_ONLY } from "./helpers.js";

// ── Test app with error handling ─────────────────────────────

function createTestApp() {
  const app = new Hono<{ Bindings: any }>();
  app.onError((err, c) => {
    if (err instanceof AppError) return errorResponse(err);
    return c.json({ error: "server_error", message: err.message }, 500);
  });
  app.route("/", parRoute);
  return app;
}

// ── Helpers ──────────────────────────────────────────────────

function parRequest(body: Record<string, string>) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(body)) {
    params.set(k, v);
  }
  return new Request("https://secure.login.gov/api/openid_connect/par", {
    method: "POST",
    body: params.toString(),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
}

// ── Tests ────────────────────────────────────────────────────

describe("POST /api/openid_connect/par", () => {
  let app: ReturnType<typeof createTestApp>;
  let env: ReturnType<typeof createMockEnv>;

  beforeEach(() => {
    app = createTestApp();
    env = createMockEnv();
  });

  // ── Client authentication validation (runs without DB) ─────

  describe("client authentication validation", () => {
    it("rejects missing client_assertion", async () => {
      const body = new URLSearchParams();
      body.set(
        "client_assertion_type",
        "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
      );

      const res = await app.request(
        "/api/openid_connect/par",
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
      expect(json.message).toContain("private_key_jwt");
    });

    it("rejects wrong client_assertion_type", async () => {
      const body = new URLSearchParams();
      body.set(
        "client_assertion_type",
        "urn:ietf:params:oauth:client-assertion-type:saml2-bearer",
      );
      body.set("client_assertion", "some.jwt.token");

      const res = await app.request(
        "/api/openid_connect/par",
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
      expect(json.message).toContain("private_key_jwt");
    });

    it("rejects missing client_assertion_type", async () => {
      const body = new URLSearchParams();
      body.set("client_assertion", "some.jwt.token");

      const res = await app.request(
        "/api/openid_connect/par",
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
    });

    it("rejects completely empty body", async () => {
      const res = await app.request(
        "/api/openid_connect/par",
        {
          method: "POST",
          body: new URLSearchParams().toString(),
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
        },
        env,
      );

      expect(res.status).toBe(400);
      const json = await res.json() as any;
      expect(json.error).toBe("invalid_request");
    });
  });

  // ── HTTP method guard ──────────────────────────────────────

  describe("HTTP method", () => {
    it("rejects GET requests", async () => {
      const res = await app.request(
        "/api/openid_connect/par",
        { method: "GET" },
        env,
      );

      // Hono returns 404 for unmatched method since route is POST-only
      expect(res.status).toBe(404);
    });
  });

  // ── Tests requiring real client auth (todo) ────────────────

  describe("valid PAR request (requires client auth)", () => {
    it.todo("returns 201 with request_uri for a valid PAR request");

    it.todo("request_uri format is urn:ietf:params:oauth:request_uri:{uuid}");

    it.todo("response includes expires_in of 60");
  });

  describe("redirect_uri validation (requires client auth)", () => {
    it.todo("rejects missing redirect_uri");

    it.todo("rejects redirect_uri not registered for the client");
  });

  describe("response_type validation (requires client auth)", () => {
    it.todo("rejects missing response_type");

    it.todo("rejects response_type other than 'code'");
  });

  describe("scope validation (requires client auth)", () => {
    it.todo("rejects missing scope");

    it.todo("rejects scope without openid");

    it.todo("accepts scope with openid and additional scopes");
  });

  describe("ACR values validation (requires client auth)", () => {
    it.todo("rejects unsupported acr_values");

    it.todo("rejects IAL2 request for SP that only supports IAL1");

    it.todo("accepts valid acr_values for capable SP");
  });

  describe("PKCE validation (requires client auth)", () => {
    it.todo("accepts valid S256 code_challenge");

    it.todo("rejects non-S256 code_challenge_method");

    it.todo("rejects malformed code_challenge");
  });

  describe("KV storage (requires client auth)", () => {
    it.todo("stores PAR request in KV_SESSIONS with par: prefix");

    it.todo("stored request contains all authorization parameters");

    it.todo("KV entry has 60-second TTL");
  });
});
