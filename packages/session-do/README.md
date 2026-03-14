# @logingov/session-do

Cloudflare Durable Object that holds per-session auth state for Login.gov. Each active authentication flow gets its own DO instance, co-located with the user.

## What it stores

- **OIDC flow state** — PKCE code challenge/method, nonce, state, response type, redirect URI, scopes
- **Assurance levels** — requested and achieved IAL (1/2) and AAL (1/2), phishing-resistant and HSPD-12 flags, facial match preference
- **MFA state** — verification status and method (totp, webauthn, sms, backup, piv)
- **x509 / PIV/CAC** — transient mTLS metadata (issuer, subject, presented flag)
- **Misc** — service provider ID, user ID, locale, remembered device flag, timestamps

See the `SessionState` interface in `src/index.ts` for the full shape.

## Alarm-based TTL

Sessions expire automatically via Durable Object alarms:

| Scenario | TTL |
|---|---|
| Default | 15 minutes |
| Remembered device | 30 days |

When the alarm fires, `storage.deleteAll()` wipes the session. Reads against an expired (but not yet cleaned up) session return `410 Gone`.

If `rememberedDevice` is set to `true` via a PATCH update, the TTL is extended to 30 days and the alarm is rescheduled.

## HTTP API

Other Workers interact with the DO over its `fetch` handler:

| Method | Path | Description |
|---|---|---|
| `POST` | `/create` | Initialize session state; sets TTL alarm. Returns `201` with `expiresAt`. |
| `GET` | `/get` | Read current session. Returns `404` if missing, `410` if expired. |
| `PATCH` | `/update` | Merge partial updates (e.g., after MFA verification or identity proofing). |
| `DELETE` | `/destroy` | Immediately destroy the session (logout, fraud action). |

## Integration with auth-core

`SessionDO` is re-exported from the `auth-core` Worker so Cloudflare can bind it:

```ts
export { SessionDO } from "@logingov/session-do";
```

Workers obtain a stub via the `SESSION` Durable Object namespace binding and derive the instance ID from the session identifier. All reads and writes go through the HTTP API above.
