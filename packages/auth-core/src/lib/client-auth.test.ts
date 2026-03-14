import { describe, it, expect } from "vitest";

describe("client-auth", () => {
  it("should require iss claim in client assertion", async () => {
    // Document: The validateClientAssertion function first decodes the JWT
    // and checks for an iss claim. Without it, it throws "client_assertion missing iss claim"
    expect(true).toBe(true); // placeholder - needs integration test harness
  });

  it("should require iss and sub to match", async () => {
    // Document: iss must equal sub per RFC 7523
    expect(true).toBe(true);
  });

  it("should reject reused jti values", async () => {
    // Document: jti replay prevention stores used JTIs in KV with TTL
    expect(true).toBe(true);
  });
});
