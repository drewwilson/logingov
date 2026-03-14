/**
 * Token Endpoint — POST /api/openid_connect/token
 *
 * Exchanges an authorization code for tokens.
 * Supports private_key_jwt client authentication and PKCE verification.
 */
import { Hono } from "hono";
import { getDb } from "@logingov/shared/db";
import { eq, and, isNull } from "drizzle-orm";
import type { Env } from "@logingov/shared";
import { AppError, authCodes, uuidV7 } from "@logingov/shared";
import { validateClientAssertion } from "../lib/client-auth.js";
import { verifyCodeChallenge, validateCodeVerifier } from "../lib/pkce.js";
import { getPairwiseSub } from "../lib/pairwise.js";
import {
  signIdToken,
  issueAccessToken,
  computeTokenHash,
} from "../lib/token-signing.js";
import type { IdTokenClaims } from "../lib/token-signing.js";
import { enqueue } from "@logingov/infra";

const tokenRoute = new Hono<{ Bindings: Env }>();

tokenRoute.post("/api/openid_connect/token", async (c) => {
  const body = await c.req.parseBody();

  // ── Validate grant_type ──────────────────────────────────────
  const grantType = body["grant_type"] as string;
  if (grantType !== "authorization_code") {
    throw new AppError(
      "unsupported_grant_type",
      "Only authorization_code grant is supported",
      400
    );
  }

  // ── Validate client authentication (private_key_jwt) ─────────
  const clientAssertionType = body["client_assertion_type"] as string;
  if (
    clientAssertionType !==
    "urn:ietf:params:oauth:client-assertion-type:jwt-bearer"
  ) {
    throw new AppError(
      "invalid_request",
      "client_assertion_type must be urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
      400
    );
  }

  const clientAssertion = body["client_assertion"] as string;
  if (!clientAssertion) {
    throw new AppError("invalid_request", "client_assertion is required", 400);
  }

  const { clientId } = await validateClientAssertion(clientAssertion, c.env);

  // ── Validate authorization code ──────────────────────────────
  const code = body["code"] as string;
  if (!code) {
    throw new AppError("invalid_request", "code is required", 400);
  }

  const db = getDb(c.env);

  // Single-use enforcement: atomically claim the code first to prevent TOCTOU races
  const now = new Date().toISOString();

  // Atomically mark code as used (UPDATE WHERE usedAt IS NULL)
  const updateResult = await db
    .update(authCodes)
    .set({ usedAt: now })
    .where(and(eq(authCodes.code, code), isNull(authCodes.usedAt)));

  // If no rows were updated, the code doesn't exist, was already used, or was claimed by another request
  if (!updateResult.rowsAffected || updateResult.rowsAffected === 0) {
    throw new AppError("invalid_grant", "Authorization code not found or already used", 400);
  }

  // Fetch the auth code (now claimed by this request)
  const codeRows = await db
    .select()
    .from(authCodes)
    .where(eq(authCodes.code, code))
    .limit(1);

  const authCode = codeRows[0];

  // Check if expired
  if (new Date(authCode.expiresAt) < new Date()) {
    throw new AppError("invalid_grant", "Authorization code expired", 400);
  }

  // Verify the code belongs to this client
  if (authCode.spId !== clientId) {
    throw new AppError(
      "invalid_grant",
      "Authorization code was not issued to this client",
      400
    );
  }

  // ── Verify redirect_uri matches ──────────────────────────────
  const redirectUri = body["redirect_uri"] as string;
  if (!redirectUri || redirectUri !== authCode.redirectUri) {
    throw new AppError(
      "invalid_grant",
      "redirect_uri is required and must match",
      400
    );
  }

  // ── PKCE verification ────────────────────────────────────────
  if (authCode.codeChallenge && authCode.codeChallengeMethod) {
    const codeVerifier = body["code_verifier"] as string;
    if (!codeVerifier) {
      throw new AppError(
        "invalid_request",
        "code_verifier is required when code_challenge was provided",
        400
      );
    }
    if (!validateCodeVerifier(codeVerifier)) {
      throw new AppError(
        "invalid_request",
        "Invalid code_verifier format",
        400
      );
    }
    await verifyCodeChallenge(
      codeVerifier,
      authCode.codeChallenge,
      authCode.codeChallengeMethod
    );
  }

  // ── Compute pairwise subject identifier ──────────────────────
  const sub = await getPairwiseSub(authCode.userId, clientId, c.env);

  // ── Issue access token (stored in KV with TTL) ───────────────
  const scopes: string[] = JSON.parse(authCode.scopes);
  const accessToken = await issueAccessToken(
    c.env,
    authCode.userId,
    clientId,
    scopes
  );

  // ── Sign id_token ────────────────────────────────────────────
  const atHash = await computeTokenHash(accessToken);

  const idTokenClaims: IdTokenClaims = {
    sub,
    aud: clientId,
    acr: authCode.acr,
    ial: authCode.ial,
    aal: authCode.aal,
    at_hash: atHash,
  };

  if (authCode.nonce) {
    idTokenClaims.nonce = authCode.nonce;
  }

  const idToken = await signIdToken(idTokenClaims, c.env);

  // ── Audit log: token issued ──────────────────────────────────
  await enqueue(c.env.QUEUE_AUDIT, "audit:write", authCode.userId, {
    eventType: "authentication",
    ip: c.req.header("cf-connecting-ip") ?? "unknown",
    ial: idTokenClaims.ial ?? 1,
    aal: idTokenClaims.aal ?? 1,
    metadata: { spId: clientId, sub, grantType },
  });

  // ── Return token response ────────────────────────────────────
  return c.json({
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: 900, // 15 minutes
    id_token: idToken,
  });
});

export { tokenRoute };
