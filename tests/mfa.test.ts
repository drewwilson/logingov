/**
 * Tests for the MFA Worker routes (packages/mfa/src/index.ts).
 *
 * Tests health check, challenge (missing user), status (missing session,
 * not found, valid session). Routes that require DB are marked .todo.
 */
import { describe, it, expect, beforeEach } from "vitest";
import mfaApp from "../packages/mfa/src/index.js";
import { createMockEnv } from "../tests/helpers.js";

// ── Helpers ──────────────────────────────────────────────────

async function createSession(env: ReturnType<typeof createMockEnv>, sessionId: string) {
  const doId = env.SESSION_DO.idFromName(sessionId);
  const stub = env.SESSION_DO.get(doId);
  await stub.fetch(new Request("https://session-do/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      spId: "test-sp",
      responseType: "code",
      redirectUri: "https://example.com/callback",
      scopes: ["openid"],
      requestedIal: 1,
      requestedAal: 2,
      mfaVerified: false,
      locale: "en",
      createdAt: new Date().toISOString(),
    }),
  }));
}

// ── Tests ────────────────────────────────────────────────────

describe("MFA Worker", () => {
  let env: ReturnType<typeof createMockEnv>;

  beforeEach(() => {
    env = createMockEnv();
  });

  // ── Health Check ────────────────────────────────────────────

  describe("GET /health", () => {
    it("returns ok with service name", async () => {
      const res = await mfaApp.request("/health", {}, env);
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body).toEqual({ ok: true, service: "mfa" });
    });
  });

  // ── GET /mfa/challenge ──────────────────────────────────────

  describe("GET /mfa/challenge", () => {
    it("returns 400 without X-User-Id header", async () => {
      const sessionId = "challenge-session";
      await createSession(env, sessionId);

      const res = await mfaApp.request("/mfa/challenge", {
        headers: { "X-Session-Id": sessionId },
      }, env);

      expect(res.status).toBe(400);
      const body = await res.json() as any;
      expect(body.error).toBe("missing_user_id");
    });

    it.todo("returns configured MFA methods for a user with TOTP");
    it.todo("returns only webauthn when phishing-resistant is required");
    it.todo("returns only piv when HSPD-12 is required");
    it.todo("returns mfa_verified status from session");
  });

  // ── GET /mfa/status ─────────────────────────────────────────

  describe("GET /mfa/status", () => {
    it("returns 400 without X-Session-Id header", async () => {
      const res = await mfaApp.request("/mfa/status", {}, env);
      expect(res.status).toBe(400);
      const body = await res.json() as any;
      expect(body.error).toBe("missing_session_id");
    });

    it("returns 404 for non-existent session", async () => {
      const res = await mfaApp.request("/mfa/status", {
        headers: { "X-Session-Id": "does-not-exist" },
      }, env);

      expect(res.status).toBe(404);
      const body = await res.json() as any;
      expect(body.error).toBe("session_not_found");
    });

    it("returns MFA state for a valid session", async () => {
      const sessionId = "status-test-session";
      await createSession(env, sessionId);

      const res = await mfaApp.request("/mfa/status", {
        headers: { "X-Session-Id": sessionId },
      }, env);

      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.mfa_verified).toBe(false);
      expect(body.mfa_method).toBeNull();
      expect(body.requested_aal).toBe(2);
      expect(body.phishing_resistant).toBe(false);
      expect(body.hspd12).toBe(false);
    });

    it("reflects updated MFA state after session patch", async () => {
      const sessionId = "patched-session";
      await createSession(env, sessionId);

      // Patch the session to mark MFA verified
      const doId = env.SESSION_DO.idFromName(sessionId);
      const stub = env.SESSION_DO.get(doId);
      await stub.fetch(new Request("https://session-do/update", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mfaVerified: true,
          mfaMethod: "totp",
          achievedAal: 2,
        }),
      }));

      const res = await mfaApp.request("/mfa/status", {
        headers: { "X-Session-Id": sessionId },
      }, env);

      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.mfa_verified).toBe(true);
      expect(body.mfa_method).toBe("totp");
      expect(body.achieved_aal).toBe(2);
    });
  });

  // ── TOTP Routes ─────────────────────────────────────────────

  describe("POST /mfa/totp/setup", () => {
    it.todo("generates TOTP secret and returns otpauth URI");
    it.todo("returns 400 without X-User-Id");
    it.todo("returns 409 if TOTP already configured");
  });

  describe("POST /mfa/totp/verify", () => {
    it.todo("verifies valid TOTP code and updates session");
    it.todo("returns 400 for invalid TOTP code");
    it.todo("rate-limits after too many failed attempts");
  });

  // ── SMS OTP Routes ──────────────────────────────────────────

  describe("POST /mfa/sms/send", () => {
    it.todo("sends SMS OTP to user's registered phone");
    it.todo("returns 400 without X-User-Id");
    it.todo("returns 404 if user has no phone credential");
  });

  describe("POST /mfa/sms/verify", () => {
    it.todo("verifies valid SMS OTP code");
    it.todo("returns 400 for invalid OTP code");
    it.todo("returns 400 for expired OTP code");
  });

  // ── WebAuthn Routes ─────────────────────────────────────────

  describe("POST /mfa/webauthn/register/options", () => {
    it.todo("generates WebAuthn registration options");
    it.todo("returns 400 without X-User-Id");
  });

  describe("POST /mfa/webauthn/authenticate/options", () => {
    it.todo("generates WebAuthn authentication options");
    it.todo("returns allowCredentials for registered keys");
  });

  // ── Backup Codes Routes ─────────────────────────────────────

  describe("POST /mfa/backup-codes/generate", () => {
    it.todo("generates 10 backup codes and stores hashes in DB");
    it.todo("replaces existing backup codes on regeneration");
    it.todo("returns 400 without X-User-Id");
  });

  describe("POST /mfa/backup-codes/verify", () => {
    it.todo("verifies a valid backup code and marks it used");
    it.todo("returns 400 for already-used backup code");
    it.todo("returns 400 for invalid backup code");
  });

  describe("GET /mfa/backup-codes/count", () => {
    it.todo("returns count of remaining unused backup codes");
    it.todo("returns 0 when all codes have been used");
    it.todo("returns 400 without X-User-Id");
  });
});
