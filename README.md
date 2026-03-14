# Login.gov — Modern Stack

A cloud-native rebuild of [login.gov](https://login.gov) on Cloudflare Workers, replacing the existing Rails/PostgreSQL/Redis monolith with a globally distributed TypeScript stack.

Full backward compatibility with existing OIDC and SAML integrations. Zero cold starts, 300+ edge locations, no server management.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Edge          WAF · Anycast/GeoDNS · KV Cache · mTLS      │
├─────────────────────────────────────────────────────────────┤
│  Auth Core     Better Auth · OIDC Worker · SAML Bridge      │
│                IAL/AAL Evaluator · Durable Objects · JWKS   │
├─────────────────────────────────────────────────────────────┤
│  Services      Identity Proofing · MFA · RISC/SET · Account │
│                CF Queues · Risk Engine                       │
├─────────────────────────────────────────────────────────────┤
│  Storage       PlanetScale (MySQL 8/Vitess) · CF KV · R2   │
├─────────────────────────────────────────────────────────────┤
│  Infra         Wrangler/CI · OpenTelemetry · Cron Triggers  │
└─────────────────────────────────────────────────────────────┘
```

## Technology Stack

| Layer             | Technology                      | Replaces                  |
| ----------------- | ------------------------------- | ------------------------- |
| Runtime           | Cloudflare Workers (TypeScript) | Rails / Ruby on Linux VMs |
| Framework         | Hono                            | Rails Router              |
| Auth framework    | Better Auth                     | Custom-built auth logic   |
| Auth protocol     | jose + oauth4webapi             | Ruby omniauth / jwt gems  |
| Sessions          | Durable Objects + KV            | Redis (Elasticache)       |
| Database          | PlanetScale (Vitess / MySQL 8)  | PostgreSQL RDS            |
| Config / cache    | Cloudflare KV                   | Redis + env vars          |
| File storage      | Cloudflare R2                   | AWS S3                    |
| Async jobs        | Cloudflare Queues               | Sidekiq + Redis           |
| SAML bridge       | samlify                         | ruby-saml                 |
| Identity proofing | Persona API                     | IDEMIA / Experian         |
| Observability     | OpenTelemetry + CF Analytics    | Datadog APM               |

## Packages

The system is organized as a TypeScript monorepo with 10 packages under `packages/`:

| Package                                          | Description                                                                       |
| ------------------------------------------------ | --------------------------------------------------------------------------------- |
| [shared](packages/shared/)                       | Shared types, schemas (Drizzle ORM), crypto, KV helpers, IAL evaluator            |
| [auth-core](packages/auth-core/)                 | Main OIDC/OAuth2 provider Worker — `/authorize`, `/token`, `/userinfo`, `/logout` |
| [session-do](packages/session-do/)               | Durable Object for per-session auth state with alarm-based TTL                    |
| [mfa](packages/mfa/)                             | Multi-factor authentication Worker — TOTP, WebAuthn, SMS OTP, backup codes        |
| [saml-bridge](packages/saml-bridge/)             | SAML 2.0 translation layer — converts AuthnRequest to internal OIDC flow          |
| [identity-proofing](packages/identity-proofing/) | IAL2 identity verification Worker — Persona API integration                       |
| [security-events](packages/security-events/)     | RISC/SET Worker — inbound fraud events, outbound lifecycle SETs                   |
| [account](packages/account/)                     | Account management Worker — registration, email, password, deletion               |
| [admin](packages/admin/)                         | Admin/partner portal Worker — SP onboarding, internal ops                         |
| [infra](packages/infra/)                         | Infrastructure utilities — observability, rate limiting, queues, cron, i18n       |

## Prerequisites

- **Node.js** >= 18
- **pnpm** 10.9+ (defined in `packageManager` field)
- **Wrangler** (installed as a dev dependency)

## Getting Started

### 1. Install dependencies

```sh
pnpm install
```

### 2. Run the database migration

Apply the database schema migrations:

```sh
pnpm wrangler d1 migrations apply logingov-db --local
```

### 3. Start the main auth-core Worker (local dev)

```sh
pnpm dev
```

This starts the primary Worker (`auth-core`) at `http://localhost:8787` with all Cloudflare bindings (KV, R2, Queues, Durable Objects) running locally.

### 4. Start individual service Workers

Each service Worker can be run independently for development:

```sh
pnpm dev:mfa          # MFA Worker
pnpm dev:account      # Account management Worker
pnpm dev:admin        # Admin portal Worker
pnpm dev:saml         # SAML bridge Worker
pnpm dev:proofing     # Identity proofing Worker
pnpm dev:security     # Security events Worker
pnpm dev:infra        # Infrastructure Worker
```

### 5. Type checking

```sh
pnpm typecheck
```

The project uses TypeScript project references (`tsconfig.json` references each package). This command type-checks all packages in dependency order.

### 6. Run tests

```sh
pnpm test
```

Tests use Vitest.

### 7. Build

```sh
pnpm build
```

Runs `tsc -b` across all packages.

## Key Endpoints

Once `auth-core` is running:

| Endpoint                            | Method | Description                                          |
| ----------------------------------- | ------ | ---------------------------------------------------- |
| `/.well-known/openid-configuration` | GET    | OIDC discovery document                              |
| `/openid_connect/authorize`         | GET    | Authorization endpoint                               |
| `/api/openid_connect/token`         | POST   | Token endpoint (private_key_jwt)                     |
| `/api/openid_connect/userinfo`      | GET    | Userinfo endpoint (bearer token)                     |
| `/api/openid_connect/certs`         | GET    | JWKS endpoint                                        |
| `/openid_connect/logout`            | GET    | Logout endpoint                                      |
| `/api/openid_connect/par`           | POST   | Pushed Authorization Request                         |
| `/api/auth/*`                       | \*     | Better Auth handler (sign-up, sign-in, session, 2FA) |
| `/health`                           | GET    | Health check                                         |

## Cloudflare Bindings

Configured in `wrangler.toml`:

- **Database**: `DB` — PlanetScale (MySQL 8 / Vitess) via Hyperdrive
- **KV**: `KV_SESSIONS`, `KV_SP_CONFIG`, `KV_JWKS`, `KV_FLAGS`, `KV_OTP`, `KV_RATE_LIMIT`
- **R2**: `R2_AUDIT`, `R2_PROOFING`, `R2_KEYS`
- **Queues**: `QUEUE_EMAIL`, `QUEUE_SET`, `QUEUE_AUDIT`, `QUEUE_FRAUD`
- **Durable Objects**: `SESSION_DO` (class `SessionDO`)
- **Service Bindings**: Worker-to-worker calls between all service Workers
- **Cron Triggers**: JWKS rotation (hourly), expired code cleanup (5 min), audit log flush (daily)

## Deployment

```sh
# Staging
pnpm wrangler deploy --env staging

# Production
pnpm wrangler deploy --env production
```

## Protocols Supported

- **OIDC / OAuth 2.0** — Full OpenID Connect 1.0 with iGov Profile compliance (authorization code flow, PKCE, PAR, private_key_jwt, pairwise subjects)
- **SAML 2.0** — Web Browser SSO Profile via thin translation layer
- **OpenID RISC** — Bidirectional Security Event Token delivery (10 event types)
- **NIST 800-63-3** — IAL1/IAL2/AAL1/AAL2 assurance levels including facial match and phishing-resistant AAL2

## Security & Compliance

- [SECURITY_AUDIT.md](SECURITY_AUDIT.md) — Comprehensive security audit report (50+ checks across 20 categories, all findings remediated)
- [compliance/INCIDENT_RESPONSE.md](compliance/INCIDENT_RESPONSE.md) — Alert thresholds, escalation paths, runbooks, post-incident review template
- [compliance/DISASTER_RECOVERY.md](compliance/DISASTER_RECOVERY.md) — RTO/RPO targets, backup inventory, recovery procedures, quarterly test plan
- [compliance/PRIVACY_POLICY.md](compliance/PRIVACY_POLICY.md) — Data inventory, encryption details, user rights, third-party sharing, breach notification
- [compliance/DATA_RETENTION.md](compliance/DATA_RETENTION.md) — Retention periods per data category, automated enforcement, legal holds
- [compliance/ACCESS_CONTROL_POLICY.md](compliance/ACCESS_CONTROL_POLICY.md) — Role definitions, secret rotation schedule, quarterly access review process
- [compliance/INFRASTRUCTURE.md](compliance/INFRASTRUCTURE.md) — WAF rules, TLS configuration, network segmentation, DDoS protection

## Additional Documentation

- [index.html](index.html) — Interactive overview page
- [infra.html](infra.html) — Infrastructure architecture diagram
- [coverage.html](coverage.html) — Feature coverage matrix (50 features mapped)
