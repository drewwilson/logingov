import { describe, it, expect } from "vitest";
import {
  computeS256Challenge,
  verifyCodeChallenge,
  validateCodeVerifier,
  validateCodeChallenge,
} from "./pkce.js";

describe("computeS256Challenge", () => {
  it("should produce correct output for a known input", async () => {
    // RFC 7636 Appendix B test vector:
    // code_verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
    // expected S256 challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const challenge = await computeS256Challenge(verifier);
    expect(challenge).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });
});

describe("verifyCodeChallenge", () => {
  // Note: verifyCodeChallenge uses crypto.subtle.timingSafeEqual which is
  // only available in Cloudflare Workers runtime, not Node.js.
  // These tests require miniflare or the Workers runtime to execute.

  it("should throw for non-S256 method", async () => {
    // This code path runs before timingSafeEqual, so it works in Node
    await expect(
      verifyCodeChallenge("any-verifier", "any-challenge", "plain")
    ).rejects.toThrow("Only S256 code_challenge_method is supported");
  });

  it.skipIf(!crypto.subtle.timingSafeEqual)(
    "should succeed for a valid verifier/challenge pair",
    async () => {
      const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
      const challenge = await computeS256Challenge(verifier);
      await expect(
        verifyCodeChallenge(verifier, challenge, "S256")
      ).resolves.toBeUndefined();
    }
  );

  it.skipIf(!crypto.subtle.timingSafeEqual)(
    "should throw for mismatched verifier/challenge",
    async () => {
      const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
      const wrongChallenge = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
      await expect(
        verifyCodeChallenge(verifier, wrongChallenge, "S256")
      ).rejects.toThrow("code_verifier does not match code_challenge");
    }
  );
});

describe("validateCodeVerifier", () => {
  it("should reject strings shorter than 43 characters", () => {
    const short = "a".repeat(42);
    expect(validateCodeVerifier(short)).toBe(false);
  });

  it("should reject strings longer than 128 characters", () => {
    const long = "a".repeat(129);
    expect(validateCodeVerifier(long)).toBe(false);
  });

  it("should reject strings with invalid characters", () => {
    const withSpace = "a".repeat(42) + " ";
    const withBang = "a".repeat(42) + "!";
    const withSlash = "a".repeat(42) + "/";
    expect(validateCodeVerifier(withSpace)).toBe(false);
    expect(validateCodeVerifier(withBang)).toBe(false);
    expect(validateCodeVerifier(withSlash)).toBe(false);
  });

  it("should accept a valid verifier", () => {
    // Exactly 43 chars — minimum valid length
    const exact43 = "a".repeat(43);
    expect(exact43.length).toBe(43);
    expect(validateCodeVerifier(exact43)).toBe(true);

    // 128 chars — maximum valid length
    const exact128 = "a".repeat(128);
    expect(validateCodeVerifier(exact128)).toBe(true);

    // All allowed character classes: [A-Za-z0-9\-._~]
    const allClasses = "abcABC012-._~" + "a".repeat(30);
    expect(validateCodeVerifier(allClasses)).toBe(true);
  });
});

describe("validateCodeChallenge", () => {
  it("should accept a valid base64url challenge", () => {
    // S256 challenge from RFC 7636 test vector
    expect(
      validateCodeChallenge("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
    ).toBe(true);
  });

  it("should reject an empty string", () => {
    expect(validateCodeChallenge("")).toBe(false);
  });
});
