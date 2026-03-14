/**
 * @logingov/saml-bridge Worker
 *
 * SAML 2.0 IdP bridge for Login.gov. Translates SAML AuthnRequests to
 * internal OIDC authorize parameters. Provides metadata, SLO, and
 * annual cert rotation via year-versioned routes.
 *
 * Features:
 *   1. SAML 2.0 SSO (/api/saml/auth)
 *   2. SAML metadata endpoint (/api/saml/metadata)
 *   3. SAML annual cert rotation (/api/saml/auth{year})
 *   4. SAML Single Logout (/api/saml/logout)
 *   5. SAML NameID (UUID) via pairwise sub
 */
import { Hono } from "hono";
import type { Env } from "@logingov/shared";
import { tracing } from "@logingov/infra";
import { authRoutes } from "./routes/auth.js";
import { metadataRoutes } from "./routes/metadata.js";
import { logoutRoutes } from "./routes/logout.js";

const app = new Hono<{ Bindings: Env }>();

// ── Middleware ───────────────────────────────────────────────
app.use("*", tracing({ serviceName: "saml-bridge" }));

// ── Health check ────────────────────────────────────────────
app.get("/health", (c) => c.json({ ok: true, service: "saml-bridge" }));

// ── SAML routes ─────────────────────────────────────────────
app.route("/", authRoutes);
app.route("/", metadataRoutes);
app.route("/", logoutRoutes);

export default app;

// Re-export NameID helper for use by other packages
export { generateNameID } from "./lib/nameid.js";
