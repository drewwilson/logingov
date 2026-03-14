# auth-core

Main OIDC/OAuth2 identity provider Worker for Login.gov. This is the primary entry point for the system -- it handles authorization requests from Service Providers, issues tokens, serves user claims, and manages session lifecycle.

Built with [Hono](https://hono.dev/) + [Better Auth](https://www.better-auth.com/) on Cloudflare Workers.

## Routes

### OIDC/OAuth2

| Method | Path | Description |
|--------|------|-------------|
| GET | `/openid_connect/authorize` | Authorization endpoint. Validates request params, creates a SessionDO, redirects to login UI. Supports PAR via `request_uri`. |
| POST | `/api/openid_connect/token` | Token endpoint. Exchanges an authorization code for `access_token` + `id_token`. Client auth via `private_key_jwt`. PKCE support. |
| GET | `/api/openid_connect/userinfo` | Userinfo endpoint. Returns user claims scoped to the SP's requested scopes. Bearer token required. |
| GET | `/api/openid_connect/certs` | JWKS endpoint. Serves the public keys used to sign `id_token`s. Cached in KV with R2 fallback. |
| GET | `/openid_connect/logout` | RP-initiated logout. Validates `id_token_hint`, destroys SessionDO, clears KV, emits a session-revoked SET event, redirects. |
| POST | `/api/openid_connect/par` | Pushed Authorization Request (RFC 9126). Lets clients pre-register auth request params and receive a `request_uri`. |
| GET | `/.well-known/openid-configuration` | Discovery document. |

### Other

| Method | Path | Description |
|--------|------|-------------|
| ALL | `/api/auth/*` | Better Auth handler (sign-up, sign-in, session management, 2FA). |
| GET | `/demo` | Interactive demo page for exercising auth flows. |
| GET | `/health` | Health check. |

## Better Auth integration

A per-request Better Auth instance is created in `src/auth.ts` via `createAuth(env)`. It is bound to PlanetScale (via Hyperdrive) and configured with:

- **Email/password** sign-up and sign-in
- **Social providers** (Google, GitHub)
- **TOTP two-factor authentication** with backup codes
- **OIDC Provider plugin** (Login.gov acts as the OpenID Provider)
- **Drizzle adapter** over PlanetScale (MySQL 8), schema defined in `src/schema.ts`

The Better Auth handler is mounted at `/api/auth/*` _before_ body-consuming middleware so it receives the raw request body.

## Middleware stack

Applied in order on every request (after the Better Auth passthrough):

1. **Tracing** (`@logingov/infra`) -- distributed tracing with `serviceName: "auth-core"`
2. **Rate limiter** (`@logingov/infra`) -- 30 req/min on `/openid_connect/authorize` and `/api/openid_connect/token`
3. **CORS** (Hono built-in)
4. **Error handler** -- catches `AppError` instances and returns structured JSON error responses
5. **Auth context** -- attaches a Better Auth instance to every request for downstream use

The `/openid_connect/authorize` route also runs a **deprecated ACR middleware** that translates legacy IAL/LOA URNs to current `urn:acr.login.gov:*` values.

## Service bindings

auth-core connects to other Workers in the monorepo via Cloudflare service bindings on the `Env` object:

| Binding | Purpose |
|---------|---------|
| `SESSION_DO` | Durable Object for auth flow session state |
| `DB` | PlanetScale database (users, auth codes, service providers, Better Auth tables) |
| `KV_SESSIONS` | KV namespace for PAR requests and session data |
| `KV_JWKS` | KV namespace for JWKS cache |
| `KV_SP_CONFIG` | KV namespace for service provider config cache |
| `R2_KEYS` | R2 bucket for signing key storage |
| `QUEUE_AUDIT` | Queue for audit log events |
| `QUEUE_SET` | Queue for Security Event Token (SET) outbound delivery |
| `AUTH_CORE` | Self-binding (used by demo page to test `/authorize` server-side) |
| `MFA_WORKER`, `SAML_BRIDGE`, `SECURITY_EVENTS`, `IDENTITY_PROOFING`, `ACCOUNT_WORKER`, `ADMIN_WORKER`, `INFRA_WORKER` | Peer Workers (health-checked from demo page) |

## Lib utilities

- `src/lib/client-auth.ts` -- validates `private_key_jwt` client assertions
- `src/lib/token-signing.ts` -- signs `id_token`s (RS256), issues and validates opaque access tokens
- `src/lib/pkce.ts` -- PKCE S256 code challenge/verifier validation
- `src/lib/pairwise.ts` -- computes pairwise subject identifiers per SP
- `src/lib/claims.ts` -- builds userinfo claims scoped to requested OIDC scopes
- `src/lib/sp-lookup.ts` -- service provider lookup with KV caching over PlanetScale

## Local development

From the monorepo root:

```sh
pnpm dev
```

This starts all Workers (including auth-core) via `wrangler dev`. The `/demo` page at `http://localhost:8787/demo` provides a UI for creating accounts, signing in, enabling 2FA, and testing OIDC endpoints against a local database.
