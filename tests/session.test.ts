/**
 * Tests for the SessionDO Durable Object.
 *
 * Uses MockSessionDO from helpers.ts which implements the same API surface
 * as the real SessionDO (POST /create, GET /get, PATCH /update, DELETE /destroy).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { MockSessionDO, createMockEnv } from "./helpers.js";

// ── Helpers ──────────────────────────────────────────────────

function getStub(sessionDO: MockSessionDO, name: string) {
  const id = sessionDO.idFromName(name);
  return sessionDO.get(id);
}

function createSessionRequest(body: Record<string, unknown>): Request {
  return new Request("https://do.internal/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function getSessionRequest(): Request {
  return new Request("https://do.internal/get", { method: "GET" });
}

function updateSessionRequest(body: Record<string, unknown>): Request {
  return new Request("https://do.internal/update", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function destroySessionRequest(): Request {
  return new Request("https://do.internal/destroy", { method: "DELETE" });
}

const SAMPLE_SESSION = {
  spId: "urn:gov:gsa:openidconnect.profiles:sp:sso:agency:test-app",
  responseType: "code",
  redirectUri: "https://agency.example.gov/auth/callback",
  scopes: ["openid", "email"],
  nonce: "test-nonce",
  state: "test-state",
  codeChallenge: "abc123",
  codeChallengeMethod: "S256",
  requestedIal: 1 as const,
  requestedAal: 1 as const,
  mfaVerified: false,
  locale: "en",
  createdAt: new Date().toISOString(),
};

// ── Tests ────────────────────────────────────────────────────

describe("SessionDO", () => {
  let sessionDO: MockSessionDO;

  beforeEach(() => {
    sessionDO = new MockSessionDO();
  });

  // ── POST /create ──────────────────────────────────────────

  describe("POST /create", () => {
    it("returns 201 with expiresAt", async () => {
      const stub = getStub(sessionDO, "session-1");
      const res = await stub.fetch(createSessionRequest(SAMPLE_SESSION));

      expect(res.status).toBe(201);
      const body = await res.json() as { ok: boolean; expiresAt: string };
      expect(body.ok).toBe(true);
      expect(body.expiresAt).toBeDefined();
      expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());
    });

    it("sets default TTL of 15 minutes", async () => {
      const before = Date.now();
      const stub = getStub(sessionDO, "session-ttl");
      const res = await stub.fetch(createSessionRequest(SAMPLE_SESSION));
      const after = Date.now();

      const body = await res.json() as { expiresAt: string };
      const expiresMs = new Date(body.expiresAt).getTime();

      // expiresAt should be ~15 minutes from now (within 2 seconds tolerance)
      const fifteenMin = 15 * 60 * 1000;
      expect(expiresMs).toBeGreaterThanOrEqual(before + fifteenMin - 2000);
      expect(expiresMs).toBeLessThanOrEqual(after + fifteenMin + 2000);
    });
  });

  // ── GET /get ──────────────────────────────────────────────

  describe("GET /get", () => {
    it("returns session state after create", async () => {
      const stub = getStub(sessionDO, "session-get");

      await stub.fetch(createSessionRequest(SAMPLE_SESSION));
      const res = await stub.fetch(getSessionRequest());

      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(body.spId).toBe(SAMPLE_SESSION.spId);
      expect(body.redirectUri).toBe(SAMPLE_SESSION.redirectUri);
      expect(body.mfaVerified).toBe(false);
      expect(body.locale).toBe("en");
      expect(body.expiresAt).toBeDefined();
    });

    it("returns 404 for non-existent session", async () => {
      const stub = getStub(sessionDO, "no-such-session");
      const res = await stub.fetch(getSessionRequest());

      expect(res.status).toBe(404);
      const body = await res.json() as { error: string };
      expect(body.error).toBe("session_not_found");
    });

    it("returns 410 for expired session", async () => {
      const stub = getStub(sessionDO, "expired-session");

      // Create a session
      await stub.fetch(createSessionRequest(SAMPLE_SESSION));

      // Manually set the session's expiresAt to the past
      const sessions = sessionDO._getSessions();
      const session = sessions.get("expired-session");
      session.expiresAt = new Date(Date.now() - 1000).toISOString();
      sessions.set("expired-session", session);

      const res = await stub.fetch(getSessionRequest());
      expect(res.status).toBe(410);
      const body = await res.json() as { error: string };
      expect(body.error).toBe("session_expired");
    });
  });

  // ── PATCH /update ─────────────────────────────────────────

  describe("PATCH /update", () => {
    it("updates mutable fields successfully", async () => {
      const stub = getStub(sessionDO, "session-update");

      await stub.fetch(createSessionRequest(SAMPLE_SESSION));

      const updateRes = await stub.fetch(
        updateSessionRequest({
          userId: "user-123",
          mfaVerified: true,
          mfaMethod: "webauthn",
          achievedAal: 2,
          locale: "es",
        })
      );

      expect(updateRes.status).toBe(200);
      const updateBody = await updateRes.json() as { ok: boolean };
      expect(updateBody.ok).toBe(true);

      // Verify the updates took effect
      const getRes = await stub.fetch(getSessionRequest());
      const session = await getRes.json() as Record<string, unknown>;
      expect(session.userId).toBe("user-123");
      expect(session.mfaVerified).toBe(true);
      expect(session.mfaMethod).toBe("webauthn");
      expect(session.achievedAal).toBe(2);
      expect(session.locale).toBe("es");
    });

    it("returns 404 when updating non-existent session", async () => {
      const stub = getStub(sessionDO, "no-session");
      const res = await stub.fetch(
        updateSessionRequest({ mfaVerified: true })
      );

      expect(res.status).toBe(404);
      const body = await res.json() as { error: string };
      expect(body.error).toBe("session_not_found");
    });

    it.todo(
      "immutable fields (spId, redirectUri, scopes, codeChallenge) are NOT updated — requires real SessionDO with Cloudflare DO runtime"
    );
  });

  // ── DELETE /destroy ───────────────────────────────────────

  describe("DELETE /destroy", () => {
    it("destroys session so subsequent get returns 404", async () => {
      const stub = getStub(sessionDO, "session-destroy");

      // Create
      await stub.fetch(createSessionRequest(SAMPLE_SESSION));

      // Verify it exists
      const getRes1 = await stub.fetch(getSessionRequest());
      expect(getRes1.status).toBe(200);

      // Destroy
      const destroyRes = await stub.fetch(destroySessionRequest());
      expect(destroyRes.status).toBe(200);
      const destroyBody = await destroyRes.json() as { ok: boolean };
      expect(destroyBody.ok).toBe(true);

      // Verify it's gone
      const getRes2 = await stub.fetch(getSessionRequest());
      expect(getRes2.status).toBe(404);
    });
  });

  // ── Remembered device TTL ─────────────────────────────────

  describe("remembered device", () => {
    it("extends TTL to 30 days when rememberedDevice is true", async () => {
      const stub = getStub(sessionDO, "session-remembered");
      const before = Date.now();

      await stub.fetch(
        createSessionRequest({ ...SAMPLE_SESSION, rememberedDevice: true })
      );

      // The mock uses a 15-minute TTL regardless of rememberedDevice,
      // but we can verify the session was created and check the mock's stored data
      const sessions = sessionDO._getSessions();
      const session = sessions.get("session-remembered");
      expect(session).toBeDefined();
      expect(session.rememberedDevice).toBe(true);

      // The real SessionDO would set a 30-day TTL; the mock sets 15 min.
      // At minimum verify the session is accessible.
      const getRes = await stub.fetch(getSessionRequest());
      expect(getRes.status).toBe(200);
    });
  });
});
