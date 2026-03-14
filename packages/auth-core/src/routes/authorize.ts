/**
 * OIDC Authorization Endpoint — GET /openid_connect/authorize
 *
 * Validates the authorization request parameters, creates a SessionDO
 * for auth flow state, and redirects to the login UI.
 */
import { Hono } from "hono";
import type { Env } from "@logingov/shared";
import { ACR_VALUES, AppError, uuidV7, evaluateIAL, kvGet, kvDelete } from "@logingov/shared";
import type { ACRValue, IALLevel } from "@logingov/shared";
import { lookupServiceProvider } from "../lib/sp-lookup.js";
import { validateCodeChallenge } from "../lib/pkce.js";
import { deprecatedAcrMiddleware } from "../middleware/deprecated-acr.js";
import type { SessionState } from "@logingov/session-do";
import type { PARStoredRequest } from "./par.js";

const LOGIN_UI_BASE = "https://secure.login.gov";

const authorizeRoute = new Hono<{ Bindings: Env }>();

authorizeRoute.get(
  "/openid_connect/authorize",
  deprecatedAcrMiddleware,
  async (c) => {
    // ── PAR: resolve request_uri if present ────────────────────
    const requestUri = c.req.query("request_uri");
    let parRequest: PARStoredRequest | null = null;

    if (requestUri) {
      const prefix = "urn:ietf:params:oauth:request_uri:";
      if (!requestUri.startsWith(prefix)) {
        throw new AppError("invalid_request", "Invalid request_uri format", 400);
      }
      const parId = requestUri.slice(prefix.length);
      parRequest = await kvGet<PARStoredRequest>(c.env.KV_SESSIONS, `par:${parId}`);

      if (!parRequest) {
        throw new AppError("invalid_request", "request_uri is invalid or expired", 400);
      }

      // Single-use: delete immediately
      await kvDelete(c.env.KV_SESSIONS, `par:${parId}`);

      // Verify client_id matches
      const parClientId = c.req.query("client_id");
      if (parClientId && parClientId !== parRequest.clientId) {
        throw new AppError("invalid_request", "client_id does not match PAR request", 400);
      }
    }

    // ── Extract query parameters (PAR values override) ────────
    const clientId = parRequest?.clientId ?? c.req.query("client_id");
    const redirectUri = parRequest?.redirectUri ?? c.req.query("redirect_uri");
    const responseType = parRequest?.responseType ?? c.req.query("response_type");
    const scope = parRequest?.scope ?? c.req.query("scope");
    const state = parRequest?.state ?? c.req.query("state");
    const nonce = parRequest?.nonce ?? c.req.query("nonce");
    const codeChallenge = parRequest?.codeChallenge ?? c.req.query("code_challenge");
    const codeChallengeMethod = parRequest?.codeChallengeMethod ?? c.req.query("code_challenge_method");
    const locale = parRequest?.locale ?? c.req.query("locale") ?? "en";

    // ACR values may have been translated by the deprecated ACR middleware
    const acrValues: string =
      parRequest?.acrValues ??
      ((c.get("acr_values" as never) as string) ||
      c.req.query("acr_values") ||
      "urn:acr.login.gov:auth-only");

    // ── Validate required parameters ──────────────────────────
    if (!clientId) {
      throw new AppError("invalid_request", "client_id is required", 400);
    }
    if (!redirectUri) {
      throw new AppError("invalid_request", "redirect_uri is required", 400);
    }
    if (responseType !== "code") {
      throw new AppError(
        "unsupported_response_type",
        "Only response_type=code is supported",
        400
      );
    }
    if (!scope) {
      throw new AppError("invalid_request", "scope is required", 400);
    }

    const scopes = scope.split(" ").filter(Boolean);
    if (!scopes.includes("openid")) {
      throw new AppError("invalid_scope", "openid scope is required", 400);
    }

    // ── Validate client_id (SP lookup from D1) ────────────────
    const sp = await lookupServiceProvider(clientId, c.env);
    if (!sp) {
      throw new AppError("invalid_client", "Unknown or invalid client_id", 400);
    }

    // ── Validate redirect_uri ─────────────────────────────────
    if (!sp.redirectUris.includes(redirectUri)) {
      throw new AppError(
        "invalid_request",
        "redirect_uri not registered for this client",
        400
      );
    }

    // ── Validate PKCE ─────────────────────────────────────────
    if (!codeChallenge) {
      throw new AppError("invalid_request", "code_challenge is required", 400);
    }
    if (codeChallenge) {
      if (codeChallengeMethod !== "S256") {
        return redirectWithError(
          redirectUri,
          state,
          "invalid_request",
          "Only S256 code_challenge_method is supported"
        );
      }
      if (!validateCodeChallenge(codeChallenge)) {
        return redirectWithError(
          redirectUri,
          state,
          "invalid_request",
          "Invalid code_challenge format"
        );
      }
    }

    // ── Parse ACR values to determine IAL/AAL ─────────────────
    const primaryAcr = acrValues.split(" ")[0];
    const acrConfig = ACR_VALUES[primaryAcr as ACRValue];

    if (!acrConfig) {
      return redirectWithError(
        redirectUri,
        state,
        "invalid_request",
        `Unsupported acr_values: ${primaryAcr}`
      );
    }

    // ── IAL evaluation: check SP supports the requested IAL ───
    const requestedIal = acrConfig.ial as IALLevel;
    const spMaxIal = sp.ialMax as IALLevel;
    const { allowed: spSupportsIal } = evaluateIAL(spMaxIal, requestedIal);

    if (!spSupportsIal) {
      return redirectWithError(
        redirectUri,
        state,
        "invalid_request",
        `Service provider does not support requested IAL ${requestedIal} (max: ${spMaxIal})`
      );
    }

    // ── Create SessionDO for auth flow state ──────────────────
    const sessionId = uuidV7();
    const doId = c.env.SESSION_DO.idFromName(sessionId);
    const sessionDO = c.env.SESSION_DO.get(doId);

    const sessionState: SessionState = {
      spId: clientId,
      responseType: "code",
      redirectUri,
      scopes,
      nonce,
      state,
      codeChallenge,
      codeChallengeMethod: codeChallengeMethod || undefined,
      requestedIal: acrConfig.ial as 1 | 2,
      requestedAal: acrConfig.aal as 1 | 2,
      facialMatch: "facialMatch" in acrConfig ? acrConfig.facialMatch : undefined,
      mfaVerified: false,
      locale,
      createdAt: new Date().toISOString(),
      expiresAt: "", // Set by DO
    };

    const doResponse = await sessionDO.fetch(
      new Request("https://session-do/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sessionState),
      })
    );

    if (!doResponse.ok) {
      throw new AppError("server_error", "Failed to create auth session", 500);
    }

    // ── Redirect to login UI ──────────────────────────────────
    const loginUrl = new URL(`${LOGIN_UI_BASE}/login`);
    loginUrl.searchParams.set("session_id", sessionId);
    loginUrl.searchParams.set("locale", locale);

    // If IAL 2 is required, indicate identity verification is needed
    if (acrConfig.ial === 2) {
      loginUrl.searchParams.set("ial", "2");
    }

    return c.redirect(loginUrl.toString(), 302);
  }
);

/**
 * Redirect back to the SP with an error per OAuth 2.0 spec.
 */
function redirectWithError(
  redirectUri: string,
  state: string | undefined,
  error: string,
  description: string
): Response {
  const url = new URL(redirectUri);
  url.searchParams.set("error", error);
  url.searchParams.set("error_description", description);
  if (state) {
    url.searchParams.set("state", state);
  }
  return Response.redirect(url.toString(), 302);
}

export { authorizeRoute };
