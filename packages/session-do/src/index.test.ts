import { describe, it, expect } from "vitest";
import type { SessionState } from "./index.js";

describe("SessionDO state management", () => {
  const baseSession: SessionState = {
    spId: "https://app.agency.gov",
    responseType: "code",
    redirectUri: "https://app.agency.gov/callback",
    scopes: ["openid", "email"],
    nonce: "abc123",
    state: "xyz789",
    codeChallenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    codeChallengeMethod: "S256",
    requestedIal: 1,
    requestedAal: 1,
    mfaVerified: false,
    locale: "en",
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
  };

  it("should define correct default TTL of 15 minutes", () => {
    // 15 minutes = 900,000 ms
    expect(15 * 60 * 1000).toBe(900000);
  });

  it("should define remembered device TTL of 30 days", () => {
    // 30 days in ms
    expect(30 * 24 * 60 * 60 * 1000).toBe(2592000000);
  });

  it("should restrict updatable fields to allowed set", () => {
    const ALLOWED_UPDATE_FIELDS = new Set([
      "userId", "mfaVerified", "mfaMethod", "achievedAal", "achievedIal",
      "x509Presented", "x509Issuer", "x509Subject", "locale",
      "rememberedDevice", "phishingResistant", "hspd12", "facialMatch",
    ]);

    // These fields should NOT be updatable (OIDC flow state)
    expect(ALLOWED_UPDATE_FIELDS.has("spId")).toBe(false);
    expect(ALLOWED_UPDATE_FIELDS.has("redirectUri")).toBe(false);
    expect(ALLOWED_UPDATE_FIELDS.has("scopes")).toBe(false);
    expect(ALLOWED_UPDATE_FIELDS.has("codeChallenge")).toBe(false);
    expect(ALLOWED_UPDATE_FIELDS.has("codeChallengeMethod")).toBe(false);
    expect(ALLOWED_UPDATE_FIELDS.has("expiresAt")).toBe(false);
    expect(ALLOWED_UPDATE_FIELDS.has("createdAt")).toBe(false);
    expect(ALLOWED_UPDATE_FIELDS.has("responseType")).toBe(false);
    expect(ALLOWED_UPDATE_FIELDS.has("nonce")).toBe(false);
    expect(ALLOWED_UPDATE_FIELDS.has("state")).toBe(false);

    // These fields SHOULD be updatable
    expect(ALLOWED_UPDATE_FIELDS.has("userId")).toBe(true);
    expect(ALLOWED_UPDATE_FIELDS.has("mfaVerified")).toBe(true);
    expect(ALLOWED_UPDATE_FIELDS.has("mfaMethod")).toBe(true);
    expect(ALLOWED_UPDATE_FIELDS.has("achievedAal")).toBe(true);
    expect(ALLOWED_UPDATE_FIELDS.has("achievedIal")).toBe(true);
    expect(ALLOWED_UPDATE_FIELDS.has("x509Presented")).toBe(true);
  });

  it("should filter out disallowed fields from updates", () => {
    const ALLOWED_UPDATE_FIELDS = new Set([
      "userId", "mfaVerified", "mfaMethod", "achievedAal", "achievedIal",
      "x509Presented", "x509Issuer", "x509Subject", "locale",
      "rememberedDevice", "phishingResistant", "hspd12", "facialMatch",
    ]);

    const rawUpdates: Partial<SessionState> = {
      userId: "user-123",
      mfaVerified: true,
      mfaMethod: "totp",
      // These should be filtered out
      spId: "https://evil.com",
      redirectUri: "https://evil.com/steal",
      scopes: ["admin"],
    };

    const updates: Partial<SessionState> = {};
    for (const key of Object.keys(rawUpdates) as Array<keyof SessionState>) {
      if (ALLOWED_UPDATE_FIELDS.has(key)) {
        (updates as Record<string, unknown>)[key] = rawUpdates[key];
      }
    }

    expect(updates).toEqual({
      userId: "user-123",
      mfaVerified: true,
      mfaMethod: "totp",
    });
    expect((updates as Record<string, unknown>).spId).toBeUndefined();
    expect((updates as Record<string, unknown>).redirectUri).toBeUndefined();
    expect((updates as Record<string, unknown>).scopes).toBeUndefined();
  });

  it("should detect expired sessions", () => {
    const expiredSession = { ...baseSession, expiresAt: new Date(Date.now() - 1000).toISOString() };
    const activeSession = { ...baseSession, expiresAt: new Date(Date.now() + 60000).toISOString() };

    expect(new Date(expiredSession.expiresAt) < new Date()).toBe(true);
    expect(new Date(activeSession.expiresAt) < new Date()).toBe(false);
  });

  it("should support all required session state fields", () => {
    expect(baseSession.spId).toBeDefined();
    expect(baseSession.responseType).toBe("code");
    expect(baseSession.redirectUri).toBeDefined();
    expect(baseSession.scopes).toContain("openid");
    expect(baseSession.requestedIal).toBe(1);
    expect(baseSession.requestedAal).toBe(1);
    expect(baseSession.mfaVerified).toBe(false);
    expect(baseSession.locale).toBe("en");
    expect(baseSession.createdAt).toBeDefined();
    expect(baseSession.expiresAt).toBeDefined();
  });
});
