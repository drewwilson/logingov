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
import { AppError, authCodes, users, uuidV7 } from "@logingov/shared";
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

  // ── Client authentication ─────────────────────────────────────
  // Two modes: private_key_jwt (web apps) or PKCE-only (native mobile apps).
  // If client_assertion is present, use private_key_jwt.
  // Otherwise, the client authenticates via PKCE code_verifier alone.
  const clientAssertion = body["client_assertion"] as string | undefined;
  const clientAssertionType = body["client_assertion_type"] as string | undefined;
  const isPkceOnly = !clientAssertion;

  let clientId: string | undefined;

  if (!isPkceOnly) {
    // ── private_key_jwt authentication ──────────────────────────
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

    const result = await validateClientAssertion(clientAssertion, c.env);
    clientId = result.clientId;
  }

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

  // For PKCE-only flow, derive clientId from the auth code
  if (isPkceOnly) {
    clientId = authCode.spId;
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
  // Required for PKCE-only clients; optional (but enforced if present) for private_key_jwt clients.
  const codeVerifier = body["code_verifier"] as string | undefined;

  if (isPkceOnly) {
    // PKCE-only flow: code_verifier is mandatory and code_challenge must have been set at authorize time
    if (!authCode.codeChallenge || !authCode.codeChallengeMethod) {
      throw new AppError(
        "invalid_grant",
        "PKCE code_challenge was not provided at authorization time; cannot use PKCE-only authentication",
        400
      );
    }
    if (!codeVerifier) {
      throw new AppError(
        "invalid_request",
        "code_verifier is required for PKCE authentication",
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
  } else if (authCode.codeChallenge && authCode.codeChallengeMethod) {
    // private_key_jwt + PKCE: code_verifier required when code_challenge was provided
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

  // clientId is guaranteed set by this point (either private_key_jwt or PKCE-only path)
  const resolvedClientId = clientId!;

  // ── Fetch user for legacy UUID (migrated user support) ────────
  const userRows = await db
    .select({ legacyUuid: users.legacyUuid })
    .from(users)
    .where(eq(users.id, authCode.userId))
    .limit(1);

  // ── Compute pairwise subject identifier ──────────────────────
  const sub = await getPairwiseSub(
    authCode.userId,
    resolvedClientId,
    c.env,
    userRows[0]?.legacyUuid
  );

  // ── Issue access token (stored in KV with TTL) ───────────────
  const scopes: string[] = JSON.parse(authCode.scopes);
  const accessToken = await issueAccessToken(
    c.env,
    authCode.userId,
    resolvedClientId,
    scopes
  );

  // ── Sign id_token ────────────────────────────────────────────
  const atHash = await computeTokenHash(accessToken);

  const idTokenClaims: IdTokenClaims = {
    sub,
    aud: resolvedClientId,
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
    metadata: { spId: resolvedClientId, sub, grantType },
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
