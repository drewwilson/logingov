/**
 * OIDC Logout Endpoint — GET /openid_connect/logout
 *
 * Validates id_token_hint, destroys the session DO, clears KV session data,
 * and redirects to the post_logout_redirect_uri.
 */
import { Hono } from "hono";
import * as jose from "jose";
import type { Env } from "@logingov/shared";
import { AppError, kvDelete } from "@logingov/shared";
import { enqueue } from "@logingov/infra";
import { createQueueMessage } from "@logingov/shared/queue";
import type { SETOutboundPayload } from "@logingov/shared/queue";
import { SET_EVENT_TYPES } from "@logingov/shared/types";
import { lookupServiceProvider } from "../lib/sp-lookup.js";
import { getSigningKey } from "../lib/token-signing.js";

const DEFAULT_LOGOUT_REDIRECT = "https://secure.login.gov";

const logoutRoute = new Hono<{ Bindings: Env }>();

logoutRoute.get("/openid_connect/logout", async (c) => {
  const idTokenHint = c.req.query("id_token_hint");
  const postLogoutRedirectUri = c.req.query("post_logout_redirect_uri");
  const state = c.req.query("state");

  // ── Validate id_token_hint ──────────────────────────────────
  if (!idTokenHint) {
    throw new AppError("invalid_request", "id_token_hint is required", 400);
  }

  // Verify id_token_hint signature (allow expired tokens since logout after expiry is valid)
  let claims: jose.JWTPayload;
  try {
    const { key } = await getSigningKey(c.env);
    const { payload } = await jose.jwtVerify(idTokenHint, key, {
      clockTolerance: 365 * 24 * 60 * 60, // allow expired tokens for logout
    });
    claims = payload;
  } catch {
    throw new AppError("invalid_request", "Invalid id_token_hint", 400);
  }

  const sub = claims.sub;
  const aud = claims.aud;

  if (!sub || !aud) {
    throw new AppError(
      "invalid_request",
      "id_token_hint missing sub or aud",
      400
    );
  }

  // Determine the client_id (aud may be string or string[])
  const clientId = Array.isArray(aud) ? aud[0] : aud;

  // ── Validate post_logout_redirect_uri ───────────────────────
  let redirectTo = DEFAULT_LOGOUT_REDIRECT;

  if (postLogoutRedirectUri) {
    const sp = await lookupServiceProvider(clientId, c.env);
    // Use post_logout_redirect_uris if configured, fall back to redirect_uris
    const allowedUris = sp?.postLogoutRedirectUris ?? sp?.redirectUris ?? [];
    if (sp && allowedUris.includes(postLogoutRedirectUri)) {
      redirectTo = postLogoutRedirectUri;
    } else {
      // Per spec, if the redirect URI is not registered, ignore it
      // and use the default
      redirectTo = DEFAULT_LOGOUT_REDIRECT;
    }
  }

  // ── Destroy SessionDO ───────────────────────────────────────
  // We use the sub as the DO name to find the right session
  // In practice, we'd look up the session by the token's jti or a session reference
  // For now, attempt to destroy any active session for this sub
  try {
    const doId = c.env.SESSION_DO.idFromName(sub);
    const sessionDO = c.env.SESSION_DO.get(doId);
    await sessionDO.fetch(
      new Request("https://session-do/destroy", { method: "DELETE" })
    );
  } catch {
    // Session may already be expired/destroyed — that's fine
  }

  // ── Clear KV session data ───────────────────────────────────
  // Clear the access token if referenced in the id_token jti
  if (claims.jti) {
    try {
      await kvDelete(c.env.KV_SESSIONS, `session:${claims.jti}`);
    } catch {
      // Best-effort cleanup
    }
  }

  // ── Emit session-revoked SET ────────────────────────────────
  try {
    const setMessage = createQueueMessage<SETOutboundPayload>("set:outbound", sub, {
      targetUrl: "", // resolved by SET consumer per SP
      eventUri: SET_EVENT_TYPES.SESSION_REVOKED,
      subject: sub,
      claims: {
        clientId,
        revokedAt: new Date().toISOString(),
      },
    });
    await c.env.QUEUE_SET.send(setMessage);
  } catch {
    // Best-effort: don't block logout if SET emission fails
  }

  // ── Audit log: logout ─────────────────────────────────────────
  await enqueue(c.env.QUEUE_AUDIT, "audit:write", sub, {
    eventType: "logout",
    ip: c.req.header("cf-connecting-ip") ?? "unknown",
    ial: 1,
    aal: 1,
    metadata: { spId: clientId },
  });

  // ── Redirect ────────────────────────────────────────────────
  const url = new URL(redirectTo);
  if (state) {
    url.searchParams.set("state", state);
  }

  return c.redirect(url.toString(), 302);
});

export { logoutRoute };
