/**
 * JWT token signing and verification utilities.
 * Uses `jose` for RS256 operations with keys from KV/R2.
 */
import * as jose from "jose";
import { uuidV7 } from "@logingov/shared";
import type { Env } from "@logingov/shared";
import { kvGet, kvPut, KV_KEYS, KV_TTL } from "@logingov/shared";

const ISSUER = "https://secure.login.gov";
const ID_TOKEN_EXPIRY = "5m";

export interface IdTokenClaims {
  sub: string;
  aud: string;
  nonce?: string;
  acr: string;
  ial: number;
  aal: number;
  at_hash?: string;
  c_hash?: string;
  locale?: string;
  email?: string;
  email_verified?: boolean;
  [key: string]: unknown;
}

/**
 * Load the RS256 private key (JWK) from KV, falling back to R2.
 */
export async function getSigningKey(env: Env): Promise<{ key: jose.CryptoKey; kid: string }> {
  // Try KV first
  const cached = await kvGet<{ jwk: jose.JWK; kid: string }>(env.KV_JWKS, KV_KEYS.signingKey("current"));
  if (cached) {
    const key = await jose.importJWK(cached.jwk, "RS256");
    return { key: key as jose.CryptoKey, kid: cached.kid };
  }

  // Fall back to R2
  const r2Object = await env.R2_KEYS.get("signing-key-current.json");
  if (!r2Object) {
    throw new Error("No signing key found in KV or R2");
  }

  const keyData = await r2Object.json<{ jwk: jose.JWK; kid: string }>();
  // Cache in KV
  await kvPut(env.KV_JWKS, KV_KEYS.signingKey("current"), keyData, KV_TTL.JWKS);
  const key = await jose.importJWK(keyData.jwk, "RS256");
  return { key: key as jose.CryptoKey, kid: keyData.kid };
}

/**
 * Sign an id_token as a RS256 JWT.
 */
export async function signIdToken(claims: IdTokenClaims, env: Env): Promise<string> {
  const { key, kid } = await getSigningKey(env);
  const now = Math.floor(Date.now() / 1000);

  const jwt = await new jose.SignJWT(claims as unknown as jose.JWTPayload)
    .setProtectedHeader({ alg: "RS256", kid })
    .setIssuer(ISSUER)
    .setSubject(claims.sub)
    .setAudience(claims.aud)
    .setIssuedAt(now)
    .setExpirationTime(ID_TOKEN_EXPIRY)
    .setJti(uuidV7())
    .sign(key);

  return jwt;
}

/**
 * Compute at_hash or c_hash: left half of SHA-256 of the token, base64url-encoded.
 */
export async function computeTokenHash(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  const leftHalf = new Uint8Array(digest).slice(0, 16);
  return jose.base64url.encode(leftHalf);
}

/**
 * Generate an opaque access token and store it in KV.
 */
export async function issueAccessToken(
  env: Env,
  userId: string,
  spId: string,
  scopes: string[]
): Promise<string> {
  const token = uuidV7() + "-" + crypto.randomUUID();
  const key = `access_token:${token}`;

  await kvPut(
    env.KV_SESSIONS,
    key,
    { userId, spId, scopes, issuedAt: new Date().toISOString() },
    KV_TTL.ACCESS_TOKEN
  );

  return token;
}

/**
 * Validate an access token from KV. Returns token metadata or null.
 */
export async function validateAccessToken(
  env: Env,
  token: string
): Promise<{ userId: string; spId: string; scopes: string[] } | null> {
  const key = `access_token:${token}`;
  return kvGet(env.KV_SESSIONS, key);
}
