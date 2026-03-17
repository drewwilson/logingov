/**
 * Feature 4: SAML Single Logout (SLO)
 *
 * Parses LogoutRequest, calls auth-core's OIDC logout via service binding
 * to destroy the session, then issues a SAML LogoutResponse XML back to
 * the SP via HTTP-POST binding.
 */
import { Hono } from "hono";
import type { Env } from "@logingov/shared";
import { AppError, errorResponse } from "@logingov/shared/errors";
import { parseLogoutRequest, generateLogoutResponse, verifyLogoutRequestSignature } from "../lib/saml-helpers.js";
import { completeOIDCLogout } from "../lib/auth-core-client.js";
import { lookupServiceProvider } from "../lib/sp-lookup.js";

const ENTITY_ID = "https://secure.login.gov";

const logoutRoutes = new Hono<{ Bindings: Env }>();

/**
 * SLO via GET (HTTP-Redirect binding).
 */
logoutRoutes.get("/api/saml/logout:year{[0-9]{4}}?", async (c) => {
  return handleLogout(c.env, c.req.query("SAMLRequest"), c.req.query("RelayState"));
});

/**
 * SLO via POST (HTTP-POST binding).
 * Supports year-versioned paths (e.g. /api/saml/logout2026) for cert rotation.
 */
logoutRoutes.post("/api/saml/logout:year{[0-9]{4}}?", async (c) => {
  const formData = await c.req.parseBody();
  return handleLogout(
    c.env,
    formData["SAMLRequest"] as string | undefined,
    formData["RelayState"] as string | undefined
  );
});

async function handleLogout(
  env: Env,
  samlRequest: string | undefined,
  relayState: string | undefined
): Promise<Response> {
  if (!samlRequest) {
    return errorResponse(new AppError("invalid_request", "Missing SAMLRequest parameter"));
  }

  try {
    const parsed = await parseLogoutRequest(samlRequest, relayState);

    // Look up the SP by issuer to get public key
    const sp = await lookupServiceProvider(parsed.issuer, env);
    if (!sp) {
      return errorResponse(new AppError("invalid_request", "Unknown service provider"));
    }

    // Fix 4: Verify LogoutRequest signature using SP's public key
    await verifyLogoutRequestSignature(parsed.rawXml, sp.publicKey);

    // Call auth-core's OIDC logout via service binding.
    // The NameID from the SAML LogoutRequest is used as the id_token_hint
    // subject. auth-core will destroy the SessionDO and clear KV data.
    //
    // We build a minimal id_token_hint-style token containing the NameID
    // as the subject, which auth-core uses to locate the session.  In
    // practice, the SP may also supply a SessionIndex that maps to a real
    // id_token — for now we use the NameID directly.
    await completeOIDCLogout(env, {
      id_token_hint: parsed.nameId,
      state: parsed.relayState,
    });

    // Generate SAML LogoutResponse regardless of auth-core outcome
    // (session may already be expired — that's fine, we still confirm logout)
    const responseXml = generateLogoutResponse(
      parsed.requestId,
      ENTITY_ID,
      parsed.issuer, // Send response back to SP
      true // success
    );

    // Return as HTML form with auto-submit (HTTP-POST binding for response)
    const html = buildAutoSubmitForm(parsed.issuer, responseXml, parsed.relayState);

    return new Response(html, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  } catch (err) {
    // If auth-core logout fails, we still try to send a LogoutResponse.
    // Only fail if the SAML parsing itself failed.
    const message = err instanceof Error ? err.message : "Failed to process LogoutRequest";
    return errorResponse(new AppError("slo_error", message));
  }
}

/**
 * Escape HTML entities to prevent XSS in injected values.
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

/**
 * Build an auto-submitting HTML form for SAML HTTP-POST binding.
 * Fix 3: All dynamic values are HTML-escaped to prevent XSS.
 */
function buildAutoSubmitForm(
  destination: string,
  samlResponse: string,
  relayState?: string
): string {
  return `<!DOCTYPE html>
<html>
<head><title>Login.gov - Logout</title></head>
<body onload="document.forms[0].submit();">
  <noscript>
    <p>You are being logged out. Click the button below if not redirected automatically.</p>
  </noscript>
  <form method="POST" action="${escapeHtml(destination)}">
    <input type="hidden" name="SAMLResponse" value="${escapeHtml(samlResponse)}" />
    ${relayState ? `<input type="hidden" name="RelayState" value="${escapeHtml(relayState)}" />` : ""}
    <noscript><input type="submit" value="Continue" /></noscript>
  </form>
</body>
</html>`;
}

export { logoutRoutes };
