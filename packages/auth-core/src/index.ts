/**
 * Auth Core Worker — OIDC/OAuth2 Provider
 *
 * Hono app that serves as the central login.gov identity provider.
 * Routes: /authorize, /token, /userinfo, /logout, /.well-known/*
 */
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "@logingov/shared";
import { tracing, rateLimiter } from "@logingov/infra";
import { createAuth } from "./auth.js";
import { errorHandlerMiddleware } from "./middleware/error-handler.js";
import { securityHeaders } from "./middleware/security-headers.js";
import { authorizeRoute } from "./routes/authorize.js";
import { tokenRoute } from "./routes/token.js";
import { userinfoRoute } from "./routes/userinfo.js";
import { certsRoute } from "./routes/certs.js";
import { logoutRoute } from "./routes/logout.js";
import { parRoute } from "./routes/par.js";
import { demoRoute } from "./routes/demo.js";

const app = new Hono<{ Bindings: Env }>();

// ── Better Auth handler (sign-up, sign-in, session, 2FA) ───
// Must be registered BEFORE body-consuming middleware so Better Auth
// gets the raw request body intact.

app.all("/api/auth/*", async (c) => {
  const auth = createAuth(c.env);
  return auth.handler(c.req.raw);
});

// ── Middleware ───────────────────────────────────────────────

app.use("*", tracing({ serviceName: "auth-core" }));
app.use("/openid_connect/authorize", rateLimiter({ limits: { _default: { maxRequests: 30, windowSeconds: 60 } } }));
app.use("/api/openid_connect/token", rateLimiter({ limits: { _default: { maxRequests: 30, windowSeconds: 60 } } }));
app.use("/api/auth/*", rateLimiter({ limits: { _default: { maxRequests: 30, windowSeconds: 60 } } }));
app.use("/api/openid_connect/userinfo", rateLimiter({ limits: { _default: { maxRequests: 30, windowSeconds: 60 } } }));
app.use("*", async (c, next) => {
  const allowedOrigins = c.env.ALLOWED_ORIGINS?.split(",") ?? [
    "https://secure.login.gov",
    "https://idp.int.identitysandbox.gov",
  ];
  const corsMiddleware = cors({
    origin: allowedOrigins,
    credentials: true,
  });
  return corsMiddleware(c, next);
});
app.use("*", errorHandlerMiddleware);
app.use("*", securityHeaders);

// Attach Better Auth instance per request (for non-Better-Auth routes)
app.use("*", async (c, next) => {
  const auth = createAuth(c.env);
  c.set("auth" as never, auth);
  await next();
});

// ── Well-Known endpoints ────────────────────────────────────

app.get("/.well-known/openid-configuration", async (c) => {
  const issuer = "https://secure.login.gov";
  return c.json({
    issuer,
    authorization_endpoint: `${issuer}/openid_connect/authorize`,
    token_endpoint: `${issuer}/api/openid_connect/token`,
    userinfo_endpoint: `${issuer}/api/openid_connect/userinfo`,
    jwks_uri: `${issuer}/api/openid_connect/certs`,
    end_session_endpoint: `${issuer}/openid_connect/logout`,
    scopes_supported: [
      "openid", "email", "all_emails", "phone", "address",
      "profile", "profile:name", "profile:birthdate", "profile:verified_at",
      "social_security_number", "x509", "x509:issuer", "x509:subject",
      "x509:presented", "locale",
    ],
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    pushed_authorization_request_endpoint: `${issuer}/api/openid_connect/par`,
    require_pushed_authorization_requests: false,
    token_endpoint_auth_methods_supported: ["private_key_jwt"],
    id_token_signing_alg_values_supported: ["RS256"],
    subject_types_supported: ["pairwise"],
    acr_values_supported: [
      "urn:acr.login.gov:auth-only",
      "urn:acr.login.gov:verified",
      "urn:acr.login.gov:verified-facial-match-required",
      "urn:acr.login.gov:verified-facial-match-preferred",
      // Deprecated (backward compat)
      "http://idmanagement.gov/ns/assurance/ial/1",
      "http://idmanagement.gov/ns/assurance/ial/2",
      "http://idmanagement.gov/ns/assurance/loa/1",
      "http://idmanagement.gov/ns/assurance/loa/3",
    ],
    claims_supported: [
      "sub", "iss", "aud", "exp", "iat", "jti", "nonce", "at_hash", "c_hash",
      "acr", "email", "email_verified", "given_name", "family_name",
      "birthdate", "phone", "address", "social_security_number",
      "verified_at", "ial", "aal", "locale",
    ],
  });
});

// ── OIDC/OAuth2 routes ──────────────────────────────────────

app.route("/", authorizeRoute);
app.route("/", tokenRoute);
app.route("/", userinfoRoute);
app.route("/", certsRoute);
app.route("/", logoutRoute);
app.route("/", parRoute);
app.route("/", demoRoute);

// ── Health check ────────────────────────────────────────────

app.get("/health", (c) => c.json({ ok: true, service: "auth-core" }));

export { SessionDO } from "@logingov/session-do";
export default app;
