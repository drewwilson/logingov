/**
 * Auth Flow Orchestration — /api/auth-flow/complete-login, /api/auth-flow/issue-code
 *
 * After Better Auth authenticates the user, these routes check MFA requirements
 * and issue OIDC authorization codes with the correct IAL/AAL/ACR claims.
 */
import { Hono } from "hono";
import { getDb } from "@logingov/shared/db";
import { eq } from "drizzle-orm";
import type { Env } from "@logingov/shared";
import { AppError, authCodes, credentials, uuidV7 } from "@logingov/shared";
import { users } from "@logingov/shared/schema";
import { encrypt, importKey, computeBlindIndex } from "@logingov/shared/crypto";
import type { SessionState } from "@logingov/session-do";
import { createAuth } from "../auth.js";
import { user as betterAuthUser } from "../schema.js";

const AUTH_CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes

const authFlowRoute = new Hono<{ Bindings: Env }>();

/**
 * Fetch session state from a SessionDO instance.
 */
async function getSessionState(
  env: Env,
  sessionId: string
): Promise<SessionState> {
  const doId = env.SESSION_DO.idFromName(sessionId);
  const stub = env.SESSION_DO.get(doId);

  const res = await stub.fetch(
    new Request("https://session-do/get", { method: "GET" })
  );

  if (!res.ok) {
    const body = (await res.json()) as { error?: string };
    if (body.error === "session_expired") {
      throw new AppError("invalid_request", "Session has expired", 410);
    }
    throw new AppError("invalid_request", "Session not found", 404);
  }

  return (await res.json()) as SessionState;
}

/**
 * Determine the ACR string from IAL, AAL, and facial match state.
 */
function determineAcr(
  ial: 1 | 2,
  aal: 1 | 2,
  facialMatch?: "required" | "preferred"
): string {
  if (ial === 2 && facialMatch === "required") {
    return "urn:acr.login.gov:verified-facial-match-required";
  }
  if (ial === 2 && aal === 2) {
    return "urn:acr.login.gov:verified";
  }
  return "urn:acr.login.gov:auth-only";
}

/**
 * Ensure a record exists in the shared `users` table for this Better Auth user.
 * Better Auth manages its own `user` table; the OIDC userinfo endpoint reads
 * from the shared `users` table. This bridges the two on first login.
 */
async function ensureSharedUser(
  env: Env,
  userId: string,
  email: string
): Promise<void> {
  const db = getDb(env);
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (existing.length > 0) return;

  const cryptoKey = await importKey(env.ENCRYPTION_KEY);
  const encryptedEmail = await encrypt(email, cryptoKey);
  const emailBlindIdx = await computeBlindIndex(email, env.ENCRYPTION_KEY);
  const now = new Date().toISOString();

  await db.insert(users).values({
    id: userId,
    email: encryptedEmail,
    emailBlindIndex: emailBlindIdx,
    emailVerifiedAt: now,
    ial: 1,
    locale: "en",
    createdAt: now,
    updatedAt: now,
  });
}

// ── POST /api/auth-flow/complete-login ───────────────────────

authFlowRoute.post("/api/auth-flow/complete-login", async (c) => {
  const { sessionId, userId } = await c.req.json<{
    sessionId: string;
    userId: string;
  }>();

  if (!sessionId || !userId) {
    throw new AppError(
      "invalid_request",
      "sessionId and userId are required",
      400
    );
  }

  // Sync to shared users table (needed for userinfo endpoint)
  try {
    const db = getDb(c.env);
    const baUser = await db
      .select({ email: betterAuthUser.email })
      .from(betterAuthUser)
      .where(eq(betterAuthUser.id, userId))
      .limit(1);
    if (baUser.length > 0) {
      await ensureSharedUser(c.env, userId, baUser[0].email);
    }
  } catch (err) {
    console.warn("[complete-login POST] ensureSharedUser error:", err);
  }

  const session = await getSessionState(c.env, sessionId);

  // Check if MFA is required based on requested AAL
  if (session.requestedAal >= 2) {
    // Query available MFA methods for this user
    const db = getDb(c.env);
    const credentialRows = await db
      .select({ type: credentials.type })
      .from(credentials)
      .where(eq(credentials.userId, userId));

    // Collect unique MFA method types (exclude "password" — that's not MFA)
    const mfaTypes = [
      ...new Set(
        credentialRows
          .map((r) => r.type)
          .filter((t) => t !== "password")
      ),
    ];

    return c.json({
      requiresMfa: true,
      methods: mfaTypes,
      sessionId,
    });
  }

  // No MFA required — issue auth code directly
  const ial: 1 | 2 = session.achievedIal ?? session.requestedIal;
  const aal: 1 | 2 = 1; // No MFA performed
  const acr = determineAcr(ial, aal, session.facialMatch);

  const code = uuidV7();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + AUTH_CODE_TTL_MS);

  const db = getDb(c.env);
  await db.insert(authCodes).values({
    code,
    userId,
    spId: session.spId,
    redirectUri: session.redirectUri,
    scopes: JSON.stringify(session.scopes),
    codeChallenge: session.codeChallenge ?? null,
    codeChallengeMethod: session.codeChallengeMethod ?? null,
    nonce: session.nonce ?? null,
    ial,
    aal,
    acr,
    expiresAt: expiresAt.toISOString(),
    createdAt: now.toISOString(),
  });

  return c.json({
    requiresMfa: false,
    redirectUri: session.redirectUri,
    code,
    state: session.state,
  });
});

// ── GET /api/auth-flow/complete-login ─────────────────────────
// Used by social OAuth and the ID verification wizard's completeRedirect().
// Better Auth redirects here (HTTP 302) after the OAuth callback, so this
// must be a GET handler that issues an auth code and redirects to the SP.

authFlowRoute.get("/api/auth-flow/complete-login", async (c) => {
  const sessionId = c.req.query("session_id");
  if (!sessionId) {
    return c.redirect("/sign-in");
  }

  // The user is already authenticated — Better Auth set a session cookie
  // during the OAuth callback. Retrieve it to get the userId.
  let userId: string;
  try {
    const auth = createAuth(c.env);
    const betterAuthSession = await auth.api.getSession({
      headers: c.req.raw.headers,
    });
    if (!betterAuthSession?.user) {
      console.error("[complete-login GET] No Better Auth session found");
      return c.redirect(`/sign-in?session_id=${encodeURIComponent(sessionId)}`);
    }
    userId = betterAuthSession.user.id;

    // Sync to shared users table (needed for userinfo endpoint)
    try {
      await ensureSharedUser(c.env, userId, betterAuthSession.user.email);
    } catch (err) {
      console.warn("[complete-login GET] ensureSharedUser error:", err);
    }
  } catch (err) {
    console.error("[complete-login GET] getSession error:", err);
    return c.redirect(`/sign-in?session_id=${encodeURIComponent(sessionId)}`);
  }

  let session: SessionState;
  try {
    session = await getSessionState(c.env, sessionId);
  } catch (err) {
    console.error("[complete-login GET] getSessionState error:", err);
    return c.redirect("/sign-in");
  }

  // If MFA is required, redirect back to sign-in for the MFA step
  if (session.requestedAal >= 2) {
    return c.redirect(
      `/sign-in?session_id=${encodeURIComponent(sessionId)}&mfa=1`
    );
  }

  // No MFA required — issue auth code and redirect to SP
  const ial: 1 | 2 = session.achievedIal ?? session.requestedIal;
  const aal: 1 | 2 = 1; // No MFA performed
  const acr = determineAcr(ial, aal, session.facialMatch);

  const code = uuidV7();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + AUTH_CODE_TTL_MS);

  const db = getDb(c.env);
  await db.insert(authCodes).values({
    code,
    userId,
    spId: session.spId,
    redirectUri: session.redirectUri,
    scopes: JSON.stringify(session.scopes),
    codeChallenge: session.codeChallenge ?? null,
    codeChallengeMethod: session.codeChallengeMethod ?? null,
    nonce: session.nonce ?? null,
    ial,
    aal,
    acr,
    expiresAt: expiresAt.toISOString(),
    usedAt: null,
    createdAt: now.toISOString(),
  });

  const url = new URL(session.redirectUri);
  url.searchParams.set("code", code);
  if (session.state) url.searchParams.set("state", session.state);
  return c.redirect(url.toString());
});

// ── POST /api/auth-flow/issue-code ───────────────────────────

authFlowRoute.post("/api/auth-flow/issue-code", async (c) => {
  const { sessionId } = await c.req.json<{ sessionId: string }>();

  if (!sessionId) {
    throw new AppError("invalid_request", "sessionId is required", 400);
  }

  const session = await getSessionState(c.env, sessionId);

  // Verify MFA was completed if required
  if (session.requestedAal >= 2 && !session.mfaVerified) {
    throw new AppError(
      "invalid_request",
      "MFA verification is required but has not been completed",
      403
    );
  }

  if (!session.userId) {
    throw new AppError(
      "invalid_request",
      "Session has no authenticated user",
      400
    );
  }

  const ial: 1 | 2 = session.achievedIal ?? session.requestedIal;
  const aal: 1 | 2 = session.achievedAal ?? session.requestedAal;
  const acr = determineAcr(ial, aal, session.facialMatch);

  const code = uuidV7();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + AUTH_CODE_TTL_MS);

  const db = getDb(c.env);
  await db.insert(authCodes).values({
    code,
    userId: session.userId,
    spId: session.spId,
    redirectUri: session.redirectUri,
    scopes: JSON.stringify(session.scopes),
    codeChallenge: session.codeChallenge ?? null,
    codeChallengeMethod: session.codeChallengeMethod ?? null,
    nonce: session.nonce ?? null,
    ial,
    aal,
    acr,
    expiresAt: expiresAt.toISOString(),
    createdAt: now.toISOString(),
  });

  return c.json({
    redirectUri: session.redirectUri,
    code,
    state: session.state,
  });
});

// ── POST /api/auth-flow/mock-verify ──────────────────────────
// Mock identity proofing for development — bypasses Persona API,
// stores dummy PII, and upgrades user to IAL2.

const MOCK_PII = {
  firstName: "Jane",
  lastName: "Doe",
  birthdate: "1985-01-15",
  ssn: "900-00-1234",
  addressStreet: "123 Main St",
  addressCity: "Washington",
  addressState: "DC",
  addressPostalCode: "20001",
  addressCountryCode: "US",
};

authFlowRoute.post("/api/auth-flow/mock-verify", async (c) => {
  // TODO: gate this behind ENVIRONMENT !== "production" once Persona is live

  const { sessionId, userId } = await c.req.json<{
    sessionId?: string;
    userId: string;
  }>();

  if (!userId) {
    throw new AppError(
      "invalid_request",
      "userId is required",
      400
    );
  }

  const now = new Date().toISOString();

  // Try to encrypt and store dummy PII — non-fatal if ENCRYPTION_KEY
  // is missing or the user doesn't exist in the shared users table yet.
  try {
    const cryptoKey = await importKey(c.env.ENCRYPTION_KEY);

    const encryptedSsn = await encrypt(MOCK_PII.ssn, cryptoKey);
    const encryptedBirthdate = await encrypt(MOCK_PII.birthdate, cryptoKey);
    const encryptedAddress = await encrypt(
      JSON.stringify({
        street: MOCK_PII.addressStreet,
        city: MOCK_PII.addressCity,
        state: MOCK_PII.addressState,
        postalCode: MOCK_PII.addressPostalCode,
        countryCode: MOCK_PII.addressCountryCode,
      }),
      cryptoKey
    );

    const db = getDb(c.env);
    await db
      .update(users)
      .set({
        ial: 2,
        ssn: encryptedSsn,
        birthdate: encryptedBirthdate,
        address: encryptedAddress,
        verifiedAt: now,
        updatedAt: now,
      })
      .where(eq(users.id, userId));
  } catch (err) {
    // In dev, PII storage may fail (missing ENCRYPTION_KEY, no shared users row, etc.)
    console.warn("[mock-verify] PII storage skipped:", err instanceof Error ? err.message : err);
  }

  // Update SessionDO with achievedIal (skip if no session, e.g. direct testing)
  if (sessionId) {
    const doId = c.env.SESSION_DO.idFromName(sessionId);
    const stub = c.env.SESSION_DO.get(doId);
    await stub.fetch(
      new Request("https://session-do/update", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ achievedIal: 2 }),
      })
    );
  }

  return c.json({ ok: true, ial: 2, verifiedAt: now });
});

export { authFlowRoute };
