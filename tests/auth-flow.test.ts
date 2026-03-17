/**
 * Tests for auth flow orchestration routes:
 * - POST /api/auth-flow/complete-login
 * - POST /api/auth-flow/issue-code
 * - POST /api/auth-flow/mock-verify
 *
 * These routes coordinate MFA checks and OIDC authorization code issuance.
 * Tests requiring DB (getDb / drizzle) are marked as `it.todo`.
 * Tests using only SessionDO can run against MockSessionDO.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { authFlowRoute } from "../packages/auth-core/src/routes/auth-flow.js";
import { AppError, errorResponse } from "@logingov/shared";
import { createMockEnv, TEST_SP } from "./helpers.js";

// ── Test app with error handling ─────────────────────────────

function createTestApp() {
  const app = new Hono<{ Bindings: any }>();
  app.onError((err, c) => {
    if (err instanceof AppError) return errorResponse(err);
    return c.json({ error: "server_error", message: err.message }, 500);
  });
  app.route("/", authFlowRoute);
  return app;
}

// ── Helpers ──────────────────────────────────────────────────

function jsonRequest(path: string, body: Record<string, any>) {
  return new Request(`https://secure.login.gov${path}`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

async function createSession(
  env: ReturnType<typeof createMockEnv>,
  sessionId: string,
  overrides: Record<string, any> = {},
) {
  const doId = env.SESSION_DO.idFromName(sessionId);
  const stub = env.SESSION_DO.get(doId);
  await stub.fetch(
    new Request("https://session-do/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        spId: TEST_SP.id,
        responseType: "code",
        redirectUri: TEST_SP.redirectUris[0],
        scopes: ["openid", "email"],
        state: "test-state",
        nonce: "test-nonce",
        requestedIal: 1,
        requestedAal: 1,
        mfaVerified: false,
        locale: "en",
        createdAt: new Date().toISOString(),
        ...overrides,
      }),
    }),
  );
}

// ── Tests ────────────────────────────────────────────────────

describe("POST /api/auth-flow/complete-login", () => {
  let app: ReturnType<typeof createTestApp>;
  let env: ReturnType<typeof createMockEnv>;

  beforeEach(() => {
    app = createTestApp();
    env = createMockEnv();
  });

  // ── Parameter validation ───────────────────────────────────

  describe("parameter validation", () => {
    it("rejects missing sessionId", async () => {
      const res = await app.request(
        "/api/auth-flow/complete-login",
        {
          method: "POST",
          body: JSON.stringify({ userId: "user-123" }),
          headers: { "Content-Type": "application/json" },
        },
        env,
      );

      expect(res.status).toBe(400);
      const json = await res.json() as any;
      expect(json.error).toBe("invalid_request");
      expect(json.message).toContain("sessionId");
    });

    it("rejects missing userId", async () => {
      const res = await app.request(
        "/api/auth-flow/complete-login",
        {
          method: "POST",
          body: JSON.stringify({ sessionId: "session-123" }),
          headers: { "Content-Type": "application/json" },
        },
        env,
      );

      expect(res.status).toBe(400);
      const json = await res.json() as any;
      expect(json.error).toBe("invalid_request");
      expect(json.message).toContain("userId");
    });
  });

  // ── Session lookup ─────────────────────────────────────────

  describe("session lookup", () => {
    it("returns 404 when session does not exist", async () => {
      const res = await app.request(
        "/api/auth-flow/complete-login",
        {
          method: "POST",
          body: JSON.stringify({
            sessionId: "nonexistent-session",
            userId: "user-123",
          }),
          headers: { "Content-Type": "application/json" },
        },
        env,
      );

      expect(res.status).toBe(404);
      const json = await res.json() as any;
      expect(json.error).toBe("invalid_request");
    });

    it("returns 410 when session has expired", async () => {
      // Create a session that is already expired
      const sessionId = "expired-session";
      const doId = env.SESSION_DO.idFromName(sessionId);
      const stub = env.SESSION_DO.get(doId);

      // Directly manipulate the mock to create an expired session
      await stub.fetch(
        new Request("https://session-do/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            spId: TEST_SP.id,
            responseType: "code",
            redirectUri: TEST_SP.redirectUris[0],
            scopes: ["openid", "email"],
            state: "test-state",
            nonce: "test-nonce",
            requestedIal: 1,
            requestedAal: 1,
            mfaVerified: false,
            locale: "en",
            createdAt: new Date().toISOString(),
          }),
        }),
      );

      // Overwrite the expiresAt to be in the past
      const sessions = (env.SESSION_DO as any)._getSessions();
      const session = sessions.get(sessionId);
      session.expiresAt = new Date(Date.now() - 1000).toISOString();
      sessions.set(sessionId, session);

      const res = await app.request(
        "/api/auth-flow/complete-login",
        {
          method: "POST",
          body: JSON.stringify({
            sessionId,
            userId: "user-123",
          }),
          headers: { "Content-Type": "application/json" },
        },
        env,
      );

      expect(res.status).toBe(410);
      const json = await res.json() as any;
      expect(json.error).toBe("invalid_request");
    });
  });

  // ── MFA decision (requires DB) ─────────────────────────────

  describe("MFA decision (requires DB)", () => {
    it.todo("AAL1 request: no MFA required, issues code directly");

    it.todo("AAL2 request: returns requiresMfa true with methods list");

    it.todo("AAL2 request: excludes password from MFA methods");

    it.todo("returns correct ACR for auth-only flow");

    it.todo("returns correct redirect_uri and state in response");
  });

  // ── HTTP method guard ──────────────────────────────────────

  describe("HTTP method", () => {
    it("GET without session_id redirects to sign-in", async () => {
      const res = await app.request(
        "/api/auth-flow/complete-login",
        { method: "GET" },
        env,
      );

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toContain("/sign-in");
    });
  });
});

// ── issue-code ───────────────────────────────────────────────

describe("POST /api/auth-flow/issue-code", () => {
  let app: ReturnType<typeof createTestApp>;
  let env: ReturnType<typeof createMockEnv>;

  beforeEach(() => {
    app = createTestApp();
    env = createMockEnv();
  });

  // ── Parameter validation ───────────────────────────────────

  describe("parameter validation", () => {
    it("rejects missing sessionId", async () => {
      const res = await app.request(
        "/api/auth-flow/issue-code",
        {
          method: "POST",
          body: JSON.stringify({}),
          headers: { "Content-Type": "application/json" },
        },
        env,
      );

      expect(res.status).toBe(400);
      const json = await res.json() as any;
      expect(json.error).toBe("invalid_request");
      expect(json.message).toContain("sessionId");
    });
  });

  // ── MFA enforcement ────────────────────────────────────────

  describe("MFA enforcement", () => {
    it("rejects when MFA is required but not completed", async () => {
      const sessionId = "mfa-required-session";
      await createSession(env, sessionId, {
        requestedAal: 2,
        mfaVerified: false,
      });

      const res = await app.request(
        "/api/auth-flow/issue-code",
        {
          method: "POST",
          body: JSON.stringify({ sessionId }),
          headers: { "Content-Type": "application/json" },
        },
        env,
      );

      expect(res.status).toBe(403);
      const json = await res.json() as any;
      expect(json.error).toBe("invalid_request");
      expect(json.message).toContain("MFA");
    });

    it("rejects when session has no authenticated user", async () => {
      const sessionId = "no-user-session";
      await createSession(env, sessionId, {
        requestedAal: 1,
        mfaVerified: false,
        // userId is not set
      });

      const res = await app.request(
        "/api/auth-flow/issue-code",
        {
          method: "POST",
          body: JSON.stringify({ sessionId }),
          headers: { "Content-Type": "application/json" },
        },
        env,
      );

      expect(res.status).toBe(400);
      const json = await res.json() as any;
      expect(json.error).toBe("invalid_request");
      expect(json.message).toContain("authenticated user");
    });
  });

  // ── Session lookup ─────────────────────────────────────────

  describe("session lookup", () => {
    it("returns 404 when session does not exist", async () => {
      const res = await app.request(
        "/api/auth-flow/issue-code",
        {
          method: "POST",
          body: JSON.stringify({ sessionId: "nonexistent-session" }),
          headers: { "Content-Type": "application/json" },
        },
        env,
      );

      expect(res.status).toBe(404);
    });
  });

  // ── Code issuance (requires DB) ────────────────────────────

  describe("code issuance (requires DB)", () => {
    it.todo("issues auth code for valid session with MFA completed");

    it.todo("response contains redirectUri, code, and state");

    it.todo("stores auth code in DB with correct TTL");

    it.todo("code contains correct IAL, AAL, and ACR values");
  });
});

// ── mock-verify ──────────────────────────────────────────────

describe("POST /api/auth-flow/mock-verify", () => {
  let app: ReturnType<typeof createTestApp>;
  let env: ReturnType<typeof createMockEnv>;

  beforeEach(() => {
    app = createTestApp();
    env = createMockEnv();
  });

  // ── Parameter validation ───────────────────────────────────

  describe("parameter validation", () => {
    it("rejects missing userId", async () => {
      const res = await app.request(
        "/api/auth-flow/mock-verify",
        {
          method: "POST",
          body: JSON.stringify({}),
          headers: { "Content-Type": "application/json" },
        },
        env,
      );

      expect(res.status).toBe(400);
      const json = await res.json() as any;
      expect(json.error).toBe("invalid_request");
      expect(json.message).toContain("userId");
    });
  });

  // ── Session update ─────────────────────────────────────────

  describe("session update", () => {
    it("updates SessionDO achievedIal when sessionId is provided", async () => {
      const sessionId = "verify-session";
      await createSession(env, sessionId, { requestedIal: 2 });

      const res = await app.request(
        "/api/auth-flow/mock-verify",
        {
          method: "POST",
          body: JSON.stringify({
            sessionId,
            userId: "user-123",
          }),
          headers: { "Content-Type": "application/json" },
        },
        env,
      );

      expect(res.status).toBe(200);
      const json = await res.json() as any;
      expect(json.ok).toBe(true);
      expect(json.ial).toBe(2);
      expect(json.verifiedAt).toBeDefined();

      // Verify session was updated in the DO
      const doId = env.SESSION_DO.idFromName(sessionId);
      const stub = env.SESSION_DO.get(doId);
      const sessionRes = await stub.fetch(
        new Request("https://session-do/get", { method: "GET" }),
      );
      const session = await sessionRes.json() as any;
      expect(session.achievedIal).toBe(2);
    });

    it("works without sessionId (direct testing mode)", async () => {
      const res = await app.request(
        "/api/auth-flow/mock-verify",
        {
          method: "POST",
          body: JSON.stringify({ userId: "user-123" }),
          headers: { "Content-Type": "application/json" },
        },
        env,
      );

      expect(res.status).toBe(200);
      const json = await res.json() as any;
      expect(json.ok).toBe(true);
      expect(json.ial).toBe(2);
      expect(json.verifiedAt).toBeDefined();
    });
  });

  // ── Response format ────────────────────────────────────────

  describe("response format", () => {
    it("returns ok, ial, and verifiedAt fields", async () => {
      const res = await app.request(
        "/api/auth-flow/mock-verify",
        {
          method: "POST",
          body: JSON.stringify({ userId: "user-123" }),
          headers: { "Content-Type": "application/json" },
        },
        env,
      );

      const json = await res.json() as any;
      expect(json).toHaveProperty("ok", true);
      expect(json).toHaveProperty("ial", 2);
      expect(json).toHaveProperty("verifiedAt");
      // verifiedAt should be a valid ISO date
      expect(new Date(json.verifiedAt).toISOString()).toBe(json.verifiedAt);
    });
  });

  // ── DB update (requires DB) ────────────────────────────────

  describe("PII storage (requires DB)", () => {
    it.todo("encrypts and stores mock PII in the users table");

    it.todo("sets user IAL to 2");

    it.todo("sets verifiedAt timestamp on the user record");
  });

  // ── HTTP method guard ──────────────────────────────────────

  describe("HTTP method", () => {
    it("rejects GET requests", async () => {
      const res = await app.request(
        "/api/auth-flow/mock-verify",
        { method: "GET" },
        env,
      );

      expect(res.status).toBe(404);
    });
  });
});
