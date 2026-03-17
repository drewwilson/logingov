/**
 * Tests for GET /api/openid_connect/certs (JWKS endpoint)
 *
 * The certs endpoint serves the JSON Web Key Set used to verify
 * id_tokens. It checks KV cache first, falls back to R2, and
 * generates a key pair on-the-fly for local dev if neither exists.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { AppError, errorResponse } from "@logingov/shared";
import { certsRoute } from "@logingov/auth-core/routes/certs";
import { createMockEnv } from "./helpers.js";

function createTestApp(route: any) {
  const app = new Hono<{ Bindings: any }>();
  app.onError((err, c) => {
    if (err instanceof AppError) return errorResponse(err);
    return c.json({ error: "server_error", message: err.message }, 500);
  });
  app.route("/", route);
  return app;
}

const TEST_JWKS = {
  keys: [
    {
      kty: "RSA",
      kid: "test-kid-001",
      use: "sig",
      alg: "RS256",
      n: "0vx7agoebGcQSuuPiLJXZptN9nndrQmbXEps2aiAFbWhM78LhWx4cbbfAAtVT86zwu1RK7aPFFxuhDR1L6tSoc_BJECPebWKRXjBZCiFV4n3oknjhMstn64tZ_2W-5JsGY4Hc5n9yBXArwl93lqt7_RN5w6Cf0h4QyQ5v-65YGjQR0_FDW2QvzqY368QQMicAtaSqzs8KJZgnYb9c7d0zgdAZHzu6qMQvRL5hajrn1n91CbOpbISD08qNLyrdkt-bFTWhAI4vMQFh6WeZu0fM4lFd2NcRwr3XPksINHaQ-G_xBniIqbw0Ls1jF44-csFCur-kEgU8awapJzKnqDKgw",
      e: "AQAB",
    },
  ],
};

describe("GET /api/openid_connect/certs", () => {
  let env: ReturnType<typeof createMockEnv>;
  let app: ReturnType<typeof createTestApp>;

  beforeEach(() => {
    env = createMockEnv();
    app = createTestApp(certsRoute);
  });

  it("returns JWKS from KV cache", async () => {
    await env.KV_JWKS.put("jwks:current", JSON.stringify(TEST_JWKS));

    const res = await app.request(
      "https://secure.login.gov/api/openid_connect/certs",
      {},
      env
    );

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.keys).toHaveLength(1);
    expect(body.keys[0].kid).toBe("test-kid-001");
    expect(body.keys[0].kty).toBe("RSA");
  });

  it("falls back to R2 when KV is empty", async () => {
    // Seed R2 but not KV
    await env.R2_KEYS.put("jwks.json", JSON.stringify(TEST_JWKS));

    const res = await app.request(
      "https://secure.login.gov/api/openid_connect/certs",
      {},
      env
    );

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.keys).toHaveLength(1);
    expect(body.keys[0].kid).toBe("test-kid-001");

    // Verify it was cached back into KV
    const cached = await env.KV_JWKS.get("jwks:current");
    expect(cached).not.toBeNull();
    const cachedJwks = JSON.parse(cached!);
    expect(cachedJwks.keys[0].kid).toBe("test-kid-001");
  });

  it("generates key pair when both KV and R2 are empty (local dev)", async () => {
    const res = await app.request(
      "https://secure.login.gov/api/openid_connect/certs",
      {},
      env
    );

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.keys).toHaveLength(1);

    const key = body.keys[0];
    expect(key.kty).toBe("RSA");
    expect(key.use).toBe("sig");
    expect(key.alg).toBe("RS256");
    expect(key.kid).toBeDefined();
    expect(key.n).toBeDefined();
    expect(key.e).toBe("AQAB");

    // Verify the generated key was stored in R2
    const r2Jwks = await env.R2_KEYS.get("jwks.json");
    expect(r2Jwks).not.toBeNull();
    const r2SigningKey = await env.R2_KEYS.get("signing-key.json");
    expect(r2SigningKey).not.toBeNull();

    // Verify the generated key was cached in KV
    const cached = await env.KV_JWKS.get("jwks:current");
    expect(cached).not.toBeNull();
  });

  it("includes Cache-Control header in response", async () => {
    await env.KV_JWKS.put("jwks:current", JSON.stringify(TEST_JWKS));

    const res = await app.request(
      "https://secure.login.gov/api/openid_connect/certs",
      {},
      env
    );

    expect(res.headers.get("Cache-Control")).toBe("public, max-age=3600");
  });

  it("returns valid JWKS format with keys array", async () => {
    await env.KV_JWKS.put("jwks:current", JSON.stringify(TEST_JWKS));

    const res = await app.request(
      "https://secure.login.gov/api/openid_connect/certs",
      {},
      env
    );

    const body = await res.json() as any;
    expect(body).toHaveProperty("keys");
    expect(Array.isArray(body.keys)).toBe(true);
  });

  it("each key has required JWK fields (kty, kid, use, alg)", async () => {
    // Use generated key to validate all fields are set properly
    const res = await app.request(
      "https://secure.login.gov/api/openid_connect/certs",
      {},
      env
    );

    const body = await res.json() as any;
    for (const key of body.keys) {
      expect(key).toHaveProperty("kty");
      expect(key).toHaveProperty("kid");
      expect(key).toHaveProperty("use");
      expect(key).toHaveProperty("alg");
      expect(key.kty).toBe("RSA");
      expect(key.use).toBe("sig");
      expect(key.alg).toBe("RS256");
      expect(typeof key.kid).toBe("string");
    }
  });
});
