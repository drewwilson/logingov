# @logingov/mfa

Multi-factor authentication Worker for the Login.gov cloud-native rebuild. Provides MFA challenge, verification, and session-upgrade endpoints for four MFA methods, plus middleware to enforce assurance-level requirements.

## Supported MFA Methods

| Method | Route prefix | Description |
|---|---|---|
| **TOTP** | `/mfa/totp/*` | Authenticator app (Google Authenticator, Authy, etc.). HMAC-SHA1, 6-digit codes, 30-second window with +/-1 drift tolerance. |
| **WebAuthn / Passkeys** | `/mfa/webauthn/*` | Hardware security keys and platform authenticators. WebAuthn Level 2, rpID `login.gov`. Supports ES256 and RS256. |
| **SMS OTP** | `/mfa/sms/*` | Phone-based one-time codes. 6-digit code stored in KV with 10-minute TTL, delivered via a queue message to the Twilio consumer. |
| **Backup Codes** | `/mfa/backup-codes/*` | 10 single-use 8-character codes (SHA-256 hashed, encrypted at rest). Ambiguous characters excluded. |

## Routes

### Per-method endpoints

**TOTP**
- `POST /mfa/totp/setup` -- Generate TOTP secret and `otpauth://` URI for QR scanning.
- `POST /mfa/totp/verify` -- Verify a 6-digit TOTP code; upgrades session to AAL2.

**WebAuthn**
- `POST /mfa/webauthn/register/options` -- Generate `PublicKeyCredentialCreationOptions`.
- `POST /mfa/webauthn/register/verify` -- Verify registration response; store credential.
- `POST /mfa/webauthn/authenticate/options` -- Generate `PublicKeyCredentialRequestOptions`.
- `POST /mfa/webauthn/authenticate/verify` -- Verify assertion; upgrades session to AAL2.

**SMS OTP**
- `POST /mfa/sms/send` -- Generate OTP, store in `KV_OTP`, publish to `QUEUE_EMAIL` for Twilio delivery.
- `POST /mfa/sms/verify` -- Verify OTP from KV; upgrades session to AAL2.

**Backup Codes**
- `POST /mfa/backup-codes/generate` -- Generate 10 codes (replaces any existing set).
- `POST /mfa/backup-codes/verify` -- Verify a backup code (single-use); upgrades session to AAL2.
- `GET  /mfa/backup-codes/count` -- Return count of remaining unused codes.

### Session-level endpoints

- `GET /mfa/challenge` -- Returns the user's configured MFA methods and which ones satisfy the current session's requirements (AAL2, phishing-resistant, HSPD-12).
- `GET /mfa/status` -- Returns the session's current MFA verification state, achieved AAL, and policy flags.
- `GET /health` -- Health check.

## Middleware

### AAL Evaluator (`src/middleware/aal-evaluator.ts`)

Reads session state from the `SESSION_DO` Durable Object and enforces assurance-level policies:

- **`loadSession()`** -- Loads session from DO onto the Hono context. Used by MFA challenge/verify routes themselves (no enforcement).
- **`requireAAL2()`** -- Returns 403 with a redirect hint to `/mfa/challenge` if the session requires AAL2 and MFA is not yet verified. Honors remembered devices.
- **`requirePhishingResistant()`** -- Rejects TOTP and SMS sessions; only WebAuthn and PIV/CAC are accepted.
- **`requireHSPD12()`** -- Requires x509 certificate from a trusted Federal PKI issuer (FPCA G2, DoD Root CAs, etc.).

Also exports `getSessionFromDO()` and `updateSessionDO()` helpers for other Workers.

### Rate Limiter (`src/middleware/rate-limiter.ts`)

KV-based failed-attempt counter with PlanetScale account lockout:

- **`checkMfaRateLimit()`** -- Middleware that checks `KV_RATE_LIMIT` and `users.locked_at` before allowing a verification attempt.
- **`recordFailedAttempt()`** -- Increments the counter (15-minute sliding window). Locks the account in PlanetScale after 5 failures.
- **`clearRateLimit()`** -- Clears the counter on successful verification.

All verification routes (`/verify`) apply both `loadSession()` and `checkMfaRateLimit()`. A global rate limiter also caps requests at 10 per 60 seconds across all `/mfa/*` routes.

## Integration with auth-core

This Worker is called from `auth-core` as the **`MFA_WORKER`** service binding. The auth-core Worker delegates MFA challenge selection and verification to this Worker over the service binding, forwarding `X-User-Id`, `X-User-Email`, `X-Session-Id`, and `X-Trace-Id` headers.

The AAL evaluator middleware and rate-limiter functions are also exported from this package so other Workers can import them directly:

```ts
import { requireAAL2, requirePhishingResistant, requireHSPD12 } from "@logingov/mfa";
import { checkMfaRateLimit, recordFailedAttempt, clearRateLimit } from "@logingov/mfa";
```

## Bindings

| Binding | Type | Purpose |
|---|---|---|
| `DB` | PlanetScale (MySQL 8) | Credentials and user tables (Drizzle ORM) |
| `KV_OTP` | KV | Temporary OTP codes and WebAuthn challenges |
| `KV_RATE_LIMIT` | KV | Failed-attempt counters |
| `QUEUE_EMAIL` | Queue | SMS delivery via Twilio consumer |
| `SESSION_DO` | Durable Object | Session state (AAL, MFA status) |
| `ENCRYPTION_KEY` | Secret | AES key for encrypting credential data at rest |

## Local Development

From the monorepo root:

```sh
pnpm dev:mfa
```
