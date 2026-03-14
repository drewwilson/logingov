/**
 * Feature 1: SAML 2.0 SSO — /api/saml/auth
 * Feature 3: Annual cert rotation — /api/saml/auth{year}
 *
 * Parses SAML AuthnRequest, translates to internal OIDC authorize parameters,
 * and calls auth-core via the AUTH_CORE service binding.  The redirect from
 * auth-core (→ login UI) is forwarded back to the user-agent.
 *
 * Year-versioned routes support annual SAML certificate rotation.
 * Signing certs are stored in Workers Secrets keyed by year.
 */
import { Hono } from "hono";
import type { Env } from "@logingov/shared";
import { AppError, errorResponse } from "@logingov/shared/errors";
import { parseAuthnRequest, translateToOIDC, verifyAuthnRequestSignature } from "../lib/saml-helpers.js";
import { initiateOIDCAuthorize } from "../lib/auth-core-client.js";
import { lookupServiceProvider } from "../lib/sp-lookup.js";

const ISSUER = "https://secure.login.gov";
const AUTHORIZE_ENDPOINT = `${ISSUER}/openid_connect/authorize`;

const authRoutes = new Hono<{ Bindings: Env }>();

/**
 * Handle SAML AuthnRequest via GET (HTTP-Redirect binding).
 */
authRoutes.get("/api/saml/auth:year{[0-9]{4}}?", async (c) => {
  try {
    const samlRequest = c.req.query("SAMLRequest");
    const relayState = c.req.query("RelayState");

    if (!samlRequest) {
      return errorResponse(new AppError("invalid_request", "Missing SAMLRequest parameter"));
    }

    const parsed = await parseAuthnRequest(samlRequest, relayState);

    // Look up the SP by issuer to get public key and registered redirect URIs
    const sp = await lookupServiceProvider(parsed.issuer, c.env);
    if (!sp) {
      return errorResponse(new AppError("invalid_request", "Unknown service provider"));
    }

    // Fix 1: Verify AuthnRequest signature using SP's public key
    await verifyAuthnRequestSignature(parsed.rawXml, sp.publicKey);

    // Fix 2: Validate that the ACS URL is in the SP's registered redirect URIs
    if (!sp.redirectUris.includes(parsed.acsUrl)) {
      return errorResponse(
        new AppError("invalid_request", "AssertionConsumerServiceURL not registered for this SP")
      );
    }

    const { params } = translateToOIDC(parsed, AUTHORIZE_ENDPOINT);

    // Call auth-core via service binding — returns a redirect Response
    const authCoreResponse = await initiateOIDCAuthorize(c.env, params);
    return authCoreResponse;
  } catch (err) {
    if (err instanceof AppError) {
      return errorResponse(err);
    }
    const message = err instanceof Error ? err.message : "Failed to parse AuthnRequest";
    return errorResponse(new AppError("saml_error", message));
  }
});

/**
 * Handle SAML AuthnRequest via POST (HTTP-POST binding).
 */
authRoutes.post("/api/saml/auth:year{[0-9]{4}}?", async (c) => {
  try {
    const formData = await c.req.parseBody();
    const samlRequest = formData["SAMLRequest"] as string | undefined;
    const relayState = formData["RelayState"] as string | undefined;

    if (!samlRequest) {
      return errorResponse(new AppError("invalid_request", "Missing SAMLRequest in POST body"));
    }

    const parsed = await parseAuthnRequest(samlRequest, relayState);

    // Look up the SP by issuer to get public key and registered redirect URIs
    const sp = await lookupServiceProvider(parsed.issuer, c.env);
    if (!sp) {
      return errorResponse(new AppError("invalid_request", "Unknown service provider"));
    }

    // Fix 1: Verify AuthnRequest signature using SP's public key
    await verifyAuthnRequestSignature(parsed.rawXml, sp.publicKey);

    // Fix 2: Validate that the ACS URL is in the SP's registered redirect URIs
    if (!sp.redirectUris.includes(parsed.acsUrl)) {
      return errorResponse(
        new AppError("invalid_request", "AssertionConsumerServiceURL not registered for this SP")
      );
    }

    const { params } = translateToOIDC(parsed, AUTHORIZE_ENDPOINT);

    // Call auth-core via service binding — returns a redirect Response
    const authCoreResponse = await initiateOIDCAuthorize(c.env, params);
    return authCoreResponse;
  } catch (err) {
    if (err instanceof AppError) {
      return errorResponse(err);
    }
    const message = err instanceof Error ? err.message : "Failed to parse AuthnRequest";
    return errorResponse(new AppError("saml_error", message));
  }
});

export { authRoutes };
