/**
 * Userinfo Endpoint — GET /api/openid_connect/userinfo
 *
 * Validates a bearer access token and returns user claims
 * scoped to the SP's requested scopes.
 */
import { Hono } from "hono";
import { getDb } from "@logingov/shared/db";
import { eq } from "drizzle-orm";
import type { Env } from "@logingov/shared";
import { AppError, users } from "@logingov/shared";
import type { User } from "@logingov/shared";
import { validateAccessToken } from "../lib/token-signing.js";
import { getPairwiseSub } from "../lib/pairwise.js";
import { buildUserClaims } from "../lib/claims.js";

const userinfoRoute = new Hono<{ Bindings: Env }>();

userinfoRoute.get("/api/openid_connect/userinfo", async (c) => {
  // ── Extract bearer token ─────────────────────────────────────
  const authHeader = c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new AppError("invalid_token", "Bearer token required", 401);
  }

  const token = authHeader.slice(7);
  if (!token) {
    throw new AppError("invalid_token", "Bearer token is empty", 401);
  }

  // ── Validate access token from KV ────────────────────────────
  const tokenData = await validateAccessToken(c.env, token);
  if (!tokenData) {
    throw new AppError(
      "invalid_token",
      "Access token is invalid or expired",
      401
    );
  }

  // ── Fetch user ─────────────────────────────────────────────
  const db = getDb(c.env);
  const userRows = await db
    .select()
    .from(users)
    .where(eq(users.id, tokenData.userId))
    .limit(1);

  if (userRows.length === 0) {
    throw new AppError("invalid_token", "User not found", 401);
  }

  const user = userRows[0] as User;

  // Check if account is locked
  if (user.lockedAt) {
    throw new AppError("invalid_token", "Account is locked", 403);
  }

  // ── Compute pairwise sub ─────────────────────────────────────
  const sub = await getPairwiseSub(
    tokenData.userId,
    tokenData.spId,
    c.env
  );

  // ── Build claims scoped to requested scopes ──────────────────
  const claims = await buildUserClaims(
    user,
    sub,
    tokenData.scopes,
    c.env
  );

  return c.json(claims);
});

export { userinfoRoute };
