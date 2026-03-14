/**
 * AAL Evaluator Middleware
 *
 * Enforces Authentication Assurance Level (AAL) requirements:
 * - AAL2: requires mfaVerified=true on the session DO
 * - Phishing-resistant: only WebAuthn or PIV/CAC accepted (rejects TOTP/SMS)
 * - HSPD-12 / PIV/CAC: requires x509Presented=true + trusted federal PKI issuer
 */
import type { Context, Next } from "hono";
import type { Env } from "@logingov/shared";
import { AppError, UnauthorizedError, ForbiddenError, errorResponse } from "@logingov/shared";
import type { SessionState } from "@logingov/session-do";

// ── Known Federal PKI Issuers ────────────────────────────────
// Trusted Certificate Authorities for HSPD-12 PIV/CAC authentication.
const TRUSTED_FEDERAL_PKI_ISSUERS = [
  "CN=Federal Common Policy CA G2, OU=FPKI, O=U.S. Government, C=US",
  "CN=Federal Bridge CA G4, OU=FPKI, O=U.S. Government, C=US",
  "CN=DoD Root CA 3, OU=PKI, OU=DoD, O=U.S. Government, C=US",
  "CN=DoD Root CA 4, OU=PKI, OU=DoD, O=U.S. Government, C=US",
  "CN=DoD Root CA 5, OU=PKI, OU=DoD, O=U.S. Government, C=US",
  "CN=DoD Root CA 6, OU=PKI, OU=DoD, O=U.S. Government, C=US",
  "CN=US Treasury Root CA, OU=Certification Authorities, OU=Department of the Treasury, O=U.S. Government, C=US",
  "CN=Entrust Federal SSP CA, OU=Certification Authorities, O=Entrust, C=US",
  "CN=DigiCert Federal SSP Intermediate CA - G5, O=DigiCert\\, Inc., C=US",
  "CN=Verizon SSP CA A2, OU=SSP, O=Verizon, C=US",
] as const;

// Phishing-resistant MFA methods (hardware-bound or certificate-based).
const PHISHING_RESISTANT_METHODS = new Set(["webauthn", "piv"]);

// ── Session DO helper ────────────────────────────────────────

export async function getSessionFromDO(
  env: Env,
  sessionId: string
): Promise<SessionState | null> {
  const stub = env.SESSION_DO.get(env.SESSION_DO.idFromString(sessionId));
  const res = await stub.fetch(new Request("https://do/get"));
  if (!res.ok) return null;
  return (await res.json()) as SessionState;
}

export async function updateSessionDO(
  env: Env,
  sessionId: string,
  updates: Partial<SessionState>
): Promise<boolean> {
  const stub = env.SESSION_DO.get(env.SESSION_DO.idFromString(sessionId));
  const res = await stub.fetch(
    new Request("https://do/update", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    })
  );
  return res.ok;
}

// ── Middleware: Require AAL2 ────────────────────────────────

/**
 * Middleware that enforces AAL2 on the current session.
 * Reads session_id from the X-Session-Id header.
 * If the session requires AAL2 and MFA is not verified, returns 403 with
 * a redirect hint to the MFA challenge endpoint.
 */
export function requireAAL2() {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    const sessionId = c.req.header("X-Session-Id");
    if (!sessionId) {
      return errorResponse(new UnauthorizedError("Missing session"));
    }

    const session = await getSessionFromDO(c.env, sessionId);
    if (!session) {
      return errorResponse(new UnauthorizedError("Invalid or expired session"));
    }

    // Store session on context for downstream handlers.
    c.set("session" as never, session);
    c.set("sessionId" as never, sessionId);

    // If AAL2 is requested and MFA is not yet verified, check remembered device.
    if (session.requestedAal === 2 && !session.mfaVerified) {
      if (session.rememberedDevice) {
        // If the SP requires phishing-resistant MFA, remembered device does NOT
        // satisfy the requirement — the user must re-authenticate with a
        // phishing-resistant method (WebAuthn or PIV/CAC).
        if (session.phishingResistant === true) {
          return c.json(
            {
              error: "phishing_resistant_mfa_required",
              message: "Phishing-resistant MFA is required. Remembered device cannot satisfy this requirement.",
              allowed_methods: ["webauthn", "piv"],
            },
            403
          );
        }

        // Device was previously remembered — skip MFA challenge.
        // Update session to reflect MFA is satisfied via remembered device.
        await updateSessionDO(c.env, sessionId, { mfaVerified: true, mfaMethod: "remembered" });
        session.mfaVerified = true;
        session.mfaMethod = "remembered";
      } else {
        return c.json(
          {
            error: "mfa_required",
            message: "Multi-factor authentication is required",
            redirect: "/mfa/challenge",
          },
          403
        );
      }
    }

    await next();
  };
}

// ── Middleware: Require Phishing-Resistant MFA ───────────────

/**
 * When ?phishing_resistant=true is requested (or session.phishingResistant),
 * only WebAuthn or PIV/CAC satisfy the requirement. TOTP and SMS sessions
 * are rejected.
 */
export function requirePhishingResistant() {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    const sessionId = c.req.header("X-Session-Id");
    if (!sessionId) {
      return errorResponse(new UnauthorizedError("Missing session"));
    }

    const session = await getSessionFromDO(c.env, sessionId);
    if (!session) {
      return errorResponse(new UnauthorizedError("Invalid or expired session"));
    }

    c.set("session" as never, session);
    c.set("sessionId" as never, sessionId);

    const phishingRequired =
      session.phishingResistant === true ||
      c.req.query("phishing_resistant") === "true";

    if (phishingRequired) {
      // MFA must be verified
      if (!session.mfaVerified) {
        return c.json(
          {
            error: "phishing_resistant_mfa_required",
            message: "Phishing-resistant MFA is required (WebAuthn or PIV/CAC)",
            allowed_methods: ["webauthn", "piv"],
          },
          403
        );
      }

      // MFA method must be phishing-resistant
      if (!session.mfaMethod || !PHISHING_RESISTANT_METHODS.has(session.mfaMethod)) {
        return c.json(
          {
            error: "phishing_resistant_mfa_required",
            message: `MFA method '${session.mfaMethod}' is not phishing-resistant. Use WebAuthn or PIV/CAC.`,
            allowed_methods: ["webauthn", "piv"],
          },
          403
        );
      }
    }

    await next();
  };
}

// ── Middleware: Require HSPD-12 / PIV/CAC ────────────────────

/**
 * Validates that the session was authenticated via a PIV/CAC x509 certificate
 * from a trusted Federal PKI issuer (HSPD-12 compliance).
 */
export function requireHSPD12() {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    const sessionId = c.req.header("X-Session-Id");
    if (!sessionId) {
      return errorResponse(new UnauthorizedError("Missing session"));
    }

    const session = await getSessionFromDO(c.env, sessionId);
    if (!session) {
      return errorResponse(new UnauthorizedError("Invalid or expired session"));
    }

    c.set("session" as never, session);
    c.set("sessionId" as never, sessionId);

    const hspd12Required = session.hspd12 === true;

    if (hspd12Required) {
      // Must have x509 certificate presented
      if (!session.x509Presented) {
        return c.json(
          {
            error: "hspd12_required",
            message: "HSPD-12 PIV/CAC certificate authentication is required",
          },
          403
        );
      }

      // Validate issuer against known federal PKI issuers
      if (!session.x509Issuer || !isTrustedFederalIssuer(session.x509Issuer)) {
        return c.json(
          {
            error: "hspd12_invalid_issuer",
            message: "x509 certificate issuer is not a trusted Federal PKI authority",
            issuer: session.x509Issuer ?? "unknown",
          },
          403
        );
      }
    }

    await next();
  };
}

/**
 * Check if an x509 issuer DN matches a known Federal PKI issuer.
 * Performs exact match after whitespace normalization to prevent substring bypass.
 */
export function isTrustedFederalIssuer(issuer: string): boolean {
  // Normalize: trim, collapse internal whitespace around delimiters
  const normalized = issuer.trim().replace(/\s*,\s*/g, ", ").replace(/\s*=\s*/g, "=");
  return TRUSTED_FEDERAL_PKI_ISSUERS.some((trusted) => {
    const normalizedTrusted = trusted.trim().replace(/\s*,\s*/g, ", ").replace(/\s*=\s*/g, "=");
    return normalized.toLowerCase() === normalizedTrusted.toLowerCase();
  });
}

// ── Middleware: Load Session (no enforcement) ────────────────

/**
 * Load the session from DO and attach to context without enforcing any AAL.
 * Useful for MFA challenge endpoints themselves.
 */
export function loadSession() {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    const sessionId = c.req.header("X-Session-Id");
    if (!sessionId) {
      return errorResponse(new UnauthorizedError("Missing session"));
    }

    const session = await getSessionFromDO(c.env, sessionId);
    if (!session) {
      return errorResponse(new UnauthorizedError("Invalid or expired session"));
    }

    c.set("session" as never, session);
    c.set("sessionId" as never, sessionId);

    await next();
  };
}
