/**
 * Tests for password management routes (packages/account/src/routes/password.ts).
 *
 * Tests input validation and auth checks that don't require a real database.
 * DB-dependent tests are marked .todo.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { password } from "../packages/account/src/routes/password.js";
import { createMockEnv } from "../tests/helpers.js";

// ── Test app factory ─────────────────────────────────────────

function createTestApp() {
  const app = new Hono<{ Bindings: any }>();
  app.onError((err, c) => {
    return c.json({ error: "server_error", message: err.message }, 500);
  });
  app.route("/", password);
  return app;
}

// ── Tests ────────────────────────────────────────────────────

describe("Password Routes", () => {
  let env: ReturnType<typeof createMockEnv>;
  let app: ReturnType<typeof createTestApp>;

  beforeEach(() => {
    env = createMockEnv();
    app = createTestApp();
  });

  // ── POST /set ───────────────────────────────────────────────

  describe("POST /set", () => {
    it("returns 401 without X-User-Id header", async () => {
      const res = await app.request("/set", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "a-secure-password-123" }),
      }, env);

      expect(res.status).toBe(401);
      const body = await res.json() as any;
      expect(body.error).toBe("unauthorized");
    });

    it("returns 400 with empty password", async () => {
      const res = await app.request("/set", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-User-Id": "test-user-id",
        },
        body: JSON.stringify({ password: "" }),
      }, env);

      expect(res.status).toBe(400);
      const body = await res.json() as any;
      expect(body.error).toBe("missing_password");
    });

    it.todo("returns 400 weak_password for passwords shorter than 12 characters (needs DB for email lookup)");
    it.todo("returns 409 if user already has a password credential");
    it.todo("returns 201 with credentialId on successful password set");
  });

  // ── POST /change ────────────────────────────────────────────

  describe("POST /change", () => {
    it("returns 401 without X-User-Id header", async () => {
      const res = await app.request("/change", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword: "old-password-123",
          newPassword: "new-password-456",
        }),
      }, env);

      expect(res.status).toBe(401);
      const body = await res.json() as any;
      expect(body.error).toBe("unauthorized");
    });

    it("returns 400 when missing required fields", async () => {
      const res = await app.request("/change", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-User-Id": "test-user-id",
        },
        body: JSON.stringify({ currentPassword: "old-password-123" }),
      }, env);

      expect(res.status).toBe(400);
      const body = await res.json() as any;
      expect(body.error).toBe("missing_fields");
    });

    it("returns 400 same_password when new password equals current", async () => {
      const res = await app.request("/change", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-User-Id": "test-user-id",
        },
        body: JSON.stringify({
          currentPassword: "same-password-123",
          newPassword: "same-password-123",
        }),
      }, env);

      expect(res.status).toBe(400);
      const body = await res.json() as any;
      expect(body.error).toBe("same_password");
    });

    it.todo("returns 404 when user has no password credential");
    it.todo("returns 401 when current password is incorrect");
    it.todo("returns 400 weak_password when new password is too weak");
    it.todo("updates password hash and emits SET event on success");
  });

  // ── POST /forgot ────────────────────────────────────────────

  describe("POST /forgot", () => {
    it("returns 400 without email", async () => {
      const res = await app.request("/forgot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }, env);

      expect(res.status).toBe(400);
      const body = await res.json() as any;
      expect(body.error).toBe("missing_email");
    });

    it.todo("always returns success regardless of whether email exists (prevents enumeration)");
    it.todo("sends reset email via QUEUE_EMAIL when user exists");
    it.todo("does not send email when user does not exist");
  });

  // ── POST /reset ─────────────────────────────────────────────

  describe("POST /reset", () => {
    it("returns 400 without token", async () => {
      const res = await app.request("/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPassword: "new-secure-password-123" }),
      }, env);

      expect(res.status).toBe(400);
      const body = await res.json() as any;
      expect(body.error).toBe("missing_fields");
    });

    it("returns 400 without newPassword", async () => {
      const res = await app.request("/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: "some-token" }),
      }, env);

      expect(res.status).toBe(400);
      const body = await res.json() as any;
      expect(body.error).toBe("missing_fields");
    });

    it("returns 400 invalid_token for a malformed token", async () => {
      const res = await app.request("/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: "not-a-valid-jwt-token",
          newPassword: "new-secure-password-123",
        }),
      }, env);

      expect(res.status).toBe(400);
      const body = await res.json() as any;
      expect(body.error).toBe("invalid_token");
    });

    it("returns 400 invalid_token for a token with bad signature", async () => {
      // Construct a JWT-shaped token with an invalid signature
      const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }))
        .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      const payload = btoa(JSON.stringify({
        jti: "fake-jti",
        userId: "fake-user",
        email: "fake@example.com",
        purpose: "password_reset",
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
      })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      const fakeSignature = btoa("fake-signature-bytes")
        .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

      const res = await app.request("/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: `${header}.${payload}.${fakeSignature}`,
          newPassword: "new-secure-password-123",
        }),
      }, env);

      expect(res.status).toBe(400);
      const body = await res.json() as any;
      expect(body.error).toBe("invalid_token");
    });

    it.todo("returns 400 token_expired for an expired reset token");
    it.todo("returns 400 invalid_token when reset token jti has already been used (single-use enforcement)");
    it.todo("resets password and marks token jti as used on success");
    it.todo("returns 400 weak_password if new password is too weak");
  });
});
