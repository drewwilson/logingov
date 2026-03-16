/**
 * AES-256-GCM encryption/decryption for PII fields.
 * Uses Web Crypto API — works in Cloudflare Workers without Node.js deps.
 */

const ALGO = "AES-GCM";
const KEY_LENGTH = 256;
const IV_LENGTH = 12; // 96 bits recommended for GCM
const TAG_LENGTH = 128;

/**
 * Import a raw hex encryption key into a CryptoKey.
 */
export async function importKey(hexKey: string): Promise<CryptoKey> {
  const keyBuffer = hexToBuffer(hexKey);
  return crypto.subtle.importKey("raw", keyBuffer, { name: ALGO, length: KEY_LENGTH }, false, [
    "encrypt",
    "decrypt",
  ]);
}

/**
 * Encrypt plaintext with AES-256-GCM.
 * Returns base64(iv + ciphertext + tag).
 */
export async function encrypt(plaintext: string, key: CryptoKey): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const encoded = new TextEncoder().encode(plaintext);

  const ciphertext = await crypto.subtle.encrypt(
    { name: ALGO, iv: iv.buffer as ArrayBuffer, tagLength: TAG_LENGTH },
    key,
    encoded
  );

  // Combine IV + ciphertext (GCM tag is appended by Web Crypto)
  const combined = new Uint8Array(IV_LENGTH + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), IV_LENGTH);

  return bufferToBase64(combined);
}

/**
 * Decrypt a base64(iv + ciphertext + tag) blob.
 */
export async function decrypt(encoded: string, key: CryptoKey): Promise<string> {
  const combined = base64ToBuffer(encoded);
  const iv = combined.slice(0, IV_LENGTH);
  const ciphertext = combined.slice(IV_LENGTH);

  const decrypted = await crypto.subtle.decrypt(
    { name: ALGO, iv: (iv as Uint8Array).buffer as ArrayBuffer, tagLength: TAG_LENGTH },
    key,
    ciphertext
  );

  return new TextDecoder().decode(decrypted);
}

/**
 * Generate a new AES-256 key as a hex string (for initial setup).
 */
export async function generateKeyHex(): Promise<string> {
  const key = await crypto.subtle.generateKey({ name: ALGO, length: KEY_LENGTH }, true, [
    "encrypt",
    "decrypt",
  ]);
  const raw = await crypto.subtle.exportKey("raw", key as CryptoKey);
  return bufferToHex(new Uint8Array(raw as ArrayBuffer));
}

/**
 * Compute pairwise subject identifier.
 * HMAC-SHA256(salt, user_id + sector_identifier)
 */
export async function computePairwiseSub(
  userId: string,
  sectorIdentifier: string,
  salt: string
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(salt),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const data = new TextEncoder().encode(userId + "\0" + sectorIdentifier);
  const signature = await crypto.subtle.sign("HMAC", key, data);
  return bufferToHex(new Uint8Array(signature));
}

/**
 * Compute pairwise subject identifier for migrated users.
 * Matches the old Rails computation: Digest::SHA256.hexdigest(uuid + issuer + salt)
 * Uses plain SHA-256 (not HMAC) with simple string concatenation (no null byte separator).
 */
export async function computeLegacyPairwiseSub(
  legacyUuid: string,
  sectorIdentifier: string,
  salt: string
): Promise<string> {
  const data = new TextEncoder().encode(legacyUuid + sectorIdentifier + salt);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return bufferToHex(new Uint8Array(hash));
}

// ── UUID v7 ─────────────────────────────────────────────────

/**
 * Generate a UUID v7 (time-ordered, random).
 */
export function uuidV7(): string {
  const now = Date.now();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);

  // Timestamp (48 bits) in first 6 bytes
  bytes[0] = (now / 2 ** 40) & 0xff;
  bytes[1] = (now / 2 ** 32) & 0xff;
  bytes[2] = (now / 2 ** 24) & 0xff;
  bytes[3] = (now / 2 ** 16) & 0xff;
  bytes[4] = (now / 2 ** 8) & 0xff;
  bytes[5] = now & 0xff;

  // Version 7
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  // Variant 10
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = bufferToHex(bytes);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

// ── Helpers ─────────────────────────────────────────────────

function hexToBuffer(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

function bufferToHex(buffer: Uint8Array): string {
  return Array.from(buffer)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function bufferToBase64(buffer: Uint8Array): string {
  let binary = "";
  for (const byte of buffer) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64ToBuffer(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Compute a blind index for a value (e.g., email) using HMAC-SHA256.
 * Used for equality lookups on encrypted fields without exposing plaintext.
 * The value is normalized (lowercased, trimmed) before hashing.
 */
export async function computeBlindIndex(value: string, key: string): Promise<string> {
  const normalized = value.toLowerCase().trim();
  const hmacKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    hmacKey,
    new TextEncoder().encode(normalized)
  );
  return bufferToHex(new Uint8Array(signature));
}
