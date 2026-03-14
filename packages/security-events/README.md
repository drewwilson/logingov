# @logingov/security-events

RISC (Risk and Incident Sharing and Coordination) Worker for Login.gov. Implements the OpenID RISC profile for inbound Security Event Token (SET) validation, outbound SET delivery, and fraud action processing. Built on Cloudflare Workers + Hono.

## Routes

### `POST /api/risc/security_events` — Inbound SET submission

Accepts a signed JWT (`application/secevent+jwt`) from a relying party. The Worker:

1. Decodes the JWT to extract the issuer (`iss`)
2. Looks up the SP's public key in PlanetScale and verifies the signature (RS256, via `jose`)
3. Writes each event to the `identity_events` table
4. For fraud-related events, publishes an action message to `QUEUE_FRAUD`

Returns `202 Accepted` per RFC 8935 on success.

**Supported inbound event types:**

| Event | Fraud action |
|---|---|
| `authorization-fraud-detected` | Force password reset, invalidate sessions |
| `identity-fraud-detected` | Reset IAL to 1, clear verified PII, lock account, emit `account-disabled` SET |
| `credential-compromise` | Force password reset |

### `GET /.well-known/risc-configuration` — RISC discovery

Returns the RISC configuration document (RFC 8935 / OpenID RISC Profile) describing supported and delivered event types, JWKS URI, and push delivery endpoint. Cached in KV.

## Queue consumers

The Worker's `queue()` handler processes two message types:

### `set:fraud-action` (from `QUEUE_FRAUD`)

Executes fraud remediation actions against the user's account in PlanetScale and invalidates sessions via the Session Durable Object. Actions: `force_password_reset`, `reset_ial`, `disable_account`.

### `set:outbound` (from `QUEUE_SET`)

Signs a SET JWT with Login.gov's private key and POSTs it to the SP's `push_notification_url`. Retries up to 5 times with exponential backoff (1s, 2s, 4s, 8s, 16s).

## SET emitters

Exported helper functions that other packages call to enqueue outbound SETs when user lifecycle events occur:

- **`emitAccountDisabled`** — account locked
- **`emitAccountPurged`** — account deleted
- **`emitPasswordReset`** — password changed or reset
- **`emitIdentifierChanged`** — email address changed
- **`emitIdentifierRecycled`** — email removed/recycled

Each emitter looks up the SP's push URL from PlanetScale, builds a queue message via `set-builder`, and sends it to `QUEUE_SET`.

## Service binding

Called from `auth-core` as the `SECURITY_EVENTS` service binding.

## Local development

```sh
pnpm dev:security
```

Run from the monorepo root.
