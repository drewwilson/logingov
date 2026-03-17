/**
 * Pushed Authorization Request (PAR) Endpoint — POST /api/openid_connect/par
 *
 * RFC 9126: Allows clients to push the authorization request payload
 * directly to the AS and receive a request_uri in return. The client
 * then redirects the user to /authorize?request_uri=...&client_id=...
 *
 * Benefits: keeps authorization params off the URL, supports larger
 * payloads, and enables client authentication before the auth flow.
 */
import { Hono } from "hono";
import type { Env } from "@logingov/shared";
import { AppError, uuidV7, evaluateIAL, kvPut, KV_KEYS, parseAcrValues } from "@logingov/shared";
import type { IALLevel } from "@logingov/shared";
import { validateClientAssertion } from "../lib/client-auth.js";
import { lookupServiceProvider } from "../lib/sp-lookup.js";
import { validateCodeChallenge } from "../lib/pkce.js";

const PAR_TTL_SECONDS = 60; // request_uri expires after 60 seconds

export interface PARStoredRequest {
  clientId: string;
  redirectUri: string;
  responseType: string;
  scope: string;
  state?: string;
  nonce?: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
  acrValues?: string;
  locale?: string;
}

const parRoute = new Hono<{ Bindings: Env }>();

parRoute.post("/api/openid_connect/par", async (c) => {
  // ── Client authentication (private_key_jwt) ───────────────
  const body = await c.req.parseBody();

  const clientAssertionType = body["client_assertion_type"] as string | undefined;
  const clientAssertion = body["client_assertion"] as string | undefined;

  if (
    clientAssertionType !== "urn:ietf:params:oauth:client-assertion-type:jwt-bearer" ||
    !clientAssertion
  ) {
    throw new AppError(
      "invalid_request",
      "PAR requires private_key_jwt client authentication",
      400
    );
  }

  const { clientId } = await validateClientAssertion(clientAssertion, c.env);

  // ── Extract authorization parameters ───────────────────────
  const redirectUri = body["redirect_uri"] as string | undefined;
  const responseType = body["response_type"] as string | undefined;
  const scope = body["scope"] as string | undefined;
  const state = body["state"] as string | undefined;
  const nonce = body["nonce"] as string | undefined;
  const codeChallenge = body["code_challenge"] as string | undefined;
  const codeChallengeMethod = body["code_challenge_method"] as string | undefined;
  const acrValues = body["acr_values"] as string | undefined;
  const locale = body["locale"] as string | undefined;

  // ── Validate required parameters ──────────────────────────
  if (!redirectUri) {
    throw new AppError("invalid_request", "redirect_uri is required", 400);
  }
  if (responseType !== "code") {
    throw new AppError("unsupported_response_type", "Only response_type=code is supported", 400);
  }
  if (!scope) {
    throw new AppError("invalid_request", "scope is required", 400);
  }

  const scopes = scope.split(" ").filter(Boolean);
  if (!scopes.includes("openid")) {
    throw new AppError("invalid_scope", "openid scope is required", 400);
  }

  // ── Validate SP ───────────────────────────────────────────
  const sp = await lookupServiceProvider(clientId, c.env);
  if (!sp) {
    throw new AppError("invalid_client", `Unknown client_id: ${clientId}`, 400);
  }

  if (!sp.redirectUris.includes(redirectUri)) {
    throw new AppError("invalid_request", "redirect_uri not registered for this client", 400);
  }

  // ── Validate PKCE ─────────────────────────────────────────
  if (codeChallenge) {
    if (codeChallengeMethod !== "S256") {
      throw new AppError("invalid_request", "Only S256 code_challenge_method is supported", 400);
    }
    if (!validateCodeChallenge(codeChallenge)) {
      throw new AppError("invalid_request", "Invalid code_challenge format", 400);
    }
  }

  // ── Validate ACR values ───────────────────────────────────
  if (acrValues) {
    const parsed = parseAcrValues(acrValues);
    if (!parsed) {
      throw new AppError("invalid_request", `Unsupported acr_values: ${acrValues}`, 400);
    }

    const requestedIal = parsed.acrConfig.ial as IALLevel;
    const spMaxIal = sp.ialMax as IALLevel;
    const { allowed } = evaluateIAL(spMaxIal, requestedIal);
    if (!allowed) {
      throw new AppError(
        "invalid_request",
        `Service provider does not support requested IAL ${requestedIal} (max: ${spMaxIal})`,
        400
      );
    }
  }

  // ── Store PAR request and return request_uri ──────────────
  const parId = uuidV7();
  const requestUri = `urn:ietf:params:oauth:request_uri:${parId}`;

  const storedRequest: PARStoredRequest = {
    clientId,
    redirectUri,
    responseType: "code",
    scope,
    state,
    nonce,
    codeChallenge,
    codeChallengeMethod,
    acrValues,
    locale,
  };

  await kvPut(c.env.KV_SESSIONS, `par:${parId}`, storedRequest, PAR_TTL_SECONDS);

  return c.json(
    {
      request_uri: requestUri,
      expires_in: PAR_TTL_SECONDS,
    },
    201
  );
});

export { parRoute };
