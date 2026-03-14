/**
 * JWKS/Certs Endpoint — GET /api/openid_connect/certs
 *
 * Serves the JSON Web Key Set (JWKS) for id_token verification.
 * Uses KV cache with fallback to R2 key store.
 * If no keys exist yet (fresh local dev), generates one on-the-fly.
 */
import { Hono } from "hono";
import type { Env } from "@logingov/shared";
import { kvGet, kvPut, KV_KEYS, KV_TTL } from "@logingov/shared";

interface JWKSResponse {
  keys: JsonWebKey[];
}

const certsRoute = new Hono<{ Bindings: Env }>();

certsRoute.get("/api/openid_connect/certs", async (c) => {
  // ── Try KV cache first ────────────────────────────────────────
  const cached = await kvGet<JWKSResponse>(c.env.KV_JWKS, KV_KEYS.jwks());
  if (cached) {
    return c.json(cached, 200, {
      "Cache-Control": "public, max-age=3600",
    });
  }

  // ── Fall back to R2 ──────────────────────────────────────────
  const r2Object = await c.env.R2_KEYS.get("jwks.json");
  if (r2Object) {
    const jwks = await r2Object.json<JWKSResponse>();
    await kvPut(c.env.KV_JWKS, KV_KEYS.jwks(), jwks, KV_TTL.JWKS);
    return c.json(jwks, 200, {
      "Cache-Control": "public, max-age=3600",
    });
  }

  // ── No keys exist yet — generate one for local dev ────────────
  const keyPair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"]
  );

  const kp = keyPair as CryptoKeyPair;
  const publicJwk = await crypto.subtle.exportKey("jwk", kp.publicKey) as JsonWebKey & Record<string, unknown>;
  const kid = crypto.randomUUID();
  publicJwk.kid = kid;
  publicJwk.use = "sig";
  publicJwk.alg = "RS256";

  const jwks: JWKSResponse = { keys: [publicJwk] };

  // Store the private key in R2 for token signing
  const privateJwk = await crypto.subtle.exportKey("jwk", kp.privateKey) as JsonWebKey & Record<string, unknown>;
  privateJwk.kid = kid;
  await c.env.R2_KEYS.put("jwks.json", JSON.stringify(jwks));
  await c.env.R2_KEYS.put("signing-key.json", JSON.stringify(privateJwk));

  // Cache in KV
  await kvPut(c.env.KV_JWKS, KV_KEYS.jwks(), jwks, KV_TTL.JWKS);

  return c.json(jwks, 200, {
    "Cache-Control": "public, max-age=3600",
  });
});

export { certsRoute };
