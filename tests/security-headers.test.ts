/**
 * Tests for security headers middleware (packages/auth-core/src/middleware/security-headers.ts).
 *
 * Verifies that all required security headers are set on API routes
 * and that CSP is correctly skipped for UI routes (/sign-in, /demo, /dashboard).
 */
import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { securityHeaders } from "../packages/auth-core/src/middleware/security-headers.js";

// ── Test app ─────────────────────────────────────────────────

const app = new Hono();
app.use("*", securityHeaders as any);
app.get("/test", (c) => c.json({ ok: true }));
app.get("/api/data", (c) => c.json({ data: [] }));
app.get("/sign-in", (c) => c.text("login page"));
app.get("/sign-in/mfa", (c) => c.text("mfa page"));
app.get("/demo/test", (c) => c.text("demo"));
app.get("/demo/deep/path", (c) => c.text("deep demo"));
app.get("/dashboard", (c) => c.text("dashboard"));
app.get("/dashboard/settings", (c) => c.text("settings"));

// ── Tests ────────────────────────────────────────────────────

describe("Security Headers Middleware", () => {

  // ── Standard API route headers ──────────────────────────────

  describe("API route (/test)", () => {
    it("sets X-Frame-Options to DENY", async () => {
      const res = await app.request("/test");
      expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    });

    it("sets X-Content-Type-Options to nosniff", async () => {
      const res = await app.request("/test");
      expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    });

    it("sets Strict-Transport-Security with 2-year max-age", async () => {
      const res = await app.request("/test");
      const hsts = res.headers.get("Strict-Transport-Security");
      expect(hsts).toBe("max-age=63072000; includeSubDomains; preload");
    });

    it("sets Referrer-Policy to strict-origin-when-cross-origin", async () => {
      const res = await app.request("/test");
      expect(res.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    });

    it("sets restrictive Content-Security-Policy with default-src 'none'", async () => {
      const res = await app.request("/test");
      const csp = res.headers.get("Content-Security-Policy");
      expect(csp).toBeTruthy();
      expect(csp).toContain("default-src 'none'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain("form-action 'self'");
      expect(csp).toContain("base-uri 'none'");
    });

    it("sets Permissions-Policy to opt out of FLoC", async () => {
      const res = await app.request("/test");
      expect(res.headers.get("Permissions-Policy")).toBe("interest-cohort=()");
    });

    it("sets Cache-Control to no-store", async () => {
      const res = await app.request("/test");
      expect(res.headers.get("Cache-Control")).toBe("no-store");
    });

    it("sets Pragma to no-cache", async () => {
      const res = await app.request("/test");
      expect(res.headers.get("Pragma")).toBe("no-cache");
    });
  });

  // ── Another API route to verify consistency ──────────────────

  describe("API route (/api/data)", () => {
    it("also receives all security headers", async () => {
      const res = await app.request("/api/data");
      expect(res.headers.get("X-Frame-Options")).toBe("DENY");
      expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(res.headers.get("Strict-Transport-Security")).toContain("max-age=63072000");
      expect(res.headers.get("Content-Security-Policy")).toContain("default-src 'none'");
      expect(res.headers.get("Cache-Control")).toBe("no-store");
    });
  });

  // ── /sign-in route: no restrictive CSP ──────────────────────

  describe("/sign-in route", () => {
    it("does NOT have restrictive CSP", async () => {
      const res = await app.request("/sign-in");
      const csp = res.headers.get("Content-Security-Policy");
      // CSP should either be null or not contain the restrictive default-src 'none'
      if (csp) {
        expect(csp).not.toContain("default-src 'none'");
      }
    });

    it("still has other security headers", async () => {
      const res = await app.request("/sign-in");
      expect(res.headers.get("X-Frame-Options")).toBe("DENY");
      expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(res.headers.get("Strict-Transport-Security")).toContain("max-age=63072000");
      expect(res.headers.get("Cache-Control")).toBe("no-store");
    });

    it("skips restrictive CSP for nested /sign-in paths", async () => {
      const res = await app.request("/sign-in/mfa");
      const csp = res.headers.get("Content-Security-Policy");
      if (csp) {
        expect(csp).not.toContain("default-src 'none'");
      }
    });
  });

  // ── /demo route: no restrictive CSP ─────────────────────────

  describe("/demo route", () => {
    it("does NOT have restrictive CSP", async () => {
      const res = await app.request("/demo/test");
      const csp = res.headers.get("Content-Security-Policy");
      if (csp) {
        expect(csp).not.toContain("default-src 'none'");
      }
    });

    it("still has other security headers", async () => {
      const res = await app.request("/demo/test");
      expect(res.headers.get("X-Frame-Options")).toBe("DENY");
      expect(res.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
      expect(res.headers.get("Permissions-Policy")).toBe("interest-cohort=()");
    });

    it("skips restrictive CSP for deeply nested /demo paths", async () => {
      const res = await app.request("/demo/deep/path");
      const csp = res.headers.get("Content-Security-Policy");
      if (csp) {
        expect(csp).not.toContain("default-src 'none'");
      }
    });
  });

  // ── /dashboard route: no restrictive CSP ────────────────────

  describe("/dashboard route", () => {
    it("does NOT have restrictive CSP", async () => {
      const res = await app.request("/dashboard");
      const csp = res.headers.get("Content-Security-Policy");
      if (csp) {
        expect(csp).not.toContain("default-src 'none'");
      }
    });

    it("still has other security headers", async () => {
      const res = await app.request("/dashboard");
      expect(res.headers.get("X-Frame-Options")).toBe("DENY");
      expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(res.headers.get("Strict-Transport-Security")).toContain("max-age=63072000");
    });

    it("skips restrictive CSP for nested /dashboard paths", async () => {
      const res = await app.request("/dashboard/settings");
      const csp = res.headers.get("Content-Security-Policy");
      if (csp) {
        expect(csp).not.toContain("default-src 'none'");
      }
    });
  });
});
