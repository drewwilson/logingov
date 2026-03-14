import { describe, it, expect } from "vitest";
import { computeBlindIndex } from "./index.js";

describe("computeBlindIndex", () => {
  const testKey = "test-hmac-key-for-blind-index";

  it("should produce consistent output for same input", async () => {
    const idx1 = await computeBlindIndex("user@example.com", testKey);
    const idx2 = await computeBlindIndex("user@example.com", testKey);
    expect(idx1).toBe(idx2);
  });

  it("should normalize input (case-insensitive, trimmed)", async () => {
    const idx1 = await computeBlindIndex("User@Example.COM", testKey);
    const idx2 = await computeBlindIndex("user@example.com", testKey);
    const idx3 = await computeBlindIndex("  user@example.com  ", testKey);
    expect(idx1).toBe(idx2);
    expect(idx2).toBe(idx3);
  });

  it("should produce different output for different inputs", async () => {
    const idx1 = await computeBlindIndex("user1@example.com", testKey);
    const idx2 = await computeBlindIndex("user2@example.com", testKey);
    expect(idx1).not.toBe(idx2);
  });

  it("should produce different output for different keys", async () => {
    const idx1 = await computeBlindIndex("user@example.com", "key1");
    const idx2 = await computeBlindIndex("user@example.com", "key2");
    expect(idx1).not.toBe(idx2);
  });

  it("should return a hex string (64 chars for SHA-256)", async () => {
    const idx = await computeBlindIndex("test@example.com", testKey);
    expect(idx).toMatch(/^[0-9a-f]{64}$/);
  });
});
