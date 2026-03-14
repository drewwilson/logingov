/**
 * JWKS key rotation — Cron Trigger handler (hourly).
 *
 * Lifecycle:
 *  1. Check current JWKS in KV_JWKS.
 *  2. If no keys exist or the newest key is > 23 hours old, generate a new RS256 keypair.
 *  3. Store private key in R2_KEYS (encrypted with ENCRYPTION_KEY).
 *  4. Update KV_JWKS with the new public keyset (current + previous for graceful rotation).
 *  5. Key ID (kid) is derived from a SHA-256 fingerprint of the public key.
 *
 * Supports multiple active keys so tokens signed with the previous key
 * remain valid until they expire (graceful rotation).
 */

import type { Env } from "@logingov/shared";
import { kvGet, kvPut, KV_KEYS, KV_TTL, encrypt, importKey } from "@logingov/shared";

// ── Types ───────────────────────────────────────────────────

export interface JWK {
  kty: "RSA";
  kid: string;
  use: "sig";
  alg: "RS256";
  n: string;
  e: string;
}

export interface JWKS {
  keys: JWK[];
}

interface StoredKeyMeta {
  kid: string;
  createdAt: string;
  /** R2 key for the encrypted private key */
  r2Key: string;
}

interface JWKSState {
  keys: JWK[];
  meta: StoredKeyMeta[];
}

// Max keys in the active set (current + 1 previous)
const MAX_ACTIVE_KEYS = 2;
// Rotate when the newest key is older than this (23 hours)
const ROTATION_THRESHOLD_MS = 23 * 60 * 60 * 1000;

// ── Main cron handler ───────────────────────────────────────

export async function handleKeyRotation(env: Env): Promise<void> {
  const state = await kvGet<JWKSState>(env.KV_JWKS, KV_KEYS.jwks());

  const now = Date.now();
  let needsRotation = false;

  if (!state || state.meta.length === 0) {
    needsRotation = true;
  } else {
    // Check age of newest key
    const newestKey = state.meta.reduce((a, b) =>
      new Date(a.createdAt) > new Date(b.createdAt) ? a : b
    );
    needsRotation = now - new Date(newestKey.createdAt).getTime() > ROTATION_THRESHOLD_MS;
  }

  if (!needsRotation) {
    return; // Keys are fresh enough
  }

  // Generate new RS256 keypair
  const keyPair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([0x01, 0x00, 0x01]).buffer as ArrayBuffer,
      hash: "SHA-256",
    },
    true, // extractable
    ["sign", "verify"]
  );

  // Export public key as JWK
  const publicJwk = (await crypto.subtle.exportKey("jwk", (keyPair as CryptoKeyPair).publicKey)) as JsonWebKey;

  // Compute kid from SHA-256 fingerprint of the public key (n component)
  const kid = await computeKid(publicJwk.n!);

  // Export private key as JWK, then encrypt and store in R2
  const privateJwk = await crypto.subtle.exportKey("jwk", (keyPair as CryptoKeyPair).privateKey);
  const privateKeyJson = JSON.stringify(privateJwk);
  const encryptionKey = await importKey(env.ENCRYPTION_KEY);
  const encryptedPrivateKey = await encrypt(privateKeyJson, encryptionKey);

  const r2Key = `keys/${kid}.enc`;
  await env.R2_KEYS.put(r2Key, encryptedPrivateKey, {
    customMetadata: {
      kid,
      createdAt: new Date(now).toISOString(),
      algorithm: "RS256",
    },
  });

  // Build new JWK entry
  const jwk: JWK = {
    kty: "RSA",
    kid,
    use: "sig",
    alg: "RS256",
    n: publicJwk.n!,
    e: publicJwk.e!,
  };

  const newMeta: StoredKeyMeta = {
    kid,
    createdAt: new Date(now).toISOString(),
    r2Key,
  };

  // Merge with existing state, keep only MAX_ACTIVE_KEYS
  const existingKeys = state?.keys ?? [];
  const existingMeta = state?.meta ?? [];

  const allKeys = [jwk, ...existingKeys].slice(0, MAX_ACTIVE_KEYS);
  const allMeta = [newMeta, ...existingMeta].slice(0, MAX_ACTIVE_KEYS);

  const newState: JWKSState = { keys: allKeys, meta: allMeta };

  // Write to KV with TTL
  await kvPut(env.KV_JWKS, KV_KEYS.jwks(), newState, KV_TTL.JWKS);
}

/**
 * Get the current JWKS (public keys only) for the /.well-known/jwks.json endpoint.
 */
export async function getPublicJWKS(env: Env): Promise<JWKS> {
  const state = await kvGet<JWKSState>(env.KV_JWKS, KV_KEYS.jwks());
  return { keys: state?.keys ?? [] };
}

/**
 * Get the latest signing key kid (for token signing).
 */
export async function getCurrentSigningKid(env: Env): Promise<string | null> {
  const state = await kvGet<JWKSState>(env.KV_JWKS, KV_KEYS.jwks());
  if (!state || state.meta.length === 0) return null;
  // Newest key is first
  return state.meta[0].kid;
}

// ── Helpers ─────────────────────────────────────────────────

async function computeKid(nComponent: string): Promise<string> {
  const data = new TextEncoder().encode(nComponent);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = new Uint8Array(hashBuffer);
  // Use first 16 bytes as kid (url-safe base64)
  return bufferToUrlSafeBase64(hashArray.slice(0, 16));
}

function bufferToUrlSafeBase64(buffer: Uint8Array): string {
  let binary = "";
  for (const byte of buffer) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
