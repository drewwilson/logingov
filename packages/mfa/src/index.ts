/**
 * @logingov/mfa Worker — Multi-Factor Authentication
 *
 * Provides MFA challenge and verification endpoints:
 *   /mfa/totp/*          — TOTP authenticator app (setup + verify)
 *   /mfa/sms/*           — SMS/phone OTP (send + verify)
 *   /mfa/webauthn/*      — WebAuthn/passkeys (register + authenticate)
 *   /mfa/backup-codes/*  — Backup codes (generate + verify + count)
 *   /mfa/challenge       — MFA method selection for the current session
 *   /mfa/status          — Current MFA status for a session
 *
 * Middleware:
 *   - AAL evaluator: enforces AAL2, phishing-resistant, and HSPD-12 requirements
 *   - Rate limiter: KV-based counter with DB lockout after 5 failed attempts
 */
import { Hono } from "hono";
import type { Env } from "@logingov/shared";
import { AppError, errorResponse } from "@logingov/shared";
import { tracing, rateLimiter } from "@logingov/infra";
import { credentials } from "@logingov/shared";
import { eq } from "drizzle-orm";
import { getDb } from "@logingov/shared/db";

// Route modules
import { totp } from "./routes/totp.js";
import { smsOtp } from "./routes/sms-otp.js";
import { webauthn } from "./routes/webauthn.js";
import { backupCodes } from "./routes/backup-codes.js";

// Middleware
import {
  loadSession,
  getSessionFromDO,
  requireAAL2,
  requirePhishingResistant,
  requireHSPD12,
} from "./middleware/aal-evaluator.js";

const app = new Hono<{ Bindings: Env }>();

// ── Middleware ───────────────────────────────────────────────
app.use("*", tracing({ serviceName: "mfa" }));
app.use("/mfa/*", rateLimiter({ limits: { _default: { maxRequests: 10, windowSeconds: 60 } } }));

// ── Global Error Handler ─────────────────────────────────────

app.onError((err, c) => {
  if (err instanceof AppError) {
    return errorResponse(err);
  }
  console.error("Unhandled MFA error:", err);
  return c.json({ error: "internal_error", message: "An unexpected error occurred" }, 500);
});

// ── Health Check ─────────────────────────────────────────────

app.get("/health", (c) => c.json({ ok: true, service: "mfa" }));

// ── MFA Method Routes ────────────────────────────────────────

app.route("/mfa/totp", totp);
app.route("/mfa/sms", smsOtp);
app.route("/mfa/webauthn", webauthn);
app.route("/mfa/backup-codes", backupCodes);

// ── MFA Challenge Selection ──────────────────────────────────

/**
 * GET /mfa/challenge
 * Returns the available MFA methods for the current user and session requirements.
 */
app.get("/mfa/challenge", loadSession(), async (c) => {
  const userId = c.req.header("X-User-Id");
  if (!userId) return c.json({ error: "missing_user_id" }, 400);

  const session = c.get("session" as never) as Record<string, unknown>;

  // Look up which MFA methods the user has configured
  const db = getDb(c.env);
  const userCreds = await db
    .select({ type: credentials.type })
    .from(credentials)
    .where(eq(credentials.userId, userId));

  const configuredMethods = [...new Set(userCreds.map((cred) => cred.type))].filter(
    (type) => type !== "password"
  );

  // Determine which methods satisfy the session's requirements
  const phishingResistant = session.phishingResistant === true;
  const hspd12 = session.hspd12 === true;

  let allowedMethods: string[];
  if (hspd12) {
    allowedMethods = ["piv"];
  } else if (phishingResistant) {
    allowedMethods = configuredMethods.filter((m) => m === "webauthn");
    // PIV is always allowed for phishing-resistant
    allowedMethods.push("piv");
  } else {
    allowedMethods = configuredMethods;
  }

  return c.json({
    configured_methods: configuredMethods,
    allowed_methods: allowedMethods,
    phishing_resistant_required: phishingResistant,
    hspd12_required: hspd12,
    mfa_verified: session.mfaVerified ?? false,
    mfa_method: session.mfaMethod ?? null,
  });
});

// ── MFA Status ───────────────────────────────────────────────

/**
 * GET /mfa/status
 * Returns the current MFA verification state of the session.
 */
app.get("/mfa/status", async (c) => {
  const sessionId = c.req.header("X-Session-Id");
  if (!sessionId) return c.json({ error: "missing_session_id" }, 400);

  const session = await getSessionFromDO(c.env, sessionId);
  if (!session) return c.json({ error: "session_not_found" }, 404);

  return c.json({
    mfa_verified: session.mfaVerified,
    mfa_method: session.mfaMethod ?? null,
    achieved_aal: session.achievedAal ?? 1,
    requested_aal: session.requestedAal,
    phishing_resistant: session.phishingResistant ?? false,
    hspd12: session.hspd12 ?? false,
    x509_presented: session.x509Presented ?? false,
  });
});

// ── Export middleware for use by other Workers ────────────────

export {
  requireAAL2,
  requirePhishingResistant,
  requireHSPD12,
  loadSession,
  getSessionFromDO,
  updateSessionDO,
} from "./middleware/aal-evaluator.js";

export {
  checkMfaRateLimit,
  recordFailedAttempt,
  clearRateLimit,
} from "./middleware/rate-limiter.js";

export default app;
