# @logingov/account

Account management Cloudflare Worker for Login.gov. Handles email management, password lifecycle, and account deletion. Built with Hono and Drizzle ORM on PlanetScale (MySQL 8 / Vitess).

## Features

- **Email management** -- add, remove, list, and set primary email address
- **Email verification** -- signed JWT tokens (HMAC-SHA256, 24h expiry) sent via queue
- **Password set** -- initial password creation during registration
- **Password change** -- authenticated change with current-password verification
- **Forgot/reset password** -- token-based reset flow (1h expiry), enumeration-safe
- **Account overview** -- read account profile, emails, and credential metadata
- **Account deletion** -- hard delete of user + credentials + emails + R2 proofing docs

Password validation follows NIST 800-63B (12-128 chars, common-password blocklist).

## Routes

### Email (`/emails`)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/emails/:userId` | List all emails for a user |
| `POST` | `/emails/:userId` | Add a new email (sends verification) |
| `DELETE` | `/emails/:userId/:emailId` | Remove a non-primary email |
| `PATCH` | `/emails/:userId/:emailId/primary` | Set an email as primary (must be verified) |
| `POST` | `/emails/verify` | Verify email with JWT token |
| `POST` | `/emails/:userId/:emailId/resend-verification` | Resend verification email |

### Password (`/password`)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/password/set` | Set initial password (registration) |
| `POST` | `/password/change` | Change password (requires current password) |
| `POST` | `/password/forgot` | Initiate reset flow (sends email) |
| `POST` | `/password/reset` | Reset password with token |

### Account (`/account`)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/account/:userId` | Account overview (profile, emails, credentials) |
| `DELETE` | `/account/:userId` | Delete account (self-service only) |

### Health

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Liveness check |

## SET (Security Event Token) Emission

The worker emits SETs via `QUEUE_SET` for downstream relying parties:

- **`identifier-changed`** -- when the primary email address changes
- **`password-reset`** -- on password change or reset
- **`account-purged`** -- on account deletion (GDPR/user-initiated hard purge)

## Service Binding

This worker is called from `auth-core` as `ACCOUNT_WORKER`. It is not exposed directly to the internet -- all requests arrive through the auth-core service binding.

User identity is conveyed via the `X-User-Id` request header, set by auth-core after session validation.

## Local Development

From the monorepo root:

```sh
pnpm dev:account
```
