# @logingov/identity-proofing

Cloudflare Worker (Hono) that handles IAL2 identity verification for the Login.gov cloud-native rebuild. Integrates with the [Persona API](https://withpersona.com/) for document verification and facial match biometrics.

Called from `auth-core` via Cloudflare service binding (`IDENTITY_PROOFING`).

## Routes

### `/proofing/*` -- IAL2 document verification

| Method | Path | Description |
|--------|------|-------------|
| POST | `/proofing/document/upload` | Upload a document image/PDF to R2 (max 10 MB) |
| POST | `/proofing/verify` | Complete IAL2 document verification via Persona inquiry |
| POST | `/proofing/verify-with-facial-match` | Document verification + selfie biometric match |
| GET | `/proofing/verified-at/:userId` | Return `verified_at` timestamp (OIDC epoch or SAML ISO 8601 via `?format=`) |
| POST | `/proofing/reproof` | Re-proofing flow for users who already hold IAL2 |

### `/ssn/*` -- Scope-gated SSN access

| Method | Path | Description |
|--------|------|-------------|
| GET | `/ssn/:userId` | Decrypt and return SSN. Requires `social_security_number` scope, SP `ial_max >= 2`, and user `ial = 2`. |

### `/x509/*` -- PIV/CAC certificate metadata

| Method | Path | Description |
|--------|------|-------------|
| POST | `/x509/extract` | Read Cloudflare mTLS headers and store x509 metadata in the session Durable Object |
| GET | `/x509/session/:sessionId` | Retrieve stored x509 metadata for userinfo claims |

### Utility

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |

## Persona API integration

`PersonaClient` (`src/lib/persona.ts`) is a typed, fetch-based client for Persona's REST API. It supports:

- **createInquiry** -- start a new document verification inquiry
- **getInquiry** -- retrieve inquiry status and extracted PII fields (name, DOB, address, SSN)
- **listVerifications / getFacialMatchResult** -- locate and evaluate selfie biometric verification
- **resumeInquiry** -- resume an existing inquiry (used during re-proofing)

Requires `PERSONA_API_KEY` in Worker bindings.

## Middleware

### `ialEvaluator`

Reusable Hono middleware that compares a user's current IAL (from PlanetScale) against the IAL requested in the session Durable Object. Returns 403 with an upgrade hint if the user does not meet the required level.

### `ialEvaluatorPassthrough`

Non-blocking variant -- sets `needsProofing` in Hono context without returning an error, letting the downstream route handler decide.

Both are re-exported from the package entry point for use by other workers.

## Data storage

- **PlanetScale (MySQL 8)** -- proofing results are written to the `users` table via Drizzle ORM. PII fields (SSN, birthdate, address) are encrypted with AES-256-GCM before storage (`ENCRYPTION_KEY` binding).
- **R2 (`R2_PROOFING`)** -- raw document uploads.
- **Session DO** -- transient x509/PIV metadata (not persisted to the database).
- **Queue (`QUEUE_SET`)** -- re-proofing completion emits a `REPROOF_COMPLETED` Security Event Token for downstream SPs.

## Re-proofing flow

`POST /proofing/reproof` is available to users who already have `ial = 2`. It re-runs document verification (and optionally facial match), updates encrypted PII in PlanetScale, and publishes a `REPROOF_COMPLETED` SET message to the outbound queue with both previous and new `verifiedAt` timestamps.

## Local development

From the monorepo root:

```sh
pnpm dev:proofing
```
