/**
 * private_key_jwt client authentication.
 * Validates client_assertion JWTs signed by the SP's private key
 * against the SP's registered public key from D1/KV.
 */
import * as jose from "jose";
import type { Env } from "@logingov/shared";
import { kvGet, kvPut, KV_KEYS, KV_TTL } from "@logingov/shared";
import { AppError } from "@logingov/shared";
import { lookupServiceProvider } from "./sp-lookup.js";

const TOKEN_ENDPOINT = "https://secure.login.gov/api/openid_connect/token";
const MAX_CLOCK_SKEW = 60; // seconds

export interface ClientAssertionResult {
  clientId: string;
}

/**
 * Validate a private_key_jwt client assertion per RFC 7523.
 *
 * Expected assertion claims:
 * - iss: client_id (SP issuer URI)
 * - sub: client_id (SP issuer URI)
 * - aud: token endpoint URL
 * - exp: future timestamp
 * - jti: unique identifier (for replay prevention)
 */
export async function validateClientAssertion(
  clientAssertionJwt: string,
  env: Env
): Promise<ClientAssertionResult> {
  // Decode header without verification to get the client_id from payload
  const decoded = jose.decodeJwt(clientAssertionJwt);

  const clientId = decoded.iss;
  if (!clientId || typeof clientId !== "string") {
    throw new AppError("invalid_client", "client_assertion missing iss claim", 401);
  }

  if (decoded.sub !== clientId) {
    throw new AppError("invalid_client", "client_assertion iss and sub must match", 401);
  }

  // Look up SP to get public key
  const sp = await lookupServiceProvider(clientId, env);
  if (!sp) {
    throw new AppError("invalid_client", "Unknown or invalid client_id", 401);
  }

  // Import SP's public key (PEM format)
  let publicKey: jose.CryptoKey;
  try {
    publicKey = await jose.importSPKI(sp.publicKey, "RS256");
  } catch {
    throw new AppError("invalid_client", "Failed to parse SP public key", 500);
  }

  // Verify the JWT signature and claims
  let verifiedPayload: jose.JWTPayload;
  try {
    const { payload } = await jose.jwtVerify(clientAssertionJwt, publicKey, {
      issuer: clientId,
      subject: clientId,
      audience: TOKEN_ENDPOINT,
      clockTolerance: MAX_CLOCK_SKEW,
    });
    verifiedPayload = payload;
  } catch (err) {
    const message = err instanceof Error ? err.message : "JWT verification failed";
    throw new AppError("invalid_client", `client_assertion verification failed: ${message}`, 401);
  }

  // ── jti replay prevention ──────────────────────────────────
  const jti = verifiedPayload.jti;
  if (!jti) {
    throw new AppError("invalid_client", "client_assertion must include a jti claim", 401);
  }

  const jtiKey = `client_assertion_jti:${jti}`;
  const existingJti = await kvGet<boolean>(env.KV_SESSIONS, jtiKey);
  if (existingJti) {
    throw new AppError("invalid_client", "client_assertion jti has already been used", 401);
  }

  // Store jti with TTL matching the max assertion lifetime (5 minutes + clock skew)
  await kvPut(env.KV_SESSIONS, jtiKey, true, 5 * 60 + MAX_CLOCK_SKEW);

  return { clientId };
}
