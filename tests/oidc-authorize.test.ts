/**
 * Tests for the OIDC Authorization Endpoint (GET /openid_connect/authorize).
 *
 * Tests the authorizeRoute sub-app directly, with a minimal error handler
 * to surface AppError responses as JSON (the full app's error handler
 * middleware is not used here).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { authorizeRoute } from "../packages/auth-core/src/routes/authorize.js";
import { AppError, errorResponse } from "@logingov/shared";
import {
  createMockEnv,
  seedSP,
  TEST_SP,
  TEST_SP_IAL1_ONLY,
  buildAuthorizeUrl,
  generatePKCE,
  validAuthorizeParams,
} from "../tests/helpers.js";

// ── Test app factory ─────────────────────────────────────────

function createTestApp() {
  const app = new Hono<{ Bindings: any }>();
  app.onError((err, c) => {
    if (err instanceof AppError) return errorResponse(err);
    return c.json({ error: "server_error", message: err.message }, 500);
  });
  app.route("/", authorizeRoute);
  return app;
}

// ── Helpers ──────────────────────────────────────────────────

function getRedirectLocation(res: Response): URL {
  const location = res.headers.get("Location");
  expect(location).toBeTruthy();
  return new URL(location!);
}

async function getErrorBody(res: Response): Promise<{ error: string; message: string }> {
  return res.json() as any;
}

// ── Tests ────────────────────────────────────────────────────

describe("GET /openid_connect/authorize", () => {
  let env: ReturnType<typeof createMockEnv>;
  let app: ReturnType<typeof createTestApp>;

  beforeEach(async () => {
    env = createMockEnv();
    app = createTestApp();
    await seedSP(env);
  });

  // ── Valid request ────────────────────────────────────────────

  describe("valid authorization request", () => {
    it("redirects to /sign-in with session_id", async () => {
      const { params } = await validAuthorizeParams();
      const url = buildAuthorizeUrl(params);
      const res = await app.request(url, {}, env);

      expect(res.status).toBe(302);
      const location = getRedirectLocation(res);
      expect(location.pathname).toBe("/sign-in");
      expect(location.searchParams.get("session_id")).toBeTruthy();
      expect(location.searchParams.get("locale")).toBe("en");
    });

    it("does not set ial param for IAL1 (auth-only) requests", async () => {
      const { params } = await validAuthorizeParams();
      const url = buildAuthorizeUrl({ ...params, acrValues: "urn:acr.login.gov:auth-only" });
      const res = await app.request(url, {}, env);

      expect(res.status).toBe(302);
      const location = getRedirectLocation(res);
      expect(location.searchParams.get("ial")).toBeNull();
    });

    it("sets ial=2 for verified ACR value", async () => {
      const { params } = await validAuthorizeParams();
      const url = buildAuthorizeUrl({ ...params, acrValues: "urn:acr.login.gov:verified" });
      const res = await app.request(url, {}, env);

      expect(res.status).toBe(302);
      const location = getRedirectLocation(res);
      expect(location.searchParams.get("ial")).toBe("2");
    });

    it("creates a session in the SessionDO", async () => {
      const { params } = await validAuthorizeParams();
      const url = buildAuthorizeUrl(params);
      const res = await app.request(url, {}, env);

      expect(res.status).toBe(302);
      const location = getRedirectLocation(res);
      const sessionId = location.searchParams.get("session_id")!;

      // Verify session was stored in the mock DO
      const sessions = env.SESSION_DO._getSessions();
      expect(sessions.size).toBe(1);

      // Verify session state contents
      const doId = env.SESSION_DO.idFromName(sessionId);
      const stub = env.SESSION_DO.get(doId);
      const getRes = await stub.fetch(new Request("https://session-do/get"));
      expect(getRes.status).toBe(200);
      const session = await getRes.json() as any;
      expect(session.spId).toBe(TEST_SP.id);
      expect(session.redirectUri).toBe(TEST_SP.redirectUris[0]);
      expect(session.state).toBe("test-state-123");
      expect(session.nonce).toBe("test-nonce-456");
    });
  });

  // ── Missing / invalid client_id ──────────────────────────────

  describe("client_id validation", () => {
    it("returns 400 when client_id is missing", async () => {
      const { params } = await validAuthorizeParams();
      const url = buildAuthorizeUrl({ ...params, clientId: undefined });
      const res = await app.request(url, {}, env);

      expect(res.status).toBe(400);
      const body = await getErrorBody(res);
      expect(body.error).toBe("invalid_request");
    });

    it.todo("returns 400 for unknown client_id (requires DB fallback mock)");
  });

  // ── redirect_uri validation ──────────────────────────────────

  describe("redirect_uri validation", () => {
    it("returns 400 when redirect_uri is missing", async () => {
      const { params } = await validAuthorizeParams();
      const url = buildAuthorizeUrl({ ...params, redirectUri: undefined });
      const res = await app.request(url, {}, env);

      expect(res.status).toBe(400);
      const body = await getErrorBody(res);
      expect(body.error).toBe("invalid_request");
    });

    it("returns 400 when redirect_uri is not registered", async () => {
      const { params } = await validAuthorizeParams();
      const url = buildAuthorizeUrl({ ...params, redirectUri: "https://evil.example.com/callback" });
      const res = await app.request(url, {}, env);

      expect(res.status).toBe(400);
      const body = await getErrorBody(res);
      expect(body.error).toBe("invalid_request");
      expect(body.message).toContain("redirect_uri not registered");
    });

    it("accepts a second registered redirect_uri", async () => {
      const { params } = await validAuthorizeParams();
      const url = buildAuthorizeUrl({ ...params, redirectUri: TEST_SP.redirectUris[1] });
      const res = await app.request(url, {}, env);

      expect(res.status).toBe(302);
    });
  });

  // ── scope validation ─────────────────────────────────────────

  describe("scope validation", () => {
    it("returns 400 when scope is missing", async () => {
      const { params } = await validAuthorizeParams();
      const url = buildAuthorizeUrl({ ...params, scope: undefined });
      const res = await app.request(url, {}, env);

      expect(res.status).toBe(400);
      const body = await getErrorBody(res);
      expect(body.error).toBe("invalid_request");
    });

    it("returns 400 when openid is not in scope", async () => {
      const { params } = await validAuthorizeParams();
      const url = buildAuthorizeUrl({ ...params, scope: "email profile" });
      const res = await app.request(url, {}, env);

      expect(res.status).toBe(400);
      const body = await getErrorBody(res);
      expect(body.error).toBe("invalid_scope");
    });
  });

  // ── response_type validation ─────────────────────────────────

  describe("response_type validation", () => {
    it("returns 400 when response_type is not code", async () => {
      const { params } = await validAuthorizeParams();
      const url = buildAuthorizeUrl({ ...params, responseType: "token" });
      const res = await app.request(url, {}, env);

      expect(res.status).toBe(400);
      const body = await getErrorBody(res);
      expect(body.error).toBe("unsupported_response_type");
    });

    it("returns 400 when response_type is missing", async () => {
      const { params } = await validAuthorizeParams();
      const url = buildAuthorizeUrl({ ...params, responseType: undefined });
      const res = await app.request(url, {}, env);

      expect(res.status).toBe(400);
      const body = await getErrorBody(res);
      expect(body.error).toBe("unsupported_response_type");
    });
  });

  // ── PKCE validation ──────────────────────────────────────────

  describe("PKCE validation", () => {
    it("returns 400 when code_challenge is missing", async () => {
      const { params } = await validAuthorizeParams();
      const url = buildAuthorizeUrl({ ...params, codeChallenge: undefined });
      const res = await app.request(url, {}, env);

      expect(res.status).toBe(400);
      const body = await getErrorBody(res);
      expect(body.error).toBe("invalid_request");
      expect(body.message).toContain("code_challenge");
    });

    it("redirects with error when code_challenge_method is not S256", async () => {
      const { params } = await validAuthorizeParams();
      const url = buildAuthorizeUrl({ ...params, codeChallengeMethod: "plain" });
      const res = await app.request(url, {}, env);

      expect(res.status).toBe(302);
      const location = getRedirectLocation(res);
      expect(location.origin).toBe("https://agency.example.gov");
      expect(location.searchParams.get("error")).toBe("invalid_request");
      expect(location.searchParams.get("error_description")).toContain("S256");
      expect(location.searchParams.get("state")).toBe("test-state-123");
    });
  });

  // ── State and nonce pass-through ─────────────────────────────

  describe("state and nonce pass-through", () => {
    it("stores state and nonce in the session", async () => {
      const { params } = await validAuthorizeParams();
      const customState = "my-custom-state-xyz";
      const customNonce = "my-custom-nonce-abc";
      const url = buildAuthorizeUrl({ ...params, state: customState, nonce: customNonce });
      const res = await app.request(url, {}, env);

      expect(res.status).toBe(302);
      const location = getRedirectLocation(res);
      const sessionId = location.searchParams.get("session_id")!;

      const doId = env.SESSION_DO.idFromName(sessionId);
      const stub = env.SESSION_DO.get(doId);
      const getRes = await stub.fetch(new Request("https://session-do/get"));
      const session = await getRes.json() as any;
      expect(session.state).toBe(customState);
      expect(session.nonce).toBe(customNonce);
    });
  });

  // ── ACR values ───────────────────────────────────────────────

  describe("ACR values", () => {
    it("defaults to auth-only (IAL1) when acr_values is omitted", async () => {
      const { params } = await validAuthorizeParams();
      const url = buildAuthorizeUrl({ ...params, acrValues: undefined });
      const res = await app.request(url, {}, env);

      expect(res.status).toBe(302);
      const location = getRedirectLocation(res);
      expect(location.searchParams.get("ial")).toBeNull(); // IAL1 does not set ial param
    });

    it("handles verified ACR (IAL2)", async () => {
      const { params } = await validAuthorizeParams();
      const url = buildAuthorizeUrl({ ...params, acrValues: "urn:acr.login.gov:verified" });
      const res = await app.request(url, {}, env);

      expect(res.status).toBe(302);
      const location = getRedirectLocation(res);
      expect(location.searchParams.get("ial")).toBe("2");

      const sessionId = location.searchParams.get("session_id")!;
      const doId = env.SESSION_DO.idFromName(sessionId);
      const stub = env.SESSION_DO.get(doId);
      const getRes = await stub.fetch(new Request("https://session-do/get"));
      const session = await getRes.json() as any;
      expect(session.requestedIal).toBe(2);
    });

    it("handles verified-facial-match-required ACR", async () => {
      const { params } = await validAuthorizeParams();
      const url = buildAuthorizeUrl({
        ...params,
        acrValues: "urn:acr.login.gov:verified-facial-match-required",
      });
      const res = await app.request(url, {}, env);

      expect(res.status).toBe(302);
      const location = getRedirectLocation(res);
      const sessionId = location.searchParams.get("session_id")!;

      const doId = env.SESSION_DO.idFromName(sessionId);
      const stub = env.SESSION_DO.get(doId);
      const getRes = await stub.fetch(new Request("https://session-do/get"));
      const session = await getRes.json() as any;
      expect(session.requestedIal).toBe(2);
      expect(session.facialMatch).toBe("required");
    });

    it("redirects with error when SP does not support requested IAL", async () => {
      // Seed IAL1-only SP
      await seedSP(env, TEST_SP_IAL1_ONLY as any);
      const { params } = await validAuthorizeParams();
      const url = buildAuthorizeUrl({
        ...params,
        clientId: TEST_SP_IAL1_ONLY.id,
        acrValues: "urn:acr.login.gov:verified",
      });
      const res = await app.request(url, {}, env);

      expect(res.status).toBe(302);
      const location = getRedirectLocation(res);
      expect(location.origin).toBe("https://agency.example.gov");
      expect(location.searchParams.get("error")).toBe("invalid_request");
      expect(location.searchParams.get("error_description")).toContain("does not support");
      expect(location.searchParams.get("state")).toBe("test-state-123");
    });

    it("redirects with error for unsupported acr_values", async () => {
      const { params } = await validAuthorizeParams();
      const url = buildAuthorizeUrl({ ...params, acrValues: "urn:totally:bogus:acr" });
      const res = await app.request(url, {}, env);

      expect(res.status).toBe(302);
      const location = getRedirectLocation(res);
      expect(location.searchParams.get("error")).toBe("invalid_request");
      expect(location.searchParams.get("error_description")).toContain("Unsupported acr_values");
    });
  });

  // ── Locale pass-through ──────────────────────────────────────

  describe("locale", () => {
    it("passes locale to the sign-in redirect", async () => {
      const { params } = await validAuthorizeParams();
      const url = buildAuthorizeUrl({ ...params, locale: "es" });
      const res = await app.request(url, {}, env);

      expect(res.status).toBe(302);
      const location = getRedirectLocation(res);
      expect(location.searchParams.get("locale")).toBe("es");
    });

    it("defaults locale to en when not provided", async () => {
      const { params } = await validAuthorizeParams();
      const url = buildAuthorizeUrl({ ...params, locale: undefined });
      const res = await app.request(url, {}, env);

      expect(res.status).toBe(302);
      const location = getRedirectLocation(res);
      expect(location.searchParams.get("locale")).toBe("en");
    });

    it("stores locale in the session", async () => {
      const { params } = await validAuthorizeParams();
      const url = buildAuthorizeUrl({ ...params, locale: "fr" });
      const res = await app.request(url, {}, env);

      const location = getRedirectLocation(res);
      const sessionId = location.searchParams.get("session_id")!;
      const doId = env.SESSION_DO.idFromName(sessionId);
      const stub = env.SESSION_DO.get(doId);
      const getRes = await stub.fetch(new Request("https://session-do/get"));
      const session = await getRes.json() as any;
      expect(session.locale).toBe("fr");
    });
  });

  // ── PAR (Pushed Authorization Request) ───────────────────────

  describe("PAR (request_uri)", () => {
    async function seedPAR(env: any, parId: string, overrides: Record<string, any> = {}) {
      const { codeChallenge } = await generatePKCE();
      const parData = {
        clientId: TEST_SP.id,
        redirectUri: TEST_SP.redirectUris[0],
        responseType: "code",
        scope: "openid email",
        state: "par-state",
        nonce: "par-nonce",
        codeChallenge,
        codeChallengeMethod: "S256",
        acrValues: "urn:acr.login.gov:auth-only",
        ...overrides,
      };
      await env.KV_SESSIONS.put(`par:${parId}`, JSON.stringify(parData));
      return parData;
    }

    it("resolves a valid request_uri and redirects to /sign-in", async () => {
      const parId = "abc-123-par";
      await seedPAR(env, parId);
      const url = buildAuthorizeUrl({
        requestUri: `urn:ietf:params:oauth:request_uri:${parId}`,
        clientId: TEST_SP.id,
      });
      const res = await app.request(url, {}, env);

      expect(res.status).toBe(302);
      const location = getRedirectLocation(res);
      expect(location.pathname).toBe("/sign-in");
      expect(location.searchParams.get("session_id")).toBeTruthy();
    });

    it("returns 400 for expired or invalid request_uri", async () => {
      const url = buildAuthorizeUrl({
        requestUri: "urn:ietf:params:oauth:request_uri:nonexistent",
        clientId: TEST_SP.id,
      });
      const res = await app.request(url, {}, env);

      expect(res.status).toBe(400);
      const body = await getErrorBody(res);
      expect(body.error).toBe("invalid_request");
      expect(body.message).toContain("invalid or expired");
    });

    it("returns 400 for invalid request_uri format", async () => {
      const url = buildAuthorizeUrl({
        requestUri: "https://not-a-valid-urn/par/123",
        clientId: TEST_SP.id,
      });
      const res = await app.request(url, {}, env);

      expect(res.status).toBe(400);
      const body = await getErrorBody(res);
      expect(body.error).toBe("invalid_request");
      expect(body.message).toContain("Invalid request_uri format");
    });

    it("enforces single-use (deleted after first use)", async () => {
      const parId = "single-use-par";
      await seedPAR(env, parId);
      const url = buildAuthorizeUrl({
        requestUri: `urn:ietf:params:oauth:request_uri:${parId}`,
        clientId: TEST_SP.id,
      });

      // First request succeeds
      const res1 = await app.request(url, {}, env);
      expect(res1.status).toBe(302);

      // Second request fails — PAR was deleted
      const res2 = await app.request(url, {}, env);
      expect(res2.status).toBe(400);
      const body = await getErrorBody(res2);
      expect(body.error).toBe("invalid_request");
      expect(body.message).toContain("invalid or expired");
    });

    it("returns 400 when client_id does not match PAR request", async () => {
      const parId = "mismatched-client-par";
      await seedPAR(env, parId);
      const url = buildAuthorizeUrl({
        requestUri: `urn:ietf:params:oauth:request_uri:${parId}`,
        clientId: "urn:different:client:id",
      });
      const res = await app.request(url, {}, env);

      expect(res.status).toBe(400);
      const body = await getErrorBody(res);
      expect(body.error).toBe("invalid_request");
      expect(body.message).toContain("client_id does not match");
    });

    it("uses PAR params when query params are absent", async () => {
      const parId = "par-only-params";
      await seedPAR(env, parId, { locale: "ja" });
      const url = buildAuthorizeUrl({
        requestUri: `urn:ietf:params:oauth:request_uri:${parId}`,
      });
      const res = await app.request(url, {}, env);

      expect(res.status).toBe(302);
      const location = getRedirectLocation(res);
      expect(location.searchParams.get("locale")).toBe("ja");
    });
  });

  // ── Scopes stored in session ─────────────────────────────────

  describe("session scopes", () => {
    it("stores parsed scopes array in the session", async () => {
      const { params } = await validAuthorizeParams();
      const url = buildAuthorizeUrl({ ...params, scope: "openid email profile phone" });
      const res = await app.request(url, {}, env);

      expect(res.status).toBe(302);
      const location = getRedirectLocation(res);
      const sessionId = location.searchParams.get("session_id")!;

      const doId = env.SESSION_DO.idFromName(sessionId);
      const stub = env.SESSION_DO.get(doId);
      const getRes = await stub.fetch(new Request("https://session-do/get"));
      const session = await getRes.json() as any;
      expect(session.scopes).toEqual(["openid", "email", "profile", "phone"]);
    });
  });
});
