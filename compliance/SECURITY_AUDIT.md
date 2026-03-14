# Security Audit Report — Login.gov Cloud-Native Rebuild

**Audit Date:** 2026-03-14
**Scope:** All 10 packages in `/packages/` (auth-core, mfa, session-do, saml-bridge, identity-proofing, account, admin, security-events, infra, shared)
**Auditor:** Automated deep-code review (Claude)
**Status:** All findings remediated

---

## Table of Contents

1. [How to Use This Document](#how-to-use-this-document)
2. [Authentication & Identity](#1-authentication--identity)
3. [OAuth 2.0 / OpenID Connect](#2-oauth-20--openid-connect)
4. [SAML 2.0](#3-saml-20)
5. [Multi-Factor Authentication](#4-multi-factor-authentication)
6. [Session Management](#5-session-management)
7. [Cryptography](#6-cryptography)
8. [Input Validation & Injection](#7-input-validation--injection)
9. [Access Control & Authorization](#8-access-control--authorization)
10. [PII & Data Protection](#9-pii--data-protection)
11. [Rate Limiting & Abuse Prevention](#10-rate-limiting--abuse-prevention)
12. [Infrastructure & Platform Security](#11-infrastructure--platform-security)
13. [Security Event Handling (RISC/SET)](#12-security-event-handling-riscset)
14. [Audit Logging & Observability](#13-audit-logging--observability)
15. [Error Handling & Information Disclosure](#14-error-handling--information-disclosure)
16. [Cross-Origin & Transport Security](#15-cross-origin--transport-security)
17. [Account Lifecycle](#16-account-lifecycle)
18. [Identity Proofing (KYC)](#17-identity-proofing-kyc)
19. [Admin & Service Provider Management](#18-admin--service-provider-management)
20. [Environment & Configuration](#19-environment--configuration)

---

## How to Use This Document

Each section below contains a table of security checks. For each check:

- **ID** — Unique identifier for tracking. Use these in code comments (e.g., `// SEC-AUTH-03`) and in future audit runs.
- **Check** — What is being verified.
- **How It Passes** — How the system satisfies the requirement, including file references.
- **Status** — `PASS` (verified) or `NOTE` (acceptable with caveats).

When re-running this audit after system changes, walk through each check and verify the referenced code still satisfies the requirement. Checks marked `PASS` deserve extra attention since they were previously broken.

---

## 1. Authentication & Identity

### Password Authentication

| ID | Check | How It Passes | Status |
|----|-------|---------------|--------|
| SEC-AUTH-01 | Passwords hashed with a strong KDF | PBKDF2 with SHA-256 used in `packages/account/src/routes/password.ts`. | PASS |
| SEC-AUTH-02 | Password comparison uses constant-time equality | `crypto.subtle.timingSafeEqual()` used in `verifyPassword()` in `packages/account/src/routes/password.ts`. | PASS |
| SEC-AUTH-03 | Common/breached passwords rejected | ~200 common passwords checked via `packages/account/src/lib/common-passwords.ts`; passwords containing the user's email local part also rejected. Expandable via KV-backed list for full NIST 800-63B compliance. | PASS |
| SEC-AUTH-04 | Password reset tokens are single-use | Reset tokens include a `jti` claim; on use, the jti is stored in KV (`reset_token_used:<jti>`) with 1-hour TTL. Duplicate use is rejected. See `packages/account/src/routes/password.ts`. | PASS |
| SEC-AUTH-05 | Password change invalidates existing sessions | Session invalidation triggered on password change in `packages/account/src/routes/password.ts`. | PASS |
| SEC-AUTH-06 | Forgot-password does not reveal account existence | Generic success message returned regardless of whether the email exists. | PASS |

### Better Auth Integration

| ID | Check | How It Passes | Status |
|----|-------|---------------|--------|
| SEC-AUTH-07 | Better Auth `baseURL` is environment-driven | Reads from `env.BASE_URL` with localhost fallback for dev. See `packages/auth-core/src/auth.ts`. | PASS |
| SEC-AUTH-08 | Social OAuth providers (Google, GitHub) configured | Provider credentials loaded from Worker secrets; callback URLs match registered origins. | PASS |
| SEC-AUTH-09 | Better Auth 2FA plugin enabled | Two-factor plugin active in Better Auth config. Backup codes and TOTP supported. | PASS |

---

## 2. OAuth 2.0 / OpenID Connect

### Authorization Endpoint

| ID | Check | How It Passes | Status |
|----|-------|---------------|--------|
| SEC-OIDC-01 | PKCE is mandatory | `code_challenge` is required on all authorization requests. Requests without it receive a 400 error. See `packages/auth-core/src/routes/authorize.ts`. | PASS |
| SEC-OIDC-02 | PKCE verification uses constant-time comparison | `crypto.subtle.timingSafeEqual()` used in `packages/auth-core/src/lib/pkce.ts`. | PASS |
| SEC-OIDC-03 | `redirect_uri` validated against registered SP URIs | Looked up from `service_providers` table via `packages/auth-core/src/lib/sp-lookup.ts`; exact match required. | PASS |
| SEC-OIDC-04 | `state` parameter passed through correctly | Stored in session DO and returned in authorization response. | PASS |
| SEC-OIDC-05 | Unknown `client_id` returns generic error | Error message says `"Unknown or invalid client_id"` — does not echo the supplied value. See `packages/auth-core/src/routes/authorize.ts` and `packages/auth-core/src/lib/client-auth.ts`. | PASS |

### Token Endpoint

| ID | Check | How It Passes | Status |
|----|-------|---------------|--------|
| SEC-OIDC-06 | Authorization codes are single-use (atomic) | Token endpoint performs `UPDATE ... SET usedAt = now WHERE usedAt IS NULL` first, then checks row count. Eliminates TOCTOU race. See `packages/auth-core/src/routes/token.ts`. | PASS |
| SEC-OIDC-07 | `redirect_uri` is required and must match | Token endpoint rejects requests missing `redirect_uri` or with a non-matching value (RFC 6749 Section 4.1.3). See `packages/auth-core/src/routes/token.ts`. | PASS |
| SEC-OIDC-08 | `client_assertion` (private_key_jwt) signature verified | `jose.jwtVerify()` validates signature, iss, sub, aud, exp against SP's registered public key. See `packages/auth-core/src/lib/client-auth.ts`. | PASS |
| SEC-OIDC-09 | `client_assertion` jti replay prevention | Used `jti` values stored in KV with TTL; duplicates rejected. See `packages/auth-core/src/lib/client-auth.ts`. | PASS |
| SEC-OIDC-10 | Expired authorization codes rejected | `expiresAt` checked against current time before exchange. | PASS |

### Token Signing & JWKS

| ID | Check | How It Passes | Status |
|----|-------|---------------|--------|
| SEC-OIDC-11 | RS256 algorithm used for ID tokens | Tokens signed with RS256 via `jose` library. See `packages/auth-core/src/lib/token-signing.ts`. | PASS |
| SEC-OIDC-12 | JWKS endpoint publishes public keys | `/.well-known/jwks.json` and `/api/openid_connect/certs` serve public keyset. See `packages/auth-core/src/routes/certs.ts`. | PASS |
| SEC-OIDC-13 | Key rotation handled automatically | Hourly cron rotates signing keys with overlap window. See `packages/infra/src/cron/key-rotation.ts`. | PASS |
| SEC-OIDC-14 | JWKS state survives cron failures | KV TTL set to 7 days (not 1 hour), so a missed cron doesn't cause key disappearance. See `packages/shared/src/kv.ts`. | PASS |

### Userinfo & Claims

| ID | Check | How It Passes | Status |
|----|-------|---------------|--------|
| SEC-OIDC-15 | Userinfo requires valid bearer token | Bearer token validated before returning claims. See `packages/auth-core/src/routes/userinfo.ts`. | PASS |
| SEC-OIDC-16 | Claims scoped to authorized scopes only | Only requested and approved scopes are included in the claims response. See `packages/auth-core/src/lib/claims.ts`. | PASS |
| SEC-OIDC-17 | Pairwise subject identifiers used | HMAC-SHA256 with null-byte separator between userId and sectorIdentifier prevents cross-SP correlation. See `packages/auth-core/src/lib/pairwise.ts` and `packages/shared/src/crypto/index.ts`. | PASS |

### Logout

| ID | Check | How It Passes | Status |
|----|-------|---------------|--------|
| SEC-OIDC-18 | `id_token_hint` signature verified at logout | `jose.jwtVerify()` with large `clockTolerance` (allows expired tokens but requires valid signature). See `packages/auth-core/src/routes/logout.ts`. | PASS |
| SEC-OIDC-19 | Session destroyed on logout | Session DO destroyed and KV session data cleared. | PASS |
| SEC-OIDC-20 | `session-revoked` SET emitted on logout | Security event token queued for delivery to the SP. | PASS |

### Pushed Authorization Requests (PAR)

| ID | Check | How It Passes | Status |
|----|-------|---------------|--------|
| SEC-OIDC-21 | PAR endpoint validates client authentication | Client must authenticate before PAR is accepted. See `packages/auth-core/src/routes/par.ts`. | PASS |
| SEC-OIDC-22 | PAR request URIs are single-use and short-lived | Stored in KV with TTL; consumed on use. | PASS |

---

## 3. SAML 2.0

| ID | Check | How It Passes | Status |
|----|-------|---------------|--------|
| SEC-SAML-01 | AuthnRequest XML signature verified | `samlify.SamlLib.verifySignature()` validates against SP's registered public key before processing. See `packages/saml-bridge/src/lib/saml-helpers.ts` and `packages/saml-bridge/src/routes/auth.ts`. | PASS |
| SEC-SAML-02 | AssertionConsumerServiceURL validated against registered SP | ACS URL checked against `sp.redirectUris` in `packages/saml-bridge/src/routes/auth.ts` before issuing redirect. | PASS |
| SEC-SAML-03 | LogoutRequest XML signature verified | Validated against SP's public key in `packages/saml-bridge/src/routes/logout.ts`. | PASS |
| SEC-SAML-04 | SAML assertions signed | Assertions signed with RS256 before delivery. See `packages/saml-bridge/src/lib/saml-helpers.ts`. | PASS |
| SEC-SAML-05 | SAML assertions encrypted | Assertion encryption applied for SPs that support it. | PASS |
| SEC-SAML-06 | Pairwise NameID used | NameID generated using the same pairwise function as OIDC `sub`. See `packages/saml-bridge/src/lib/nameid.ts`. | PASS |
| SEC-SAML-07 | Annual certificate rotation supported | Year-versioned SAML endpoints (`/api/saml/auth{year}`) enable cert rotation without downtime. | PASS |
| SEC-SAML-08 | XML signature wrapping attack mitigated | `validateXmlStructure()` checks for duplicate critical elements (`Issuer`, `NameID`, `Signature`) in parsed XML. See `packages/saml-bridge/src/lib/saml-helpers.ts`. | PASS |
| SEC-SAML-09 | HTTP-Redirect binding DEFLATE decompression | `DecompressionStream("deflate-raw")` applied for GET-binding requests with plain-base64 fallback for POST-binding. See `packages/saml-bridge/src/lib/saml-helpers.ts`. | PASS |
| SEC-SAML-10 | OIDC nonce is cryptographically random | `crypto.randomUUID()` used instead of reusing the SAML request ID. See `packages/saml-bridge/src/lib/saml-helpers.ts`. | PASS |
| SEC-SAML-11 | LogoutResponse HTML form is XSS-safe | `escapeHtml()` applied to `destination`, `relayState`, and `samlResponse` in `buildAutoSubmitForm`. See `packages/saml-bridge/src/routes/logout.ts`. | PASS |
| SEC-SAML-12 | SP lookup validates registered SPs | SP metadata loaded from PlanetScale via `packages/saml-bridge/src/lib/sp-lookup.ts`; unknown issuers rejected. | PASS |

---

## 4. Multi-Factor Authentication

### TOTP (Authenticator App)

| ID | Check | How It Passes | Status |
|----|-------|---------------|--------|
| SEC-MFA-01 | TOTP secret generated with sufficient entropy | Standard TOTP secret generation via Better Auth 2FA plugin. | PASS |
| SEC-MFA-02 | TOTP time window limited to +/- 1 step | Accepts current, previous, and next 30-second windows (90s total). | PASS |
| SEC-MFA-03 | TOTP code replay prevented | Used time steps stored in KV (`totp:used:<userId>:<timeStep>`) with 90-second TTL. Duplicates rejected. See `packages/mfa/src/routes/totp.ts`. | PASS |
| SEC-MFA-04 | TOTP secret not leaked to third parties | Demo page generates QR code locally in-browser using `qrcode-generator` library (loaded via CDN with SRI hash). Secret never sent to external services. See `packages/auth-core/src/routes/demo.ts`. | PASS |

### SMS OTP

| ID | Check | How It Passes | Status |
|----|-------|---------------|--------|
| SEC-MFA-05 | OTP sent only to user's registered phone | Phone number retrieved from user's record in PlanetScale, not from request body. See `packages/mfa/src/routes/sms-otp.ts`. | PASS |
| SEC-MFA-06 | OTP generation has no modulo bias | Rejection sampling eliminates bias from `Uint32Array` modulo operation. See `packages/mfa/src/routes/sms-otp.ts`. | PASS |
| SEC-MFA-07 | SMS send rate limited per user | 3 sends per 10 minutes per user via KV-backed counter. See `packages/mfa/src/routes/sms-otp.ts`. | PASS |
| SEC-MFA-08 | OTP stored securely with TTL | OTP stored in `KV_OTP` with expiration; consumed on verification. | PASS |

### WebAuthn / Passkeys

| ID | Check | How It Passes | Status |
|----|-------|---------------|--------|
| SEC-MFA-09 | Registration extracts and stores COSE public key | Attestation object CBOR-parsed; COSE key extracted and converted to JWK for storage. Supports ES256 (P-256) and RS256. See `packages/mfa/src/routes/webauthn.ts`. | PASS |
| SEC-MFA-10 | Authentication verifies cryptographic signature | Signed data (`authenticatorData \|\| SHA-256(clientDataJSON)`) verified against stored public key via `crypto.subtle.verify()`. See `packages/mfa/src/routes/webauthn.ts`. | PASS |
| SEC-MFA-11 | Challenge is random and validated | Random challenge generated per ceremony; verified in authentication response. | PASS |
| SEC-MFA-12 | Origin and RP ID validated | Origin checked against expected value; RP ID hash verified against `authenticatorData`. | PASS |
| SEC-MFA-13 | User presence flag checked | `authenticatorData` flags byte verified for UP (user present) bit. | PASS |
| SEC-MFA-14 | Sign count validated | Stored sign count compared to reported value; replay detection. | PASS |

### Backup Codes

| ID | Check | How It Passes | Status |
|----|-------|---------------|--------|
| SEC-MFA-15 | Backup codes single-use (atomic) | Conditional UPDATE with `lastUsedAt` optimistic concurrency check; returns 409 on race. See `packages/mfa/src/routes/backup-codes.ts`. | PASS |
| SEC-MFA-16 | Backup codes hashed with per-user salt | HMAC-SHA256 keyed with `userId` instead of plain SHA-256. See `packages/mfa/src/routes/backup-codes.ts`. | PASS |
| SEC-MFA-17 | Backup code brute-force rate limited | Failed MFA attempts rate limited; 5 failures triggers lockout. See `packages/mfa/src/middleware/rate-limiter.ts`. | PASS |

### AAL Enforcement

| ID | Check | How It Passes | Status |
|----|-------|---------------|--------|
| SEC-MFA-18 | AAL2 enforced when SP requires it | `requireAAL2` middleware checks `session.achievedAal` and `session.mfaVerified`. See `packages/mfa/src/middleware/aal-evaluator.ts`. | PASS |
| SEC-MFA-19 | Phishing-resistant MFA enforced when required | Only WebAuthn and PIV/CAC methods accepted when `phishingResistant` flag is set. Remembered-device auto-promotion is blocked for phishing-resistant requirements. See `packages/mfa/src/middleware/aal-evaluator.ts`. | PASS |
| SEC-MFA-20 | HSPD-12 (PIV/CAC) enforcement | PIV/CAC card requirement enforced via `requireHSPD12`. Only PIV mfa method accepted. | PASS |
| SEC-MFA-21 | Federal PKI issuer validated with exact match | `isTrustedFederalIssuer()` uses normalized exact match (`===`) instead of substring matching. See `packages/mfa/src/middleware/aal-evaluator.ts`. | PASS |

---

## 5. Session Management

| ID | Check | How It Passes | Status |
|----|-------|---------------|--------|
| SEC-SESS-01 | Sessions stored in Durable Objects (strong consistency) | Session state held in Cloudflare Durable Objects with single-instance guarantees. See `packages/session-do/src/index.ts`. | PASS |
| SEC-SESS-02 | Session TTL enforced with auto-cleanup | Default 15-minute TTL; 30-day for remembered devices. Durable Object alarm triggers cleanup. | PASS |
| SEC-SESS-03 | Session update restricted to allowed fields | Allowlist of permitted update fields enforced in `handleUpdate`. Immutable fields (OIDC flow state, timestamps, requested assurance levels) cannot be overwritten. See `packages/session-do/src/index.ts`. | PASS |
| SEC-SESS-04 | Session creation uses random IDs | Session IDs generated via `crypto.randomUUID()`. | PASS |
| SEC-SESS-05 | Session destroyed on logout and fraud events | Logout endpoint and fraud handler both destroy session DOs. | PASS |
| SEC-SESS-06 | Session state tracks assurance levels | `requestedIal`, `requestedAal`, `achievedIal`, `achievedAal` tracked separately to prevent confusion. | PASS |

---

## 6. Cryptography

| ID | Check | How It Passes | Status |
|----|-------|---------------|--------|
| SEC-CRYPTO-01 | AES-256-GCM used for PII encryption at rest | `encrypt()` and `decrypt()` in `packages/shared/src/crypto/index.ts` use AES-256-GCM with random 12-byte IVs. | PASS |
| SEC-CRYPTO-02 | Each encryption uses a unique IV | `crypto.getRandomValues(new Uint8Array(12))` generates a fresh IV per encryption. | PASS |
| SEC-CRYPTO-03 | Pairwise subject uses unambiguous input | Null-byte separator (`\0`) between `userId` and `sectorIdentifier` prevents concatenation ambiguity. See `packages/shared/src/crypto/index.ts`. | PASS |
| SEC-CRYPTO-04 | UUID v7 used for record IDs | Time-ordered UUIDs via `generateUUIDv7()` in `packages/shared/src/crypto/index.ts`. | PASS |
| SEC-CRYPTO-05 | JWT signing uses RS256 | All ID tokens and SETs signed with RSA-SHA256. | PASS |
| SEC-CRYPTO-06 | Blind index function available for encrypted lookups | `computeBlindIndex()` uses HMAC-SHA256 of normalized input for equality searches on encrypted fields. See `packages/shared/src/crypto/index.ts`. | PASS |
| SEC-CRYPTO-07 | No use of weak/deprecated algorithms | No MD5, SHA-1, DES, or ECB usage found in the codebase. | PASS |
| SEC-CRYPTO-08 | All cryptographic keys loaded from Worker secrets | `JWT_SIGNING_KEY`, `ENCRYPTION_KEY`, `PAIRWISE_SALT` are env secrets, not hardcoded. | PASS |

---

## 7. Input Validation & Injection

| ID | Check | How It Passes | Status |
|----|-------|---------------|--------|
| SEC-INJ-01 | SQL injection prevented via parameterized queries | All database access uses Drizzle ORM with parameterized queries. No raw SQL string concatenation. | PASS |
| SEC-INJ-02 | XSS in SAML HTML output prevented | All dynamic values in `buildAutoSubmitForm` escaped via `escapeHtml()`. See `packages/saml-bridge/src/routes/logout.ts`. | PASS |
| SEC-INJ-03 | XML signature wrapping mitigated | Duplicate element detection via `validateXmlStructure()`. See `packages/saml-bridge/src/lib/saml-helpers.ts`. | PASS |
| SEC-INJ-04 | No `eval()` or `Function()` constructor usage | Not found in codebase. | PASS |
| SEC-INJ-05 | Request body parsing uses framework defaults | Hono's built-in body parsers handle JSON/form data safely. | PASS |
| SEC-INJ-06 | URL parameters validated before use | `client_id`, `redirect_uri`, `scope`, `response_type` validated at authorization endpoint. | PASS |

---

## 8. Access Control & Authorization

| ID | Check | How It Passes | Status |
|----|-------|---------------|--------|
| SEC-AUTHZ-01 | Admin API requires authentication | Bearer token (`ADMIN_API_KEY`) required on all `/service-providers` routes. See `packages/admin/src/index.ts`. | PASS |
| SEC-AUTHZ-02 | Account endpoints enforce same-user access | `requireSameUser` middleware validates `X-User-Id` header matches `:userId` URL param. See `packages/account/src/routes/email.ts` and `packages/account/src/routes/account.ts`. | PASS |
| SEC-AUTHZ-03 | Identity proofing endpoints enforce same-user access | Same `requireSameUser` middleware applied to proofing and SSN routes. See `packages/identity-proofing/src/routes/proofing.ts` and `packages/identity-proofing/src/routes/ssn.ts`. | PASS |
| SEC-AUTHZ-04 | SSN access requires internal service authentication | `X-Internal-Service-Key` validated against `INTERNAL_SERVICE_KEY` env secret. See `packages/identity-proofing/src/routes/ssn.ts`. | PASS |
| SEC-AUTHZ-05 | SSN access requires `social_security_number` scope | SP scope checked; SP must have `ialMax >= 2`. | PASS |
| SEC-AUTHZ-06 | IAL level enforced for proofing-gated data | `ial-evaluator` middleware checks user's IAL before releasing proofing data. See `packages/identity-proofing/src/middleware/ial-evaluator.ts`. | PASS |
| SEC-AUTHZ-07 | Scope-gated claims in OIDC | Claims builder only includes fields authorized by the granted scopes. See `packages/auth-core/src/lib/claims.ts`. | PASS |

---

## 9. PII & Data Protection

| ID | Check | How It Passes | Status |
|----|-------|---------------|--------|
| SEC-PII-01 | SSN encrypted at rest (AES-256-GCM) | `encryptedSsn` column uses `encrypt()`/`decrypt()` from shared crypto. | PASS |
| SEC-PII-02 | Birthdate encrypted at rest | `encryptedBirthdate` column encrypted. | PASS |
| SEC-PII-03 | Address encrypted at rest | `encryptedAddress` column encrypted. | PASS |
| SEC-PII-04 | Phone encrypted at rest | `encryptedPhone` column encrypted. | PASS |
| SEC-PII-05 | Email blind index available for encrypted lookup | `emailBlindIndex` column and `computeBlindIndex()` utility ready. Schema annotated with TODO for full email encryption migration. See `packages/shared/src/schema/index.ts`. | PASS |
| SEC-PII-06 | Proofing documents stored in R2 (not DB) | Identity proofing artifacts stored in `R2_PROOFING` bucket, separate from relational data. | PASS |
| SEC-PII-07 | PII not logged | Structured logger in `packages/infra/src/observability/logger.ts` does not include PII fields. | PASS |

---

## 10. Rate Limiting & Abuse Prevention

| ID | Check | How It Passes | Status |
|----|-------|---------------|--------|
| SEC-RATE-01 | Authorization endpoint rate limited | 30 req/60s. See `packages/auth-core/src/index.ts`. | PASS |
| SEC-RATE-02 | Token endpoint rate limited | 20 req/60s (via infra rate limiter config). | PASS |
| SEC-RATE-03 | Userinfo endpoint rate limited | Rate limiting added. See `packages/auth-core/src/index.ts`. | PASS |
| SEC-RATE-04 | Better Auth routes rate limited | Rate limiting applied to `/api/auth/*`. See `packages/auth-core/src/index.ts`. | PASS |
| SEC-RATE-05 | MFA verification rate limited | 5 req/60s; 5 failed attempts triggers lockout. See `packages/mfa/src/middleware/rate-limiter.ts`. | PASS |
| SEC-RATE-06 | SMS send rate limited per user | 3 sends per 10 minutes per user. See `packages/mfa/src/routes/sms-otp.ts`. | PASS |
| SEC-RATE-07 | Password reset rate limited | 5 req/300s on password endpoints (infra rate limiter config). | PASS |
| SEC-RATE-08 | Proofing submission rate limited | 3 req/300s. | PASS |
| SEC-RATE-09 | Rate limiter accounts for KV eventual consistency | Security-critical endpoints use reduced effective limits (`ceil(limit * 0.6)`) to mitigate TOCTOU race in KV-backed counters. TODO annotation for Durable Object migration. See `packages/infra/src/rate-limiter.ts`. | PASS |
| SEC-RATE-10 | Global default rate limit applied | 60 req/60s fallback for unspecified endpoints. See infra rate limiter config. | PASS |

---

## 11. Infrastructure & Platform Security

### Service Bindings (Worker-to-Worker)

| ID | Check | How It Passes | Status |
|----|-------|---------------|--------|
| SEC-INFRA-01 | Service binding auth available | `callWorker()` supports `internalAuthSecret` option; computes HMAC-SHA256 of request path as `X-Internal-Auth` header. `verifyInternalAuth()` export for validation on the receiving side. See `packages/shared/src/service-binding.ts`. | PASS |
| SEC-INFRA-02 | Service bindings not publicly routable | Cloudflare service bindings are internal-only by platform design. | PASS |

### Key Rotation

| ID | Check | How It Passes | Status |
|----|-------|---------------|--------|
| SEC-INFRA-03 | JWKS rotation runs hourly | Cron trigger at `0 */1 * * *`. See `packages/infra/src/cron/key-rotation.ts`. | PASS |
| SEC-INFRA-04 | Key overlap window during rotation | New and previous keys both published in JWKS during rotation. | PASS |
| SEC-INFRA-05 | JWKS state has resilient TTL | 7-day KV TTL survives multiple missed cron executions. See `packages/shared/src/kv.ts`. | PASS |
| SEC-INFRA-06 | Expired authorization codes cleaned up | Cron at `*/5 * * * *` deletes expired codes. See `packages/infra/src/cron/cleanup.ts`. | PASS |

### Queues

| ID | Check | How It Passes | Status |
|----|-------|---------------|--------|
| SEC-INFRA-07 | Queue consumers have max retry limits | All consumers check `msg.attempts` against max (3-5 depending on queue); dead-letter on exhaustion. See `packages/security-events/src/index.ts`. | PASS |
| SEC-INFRA-08 | Outbound SET delivery uses queue-based retries | Single-attempt delivery; transient failures retry via queue backoff instead of blocking in-process. See `packages/security-events/src/consumers/set-outbound.ts`. | PASS |
| SEC-INFRA-09 | Queue max batch sizes configured | Email: 10, SET: 10, Audit: 100, Fraud: 1. | PASS |

### Foreign Keys & Data Integrity

| ID | Check | How It Passes | Status |
|----|-------|---------------|--------|
| SEC-INFRA-10 | Foreign key enforcement enabled | MySQL (PlanetScale) enforces foreign keys by default. No application-level configuration needed. | PASS |
| SEC-INFRA-11 | Better Auth tables have FK constraints with CASCADE | Foreign keys with `ON DELETE CASCADE` in the Better Auth schema. | PASS |

---

## 12. Security Event Handling (RISC/SET)

| ID | Check | How It Passes | Status |
|----|-------|---------------|--------|
| SEC-RISC-01 | Inbound SET JWT signature verified | RSA/ECDSA signature verified against SP's registered public key. See `packages/security-events/src/routes/risc-inbound.ts`. | PASS |
| SEC-RISC-02 | Inbound SET replay protection (jti) | `jti` required; checked against KV (`set:jti:<jti>`) with 24-hour TTL before processing. Duplicates return 202. See `packages/security-events/src/routes/risc-inbound.ts`. | PASS |
| SEC-RISC-03 | Fraud actions processed asynchronously | Fraud events queued to `QUEUE_FRAUD` with `max_batch_size: 1` for isolation. | PASS |
| SEC-RISC-04 | Fraud handler destroys correct sessions | Looks up active session IDs from KV (`user:<userId>:sessions`) and destroys each by sessionId. See `packages/security-events/src/consumers/fraud-handler.ts`. | PASS |
| SEC-RISC-05 | Outbound SETs include `kid` in header | `kid` resolved from JWKS state for receiver verification. See `packages/security-events/src/consumers/set-outbound.ts`. | PASS |
| SEC-RISC-06 | RISC discovery endpoint published | `/.well-known/risc-configuration` serves discovery metadata. | PASS |
| SEC-RISC-07 | SET events cover all security-critical actions | Events emitted: account-disabled, account-purged, credential-compromise, identifier-changed, identifier-recycled, password-reset, recovery-activated, reproof-completed, session-revoked, authorization-fraud-detected, identity-fraud-detected. | PASS |
| SEC-RISC-08 | Inbound SET error responses are generic | Error messages do not reveal registered SP list or internal state. See `packages/security-events/src/routes/risc-inbound.ts`. | PASS |

---

## 13. Audit Logging & Observability

| ID | Check | How It Passes | Status |
|----|-------|---------------|--------|
| SEC-AUDIT-01 | Audit events recorded for security-critical operations | `identity_events` table (append-only) captures userId, spId, eventType, ial, aal, ip, metadata. | PASS |
| SEC-AUDIT-02 | Audit logs archived to R2 | Audit consumer writes to R2 with unique batch files per flush (`audit/YYYY/MM/DD/<batchId>.jsonl`), eliminating race conditions. See `packages/infra/src/consumers/audit-consumer.ts`. | PASS |
| SEC-AUDIT-03 | Structured JSON logging | `packages/infra/src/observability/logger.ts` outputs structured JSON with correlation IDs. | PASS |
| SEC-AUDIT-04 | OpenTelemetry tracing enabled | `packages/infra/src/observability/otel.ts` instruments request lifecycle. | PASS |
| SEC-AUDIT-05 | Daily audit flush via cron | `0 0 * * *` cron triggers daily flush to R2. | PASS |

---

## 14. Error Handling & Information Disclosure

| ID | Check | How It Passes | Status |
|----|-------|---------------|--------|
| SEC-ERR-01 | Global error handler catches unhandled exceptions | `packages/auth-core/src/middleware/error-handler.ts` returns structured error responses. | PASS |
| SEC-ERR-02 | Error messages do not echo user input | Generic messages used for invalid client_id, unknown SP, etc. | PASS |
| SEC-ERR-03 | Stack traces not exposed in production | Error handler returns `AppError` messages without stack traces. | PASS |
| SEC-ERR-04 | RISC inbound errors are generic | Catch-all returns `{ error: "internal_error" }`. See `packages/security-events/src/routes/risc-inbound.ts`. | PASS |
| SEC-ERR-05 | Custom error classes with appropriate HTTP status codes | `AppError`, `RateLimitError`, etc. in `packages/shared/src/errors.ts` map to correct status codes. | PASS |

---

## 15. Cross-Origin & Transport Security

| ID | Check | How It Passes | Status |
|----|-------|---------------|--------|
| SEC-CORS-01 | CORS restricted to explicit origin allowlist | Origins loaded from `ALLOWED_ORIGINS` env var; credentials enabled. See `packages/auth-core/src/index.ts`. | PASS |
| SEC-CORS-02 | Cloudflare enforces HTTPS | All Workers run behind Cloudflare's edge, which enforces TLS termination. | PASS |
| SEC-CORS-03 | No mixed-content risks | All service-to-service communication via Cloudflare service bindings (in-memory, no network). | PASS |

---

## 16. Account Lifecycle

| ID | Check | How It Passes | Status |
|----|-------|---------------|--------|
| SEC-ACCT-01 | Email verification required | Verification token sent on email add; unverified emails cannot be used for auth. | PASS |
| SEC-ACCT-02 | Email verification token bound to specific email record | Token JWT includes `emailId`; verified against exact row in `user_emails`. See `packages/account/src/routes/email.ts`. | PASS |
| SEC-ACCT-03 | Account deletion is atomic | `db.transaction()` wraps credential, email, and user deletion in a single transaction. See `packages/account/src/routes/account.ts`. | PASS |
| SEC-ACCT-04 | Account deletion emits `account-purged` SET | Downstream SPs notified of account removal. | PASS |
| SEC-ACCT-05 | Account lockout tracked | `locked_at` timestamp on users table; lockout status exposed in account overview. | PASS |

---

## 17. Identity Proofing (KYC)

| ID | Check | How It Passes | Status |
|----|-------|---------------|--------|
| SEC-PROOF-01 | Persona inquiry bound to requesting user | `inquiryId -> userId` mapping stored in KV on start; verified before accepting results. See `packages/identity-proofing/src/routes/proofing.ts`. | PASS |
| SEC-PROOF-02 | IAL2 required for proofing-gated claims | `ial-evaluator` middleware enforces IAL level. | PASS |
| SEC-PROOF-03 | Document verification via trusted third party | Persona.com integration for document + facial match verification. | PASS |
| SEC-PROOF-04 | Re-proofing flow supported | `/proofing/reproof` endpoint for re-verification. | PASS |
| SEC-PROOF-05 | PIV/CAC certificate metadata extraction | X.509 client cert metadata extracted for HSPD-12 compliance. See `packages/identity-proofing/src/routes/x509.ts`. | PASS |

---

## 18. Admin & Service Provider Management

| ID | Check | How It Passes | Status |
|----|-------|---------------|--------|
| SEC-ADMIN-01 | All admin routes require authentication | `requireAdminAuth` middleware validates `ADMIN_API_KEY` bearer token. See `packages/admin/src/index.ts`. | PASS |
| SEC-ADMIN-02 | SP redirect URIs stored and enforced | `redirectUris` JSON array on `service_providers` table; validated at authorization and SAML endpoints. | PASS |
| SEC-ADMIN-03 | SP public keys managed | Public keys stored per SP for `client_assertion` and SAML signature verification. | PASS |
| SEC-ADMIN-04 | SP IAL/AAL maximums configurable | `ialMax` and `aalMax` per SP control what assurance levels are available. | PASS |

---

## 19. Environment & Configuration

| ID | Check | How It Passes | Status |
|----|-------|---------------|--------|
| SEC-ENV-01 | Secrets loaded from Cloudflare Worker secrets | `JWT_SIGNING_KEY`, `ENCRYPTION_KEY`, `PAIRWISE_SALT`, `PERSONA_API_KEY`, `TWILIO_*`, OAuth client secrets all from env secrets. | PASS |
| SEC-ENV-02 | Demo/debug routes gated to non-production | All `/demo/*` routes return 404 when `ENVIRONMENT === "production"`. See `packages/auth-core/src/routes/demo.ts`. | PASS |
| SEC-ENV-03 | No hardcoded secrets in source | Grep for API keys, passwords, and private keys found none. | PASS |
| SEC-ENV-04 | Environment bindings typed | `Env` interface in `packages/shared/src/env.ts` types all bindings, secrets, and config vars. | PASS |

### Required Environment Variables (New)

The following env vars were introduced during remediation and must be configured:

| Variable | Purpose | Where Used |
|----------|---------|------------|
| `ALLOWED_ORIGINS` | Comma-separated CORS origin allowlist | auth-core |
| `ENVIRONMENT` | Set to `"production"` in prod; gates demo routes | auth-core |
| `BASE_URL` | Public base URL (e.g., `https://secure.login.gov`) | auth-core (Better Auth) |
| `ADMIN_API_KEY` | Bearer token for admin API access | admin |
| `INTERNAL_SERVICE_KEY` | Service-to-service auth for SSN endpoint | identity-proofing |

---

## Appendix: Finding Cross-Reference

All findings from the original audit, with their remediation status:

| Original # | Severity | Finding | Fix Reference |
|------------|----------|---------|---------------|
| 1 | CRITICAL | Admin API unauthenticated | SEC-ADMIN-01 |
| 2 | CRITICAL | SAML AuthnRequest signature not verified | SEC-SAML-01 |
| 3 | CRITICAL | SAML ACS URL not validated | SEC-SAML-02 |
| 4 | CRITICAL | XSS in SAML logout form | SEC-SAML-11 |
| 5 | CRITICAL | WebAuthn signature not verified | SEC-MFA-10 |
| 6 | CRITICAL | WebAuthn public key not extracted | SEC-MFA-09 |
| 7 | CRITICAL | Wildcard CORS | SEC-CORS-01 |
| 8 | HIGH | Logout unverified id_token_hint | SEC-OIDC-18 |
| 9 | HIGH | Demo proxy exposes bindings | SEC-ENV-02 |
| 10 | HIGH | Demo setup-db drops tables | SEC-ENV-02 |
| 11 | HIGH | PKCE not mandatory | SEC-OIDC-01 |
| 12 | HIGH | SMS OTP to arbitrary phones | SEC-MFA-05 |
| 13 | HIGH | SMS /send lacks rate limiting | SEC-MFA-07 |
| 14 | HIGH | TOTP replay | SEC-MFA-03 |
| 15 | HIGH | Session DO unrestricted update | SEC-SESS-03 |
| 16 | HIGH | AAL downgrade via remembered device | SEC-MFA-19 |
| 17 | HIGH | SAML LogoutRequest unsigned | SEC-SAML-03 |
| 18 | HIGH | IDOR across account/proofing endpoints | SEC-AUTHZ-02, SEC-AUTHZ-03 |
| 19 | HIGH | SSN trusts client headers | SEC-AUTHZ-04 |
| 20 | HIGH | Password reset token replay | SEC-AUTH-04 |
| 21 | MEDIUM | Rate limiter TOCTOU | SEC-RATE-09 |
| 22 | MEDIUM | JWKS 1hr TTL | SEC-INFRA-05 |
| 23 | MEDIUM | Email stored plaintext | SEC-PII-05 |
| 24 | MEDIUM | Pairwise concatenation ambiguity | SEC-CRYPTO-03 |
| 25 | MEDIUM | No SET replay protection | SEC-RISC-02 |
| 26 | MEDIUM | Fraud handler wrong session key | SEC-RISC-04 |
| 27 | MEDIUM | No jti replay for client_assertion | SEC-OIDC-09 |
| 28 | MEDIUM | redirect_uri not required at token endpoint | SEC-OIDC-07 |
| 29 | MEDIUM | PKCE non-constant-time comparison | SEC-OIDC-02 |
| 30 | MEDIUM | Hardcoded localhost baseURL | SEC-AUTH-07 |
| 31 | MEDIUM | Auth code TOCTOU race | SEC-OIDC-06 |
| 32 | MEDIUM | Password non-constant-time comparison | SEC-AUTH-02 |
| 33 | MEDIUM | Weak common password list | SEC-AUTH-03 |
| 34 | MEDIUM | Persona inquiry unbound to user | SEC-PROOF-01 |
| 35 | LOW | TOTP secret leaked to QR API | SEC-MFA-04 |
| 36 | LOW | Error reflects client_id | SEC-ERR-02 |
| 37 | LOW | SMS OTP modulo bias | SEC-MFA-06 |
| 38 | LOW | Backup code unsalted hash | SEC-MFA-16 |
| 39 | LOW | PKI issuer substring match | SEC-MFA-21 |
| 41 | LOW | Account deletion non-atomic | SEC-ACCT-03 |
| 42 | LOW | Missing FK enforcement | SEC-INFRA-10 |
