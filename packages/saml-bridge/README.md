# @logingov/saml-bridge

A thin SAML 2.0 IdP translation layer that converts SAML AuthnRequests into internal OIDC flows. Runs as a Cloudflare Worker built with Hono.

Government service providers (SPs) that still speak SAML hit this bridge, which translates their requests into OIDC authorize calls against `auth-core`, then translates the results back into SAML responses.

## How it works

1. An SP sends a SAML `AuthnRequest` (GET or POST binding) to `/api/saml/auth`.
2. The bridge parses the XML, extracts the issuer, ACS URL, and requested AuthnContext.
3. SAML AuthnContext class refs are mapped to Login.gov ACR values (e.g., `ial/2` becomes `urn:acr.login.gov:verified`).
4. The translated parameters are forwarded to `auth-core` via the `AUTH_CORE` Cloudflare service binding (no public internet round-trip).
5. `auth-core` returns a 302 redirect to the login UI, which the bridge forwards to the user-agent.

## Routes

| Route | Method | Description |
|---|---|---|
| `/health` | GET | Health check |
| `/api/saml/auth` | GET, POST | SSO entry point -- parses AuthnRequest and initiates OIDC authorize via auth-core |
| `/api/saml/auth{year}` | GET, POST | Year-versioned SSO for annual certificate rotation (e.g., `/api/saml/auth2026`) |
| `/api/saml/metadata` | GET | SAML IdP metadata XML (entity descriptor, signing cert, SSO/SLO endpoints) |
| `/api/saml/logout` | GET, POST | Single Logout -- parses LogoutRequest, calls auth-core OIDC logout, returns LogoutResponse via HTTP-POST binding |

## Key modules

- **`lib/saml-helpers.ts`** -- AuthnRequest/LogoutRequest parsing, SAML-to-OIDC parameter translation, IdP metadata XML generation, LogoutResponse generation. Uses lightweight regex-based XML extraction (no DOM parser in Workers).
- **`lib/auth-core-client.ts`** -- Service-binding client that calls `auth-core`'s `/openid_connect/authorize` and `/openid_connect/logout` endpoints via the `AUTH_CORE` Fetcher.
- **`lib/nameid.ts`** -- Pairwise NameID generation. Produces a deterministic UUID v5-style identifier per user+SP pair using HMAC-SHA256. Re-exported from the package entry point for use by other packages.

## Service binding

This Worker is called from `auth-core` as the `SAML_BRIDGE` service binding. Internally, it calls back to `auth-core` via the `AUTH_CORE` binding to initiate and complete OIDC flows.

## Dependencies

- **[samlify](https://github.com/tngan/samlify)** -- SAML protocol handling
- **@logingov/shared** -- Shared types (`Env`), KV helpers, crypto (`computePairwiseSub`), error handling, `callWorker` utility
- **@logingov/infra** -- Tracing middleware

## Signing certificates

Signing certs are stored in `KV_JWKS` (keyed as `saml-current`). Year-versioned routes (`/api/saml/auth{year}`) support annual SAML certificate rotation, with signing keys stored in Workers Secrets keyed by year.

## Local development

From the monorepo root:

```sh
pnpm dev:saml
```
