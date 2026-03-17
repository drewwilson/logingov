/**
 * OIDC Logout Endpoint — GET /openid_connect/logout
 *
 * Supports login.gov's logout contract (client_id + post_logout_redirect_uri)
 * and standard OIDC RP-Initiated Logout (id_token_hint). Destroys the session
 * DO, revokes the Better Auth DB session, deletes access tokens from KV,
 * emits a session-revoked SET, and redirects to the post_logout_redirect_uri.
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
import { createAuth } from "../auth.js";

const DEFAULT_LOGOUT_REDIRECT = "https://secure.login.gov";

const logoutRoute = new Hono<{ Bindings: Env }>();

logoutRoute.get("/openid_connect/logout", async (c) => {
  const idTokenHint = c.req.query("id_token_hint");
  const postLogoutRedirectUri = c.req.query("post_logout_redirect_uri");
  const state = c.req.query("state");
  const clientIdParam = c.req.query("client_id");

  // ── Resolve client_id and sub ───────────────────────────────
  // Login.gov uses client_id + post_logout_redirect_uri (no id_token_hint).
  // We also support id_token_hint for standard OIDC RP-Initiated Logout.
  let clientId: string | undefined;
  let sub: string | undefined;

  if (idTokenHint) {
    // If id_token_hint is provided, verify and extract claims
    try {
      const { key } = await getSigningKey(c.env);
      const { payload } = await jose.jwtVerify(idTokenHint, key, {
        clockTolerance: 365 * 24 * 60 * 60, // allow expired tokens for logout
      });
      sub = payload.sub ?? undefined;
      const aud = payload.aud;
      clientId = Array.isArray(aud) ? aud[0] : aud;
    } catch {
      // Invalid id_token_hint — fall through to client_id param
    }
  }

  // client_id param takes precedence (login.gov standard flow)
  if (clientIdParam) {
    clientId = clientIdParam;
  }

  if (!clientId) {
    throw new AppError("invalid_request", "client_id is required", 400);
  }

  // ── Validate post_logout_redirect_uri ───────────────────────
  let redirectTo = DEFAULT_LOGOUT_REDIRECT;

  if (postLogoutRedirectUri) {
    const sp = await lookupServiceProvider(clientId, c.env);
    if (sp) {
      if (sp.postLogoutRedirectUris?.includes(postLogoutRedirectUri)) {
        // Exact match against registered post-logout URIs
        redirectTo = postLogoutRedirectUri;
      } else if (!sp.postLogoutRedirectUris) {
        // No post-logout URIs configured — allow if the origin matches
        // a registered redirect URI (graceful fallback)
        const redirectOrigins = (sp.redirectUris ?? []).map(
          (u: string) => { try { return new URL(u).origin; } catch { return null; } }
        );
        if (redirectOrigins.includes(postLogoutRedirectUri)) {
          redirectTo = postLogoutRedirectUri;
        }
      }
    }
  }

  // ── Destroy SessionDO ───────────────────────────────────────
  // If we have a sub (from id_token_hint), destroy the session DO
  if (sub) {
    try {
      const doId = c.env.SESSION_DO.idFromName(sub);
      const sessionDO = c.env.SESSION_DO.get(doId);
      await sessionDO.fetch(
        new Request("https://session-do/destroy", { method: "DELETE" })
      );
    } catch {
      // Session may already be expired/destroyed — that's fine
    }
  }

  // ── Revoke Better Auth session (DB) ────────────────────────
  // Get the current session from the browser cookie, then revoke it.
  // This ensures the user's DB session row is deleted immediately.
  try {
    const auth = createAuth(c.env);
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (session?.session?.token) {
      await auth.api.revokeSession({
        headers: c.req.raw.headers,
        body: { token: session.session.token },
      });
    }
  } catch {
    // Session may not exist or cookie may be absent — that's fine
  }

  // ── Delete access_token from KV (if provided) ──────────────
  // Access tokens are opaque and keyed by value in KV, so we can't look them up
  // by userId. If the caller passes the token, we delete it immediately;
  // otherwise the 15-min KV TTL handles cleanup. The session-revoked SET
  // notifies the SP to stop using the token regardless.
  const accessTokenParam = c.req.query("access_token");
  if (accessTokenParam) {
    try {
      await kvDelete(c.env.KV_SESSIONS, `access_token:${accessTokenParam}`);
    } catch {
      // Best-effort — TTL will clean it up
    }
  }

  // ── Emit session-revoked SET ────────────────────────────────
  const subjectId = sub ?? clientId; // best-effort subject for audit
  try {
    const setMessage = createQueueMessage<SETOutboundPayload>("set:outbound", subjectId, {
      targetUrl: "", // resolved by SET consumer per SP
      eventUri: SET_EVENT_TYPES.SESSION_REVOKED,
      subject: subjectId,
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
  await enqueue(c.env.QUEUE_AUDIT, "audit:write", subjectId, {
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
