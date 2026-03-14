import { describe, it, expect } from "vitest";
import { encrypt, decrypt, importKey, generateKeyHex, computePairwiseSub, uuidV7 } from "./index.js";

describe("AES-256-GCM encryption", () => {
  it("should round-trip encrypt and decrypt", async () => {
    const keyHex = await generateKeyHex();
    const key = await importKey(keyHex);

    const plaintext = "123-45-6789"; // SSN
    const ciphertext = await encrypt(plaintext, key);

    expect(ciphertext).not.toBe(plaintext);
    expect(ciphertext.length).toBeGreaterThan(0);

    const decrypted = await decrypt(ciphertext, key);
    expect(decrypted).toBe(plaintext);
  });

  it("should produce different ciphertext for same plaintext (random IV)", async () => {
    const keyHex = await generateKeyHex();
    const key = await importKey(keyHex);

    const plaintext = "test data";
    const ct1 = await encrypt(plaintext, key);
    const ct2 = await encrypt(plaintext, key);

    expect(ct1).not.toBe(ct2); // different IVs
  });

  it("should fail to decrypt with wrong key", async () => {
    const key1 = await importKey(await generateKeyHex());
    const key2 = await importKey(await generateKeyHex());

    const ciphertext = await encrypt("secret", key1);

    await expect(decrypt(ciphertext, key2)).rejects.toThrow();
  });
});

describe("pairwise subject", () => {
  it("should produce consistent output for same inputs", async () => {
    const sub1 = await computePairwiseSub("user-123", "https://app.agency.gov", "salt");
    const sub2 = await computePairwiseSub("user-123", "https://app.agency.gov", "salt");
    expect(sub1).toBe(sub2);
  });

  it("should produce different subs for different SPs", async () => {
    const sub1 = await computePairwiseSub("user-123", "https://app1.gov", "salt");
    const sub2 = await computePairwiseSub("user-123", "https://app2.gov", "salt");
    expect(sub1).not.toBe(sub2);
  });

  it("should produce different subs for different users", async () => {
    const sub1 = await computePairwiseSub("user-1", "https://app.gov", "salt");
    const sub2 = await computePairwiseSub("user-2", "https://app.gov", "salt");
    expect(sub1).not.toBe(sub2);
  });
});

describe("UUID v7", () => {
  it("should generate valid UUID format", () => {
    const id = uuidV7();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("should generate unique IDs", () => {
    const ids = new Set(Array.from({ length: 100 }, () => uuidV7()));
    expect(ids.size).toBe(100);
  });

  it("should be time-ordered across different milliseconds", async () => {
    const id1 = uuidV7();
    // Small delay to ensure different millisecond timestamp
    await new Promise((r) => setTimeout(r, 2));
    const id2 = uuidV7();
    // UUIDs generated at different times should be sortable
    expect(id1 < id2).toBe(true);
  });
});
