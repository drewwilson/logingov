# Authentication Flows

Complete request lifecycle for account creation, sign-in, and sign-out — from browser to edge to database and back.

---

## How Agency-to-Login.gov Routing Works

When an agency already uses login.gov and we deploy our new infrastructure, the OIDC contract stays identical — agencies don't change anything on their side. Here's the full round-trip a user takes:

### The Round-Trip

**Step 1: Agency redirects user to Login.gov.**
The agency's app has a "Sign in" button that sends the user's browser to our `/openid_connect/authorize` endpoint with a set of pre-registered parameters:

- `client_id` — identifies which agency app is asking (registered during onboarding)
- `redirect_uri` — where to send the user back (must match what's on file, must be HTTPS)
- `state` — a random value the agency generates for CSRF protection
- `nonce` — a random value to prevent token replay attacks
- `scope` — what user attributes the agency wants (email, name, etc.)
- `acr_values` — what assurance level is needed (just auth, or full identity verification)
- `code_challenge` — PKCE value for the code exchange (if using PKCE flow)

We validate `client_id` and `redirect_uri` against our service provider registry. If they don't match, the request is rejected.

**Step 2: User authenticates on our hosted UI.**
The user sees our login/signup pages, enters credentials, completes MFA, etc. This all happens on our domain. Our session cookies live entirely on our domain — the agency never sees them.

**Step 3: We redirect the user back to the agency.**
After successful authentication, we 302 redirect the user's browser to the agency's `redirect_uri` with two query parameters:

```
https://agency.gov/auth/callback?code=abc123&state=<same-state-value>
```

- `code` — a one-time authorization code (expires in 10 minutes, single-use)
- `state` — echoed back so the agency can verify it matches what they originally sent

**Step 4: Agency exchanges the code for tokens (server-to-server).**
The agency's backend directly calls our `/api/openid_connect/token` endpoint — this is NOT a browser redirect, it's a server-to-server HTTP POST. They send:

- The `code` they received
- A signed JWT (`client_assertion`) proving the agency's identity, OR
- A `code_verifier` proving they initiated the PKCE flow

We return:

- `id_token` — a signed JWT containing the user's `sub` (UUID), email, assurance levels, etc.
- `access_token` — a Bearer token for calling our `/api/openid_connect/userinfo` endpoint if they need more attributes

**Step 5: The agency creates its own session.**
The agency validates the `id_token` by checking the RS256 signature against our published JWKS keys, verifying the `nonce` and `aud` claims, and confirming expiration. Once validated, the agency creates its own session/cookie. From this point on, the user is "signed in" to the agency — we're out of the picture.

### Key Questions Answered

**Does the user carry a cookie between domains?** No. No cross-domain cookies are involved. The user has a login.gov session cookie on _our_ domain (enabling SSO — if they visit another agency, they won't need to re-authenticate), but agencies never see this cookie. The entire trust handoff happens via the authorization code and the signed `id_token`.

**How does the agency know the user is signed in?** Through the cryptographically signed `id_token`. It's an RS256 JWT — the agency verifies the signature using our published JWKS keys. If the signature is valid and the claims check out (`aud` matches their `client_id`, `nonce` matches, token isn't expired), the user is authenticated.

**How does the user get routed back to the right agency?** Via the `redirect_uri` that was pre-registered during agency onboarding and included in the authorization request. We validate it matches what's on file before ever redirecting — this prevents open redirect attacks.

**What about SSO across agencies?** If a user is already signed in to login.gov (has an active session cookie on our domain), and a second agency redirects them to us, we can skip the authentication step and immediately issue a new authorization code for that second agency. The user gets a seamless experience without re-entering credentials.

### Backward Compatibility with the Old Login.gov

Since this is a full rebuild, backward compatibility means preserving:

1. **Same OIDC endpoints** — `/openid_connect/authorize`, `/api/openid_connect/token`, `/api/openid_connect/userinfo`, `/openid_connect/logout`
2. **Same service provider registry** — migrated `client_id` / `redirect_uri` pairs from the old system
3. **Same signing key format** — published JWKS at `/.well-known/openid-configuration` so existing agency token validation continues working (keys can be rotated, but the format and discovery endpoint stay the same)
4. **Same `id_token` claims** — `sub` UUIDs must map to the same users, same claim names and structures
5. **Same SAML endpoints** — for agencies using SAML instead of OIDC

Agencies don't need to change their integration code. The DNS cutover points `secure.login.gov` at our new Cloudflare Workers infrastructure, and the OIDC/SAML contract is identical.

---

## 1. Account Creation (Sign-Up)

```
Browser                     Cloudflare Worker              SessionDO            PlanetScale (D1)         KV                    Queue
  │                              │                            │                      │                    │                      │
  │  GET /openid_connect/authorize                             │                      │                    │                      │
  │  (client_id, redirect_uri,   │                             │                      │                    │                      │
  │   scope, acr_values, PKCE)   │                             │                      │                    │                      │
  │─────────────────────────────>│                             │                      │                    │                      │
  │                              │  Validate SP config         │                      │                    │                      │
  │                              │─────────────────────────────────────────────────────>│                    │                      │
  │                              │<────────────────────────── service_providers row ────│                    │                      │
  │                              │                             │                      │                    │                      │
  │                              │  Create auth session        │                      │                    │                      │
  │                              │  (15-min TTL alarm)         │                      │                    │                      │
  │                              │────────────────────────────>│                      │                    │                      │
  │                              │                             │  Store:              │                    │                      │
  │                              │                             │  - client_id         │                    │                      │
  │                              │                             │  - redirect_uri      │                    │                      │
  │                              │                             │  - scopes            │                    │                      │
  │                              │                             │  - code_challenge    │                    │                      │
  │                              │                             │  - nonce             │                    │                      │
  │                              │                             │  - acr (IAL/AAL)     │                    │                      │
  │                              │                             │  - state: "pending"  │                    │                      │
  │                              │<──────── session_id ────────│                      │                    │                      │
  │                              │                             │                      │                    │                      │
  │  302 → /sign-up?session_id   │                             │                      │                    │                      │
  │<─────────────────────────────│                             │                      │                    │                      │
  │                              │                             │                      │                    │                      │
  │  POST /api/auth/sign-up/email                              │                      │                    │                      │
  │  (email, password)           │                             │                      │                    │                      │
  │─────────────────────────────>│                             │                      │                    │                      │
  │                              │  Validate password:         │                      │                    │                      │
  │                              │  - >= 12 chars              │                      │                    │                      │
  │                              │  - != email                 │                      │                    │                      │
  │                              │  - not in common list       │                      │                    │                      │
  │                              │                             │                      │                    │                      │
  │                              │  Hash password (scrypt)     │                      │                    │                      │
  │                              │  Encrypt email (AES-256-GCM)│                      │                    │                      │
  │                              │  Generate blind index       │                      │                    │                      │
  │                              │  (HMAC-SHA256)              │                      │                    │                      │
  │                              │                             │                      │                    │                      │
  │                              │  INSERT user ──────────────────────────────────────>│                    │                      │
  │                              │  INSERT account ───────────────────────────────────>│                    │                      │
  │                              │  INSERT session ───────────────────────────────────>│                    │                      │
  │                              │                             │                      │                    │                      │
  │                              │  Generate email             │                      │                    │                      │
  │                              │  verification JWT           │                      │                    │                      │
  │                              │  (24h expiry)               │                      │                    │                      │
  │                              │                             │                      │                    │                      │
  │                              │  Enqueue verification email─────────────────────────────────────────────>│                      │
  │                              │                             │                      │                    │  (logingov-email)    │
  │                              │                             │                      │                    │                      │
  │                              │  Audit: account_created ────────────────────────────────────────────────────────────────────────>│
  │                              │                             │                      │                    │  (logingov-audit)    │
  │                              │                             │                      │                    │                      │
  │  200 { user, session_token } │                             │                      │                    │                      │
  │<─────────────────────────────│                             │                      │                    │                      │
  │                              │                             │                      │                    │                      │
  │  (continues to MFA setup     │                             │                      │                    │                      │
  │   if AAL >= 2 required)      │                             │                      │                    │                      │
```

### What gets stored

| Store       | Key / Table           | Data                                                    | Lifetime                     |
| ----------- | --------------------- | ------------------------------------------------------- | ---------------------------- |
| PlanetScale | `user` row            | id, encrypted email, emailBlindIndex, ial=1, locale     | Permanent                    |
| PlanetScale | `account` row         | userId, providerId="credential"                         | Permanent                    |
| PlanetScale | `session` row         | userId, token (unique), expiresAt, ipAddress, userAgent | 15 min (refreshed on access) |
| SessionDO   | DurableObject storage | OIDC flow state (client_id, scopes, PKCE, acr)          | 15 min (alarm)               |
| Queue       | logingov-email        | Email verification JWT (24h exp)                        | Consumed async               |
| Queue       | logingov-audit        | account_created event                                   | Consumed → D1 + R2           |

---

## 2. Sign-In (Returning User — Full OIDC Flow)

```
Browser                     Cloudflare Worker              SessionDO            PlanetScale (D1)         KV                    Queue
  │                              │                            │                      │                    │                      │
  │  ┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐   │
  │  │ PHASE 1: AUTHORIZE — SP redirects user to Login.gov                                                                    │   │
  │  └─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘   │
  │                              │                            │                      │                    │                      │
  │  GET /openid_connect/authorize                             │                      │                    │                      │
  │  (client_id, redirect_uri,   │                             │                      │                    │                      │
  │   scope, state, nonce,       │                             │                      │                    │                      │
  │   code_challenge, acr_values)│                             │                      │                    │                      │
  │─────────────────────────────>│                             │                      │                    │                      │
  │                              │                             │                      │                    │                      │
  │                              │  Lookup SP ────────────────────────────────────────>│                    │                      │
  │                              │  Validate redirect_uri      │                      │                    │                      │
  │                              │  against SP.redirectUris     │                      │                    │                      │
  │                              │                             │                      │                    │                      │
  │                              │  Check rate limit ──────────────────────────────────────────────────────>│                      │
  │                              │                             │                      │  rate:{ip}:{path}  │                      │
  │                              │                             │                      │  (sliding window)  │                      │
  │                              │                             │                      │                    │                      │
  │                              │  Create SessionDO ─────────>│                      │                    │                      │
  │                              │  (15-min alarm)             │  Store flow state    │                    │                      │
  │                              │<──────── session_id ────────│                      │                    │                      │
  │                              │                             │                      │                    │                      │
  │  302 → /sign-in?session_id   │                             │                      │                    │                      │
  │<─────────────────────────────│                             │                      │                    │                      │
  │                              │                             │                      │                    │                      │
  │  ┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐   │
  │  │ PHASE 2: AUTHENTICATE — User enters credentials                                                                        │   │
  │  └─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘   │
  │                              │                            │                      │                    │                      │
  │  POST /api/auth/sign-in/email│                             │                      │                    │                      │
  │  (email, password)           │                             │                      │                    │                      │
  │─────────────────────────────>│                             │                      │                    │                      │
  │                              │  Lookup user by             │                      │                    │                      │
  │                              │  emailBlindIndex ──────────────────────────────────>│                    │                      │
  │                              │  (HMAC-SHA256 of            │                      │                    │                      │
  │                              │   normalized email)         │                      │                    │                      │
  │                              │                             │                      │                    │                      │
  │                              │  Verify password            │                      │                    │                      │
  │                              │  (scrypt, constant-time)    │                      │                    │                      │
  │                              │                             │                      │                    │                      │
  │                              │  If bcrypt hash detected:   │                      │                    │                      │
  │                              │  lazy rehash → scrypt       │                      │                    │                      │
  │                              │  UPDATE user ──────────────────────────────────────>│                    │                      │
  │                              │                             │                      │                    │                      │
  │                              │  Create Better Auth session │                      │                    │                      │
  │                              │  INSERT session ───────────────────────────────────>│                    │                      │
  │                              │                             │                      │                    │                      │
  │                              │  Update SessionDO ─────────>│                      │                    │                      │
  │                              │  state: "authenticated"     │  userId set          │                    │                      │
  │                              │                             │                      │                    │                      │
  │                              │  Audit: login ──────────────────────────────────────────────────────────────────────────────────>│
  │                              │                             │                      │                    │  (logingov-audit)    │
  │                              │                             │                      │                    │                      │
  │  200 { session_token }       │                             │                      │                    │                      │
  │<─────────────────────────────│                             │                      │                    │                      │
  │                              │                             │                      │                    │                      │
  │  ┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐   │
  │  │ PHASE 3: MFA — Second factor verification (if AAL >= 2)                                                                │   │
  │  └─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘   │
  │                              │                            │                      │                    │                      │
  │  POST /mfa/totp/verify       │                             │                      │                    │                      │
  │  (code, session_id)          │                             │                      │                    │                      │
  │─────────────────────────────>│                             │                      │                    │                      │
  │                              │                             │                      │                    │                      │
  │                              │  Check MFA rate limit ──────────────────────────────────────────────────>│                      │
  │                              │                             │                      │  mfa_attempts:     │                      │
  │                              │                             │                      │  {userId} (5 max   │                      │
  │                              │                             │                      │  in 15-min window) │                      │
  │                              │                             │                      │                    │                      │
  │                              │  Check TOTP replay ─────────────────────────────────────────────────────>│                      │
  │                              │                             │                      │  totp_replay:      │                      │
  │                              │                             │                      │  {userId}:{step}   │                      │
  │                              │                             │                      │  (90s TTL)         │                      │
  │                              │                             │                      │                    │                      │
  │                              │  Load TOTP secret ─────────────────────────────────>│                    │                      │
  │                              │  from twoFactor table       │                      │                    │                      │
  │                              │                             │                      │                    │                      │
  │                              │  Verify TOTP (±1 window)    │                      │                    │                      │
  │                              │                             │                      │                    │                      │
  │                              │  Mark replay used ──────────────────────────────────────────────────────>│                      │
  │                              │                             │                      │  SET totp_replay:  │                      │
  │                              │                             │                      │  {userId}:{step}   │                      │
  │                              │                             │                      │  TTL=90s           │                      │
  │                              │                             │                      │                    │                      │
  │                              │  Update SessionDO ─────────>│                      │                    │                      │
  │                              │  state: "mfa_verified"      │  mfaMethod: "totp"   │                    │                      │
  │                              │  aal: 2                     │                      │                    │                      │
  │                              │                             │                      │                    │                      │
  │  200 { mfa: "verified" }     │                             │                      │                    │                      │
  │<─────────────────────────────│                             │                      │                    │                      │
  │                              │                             │                      │                    │                      │
  │  ┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐   │
  │  │ PHASE 4: CODE ISSUANCE — Generate authorization code                                                                    │   │
  │  └─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘   │
  │                              │                            │                      │                    │                      │
  │  POST /api/auth-flow/issue-code                            │                      │                    │                      │
  │  (session_id)                │                             │                      │                    │                      │
  │─────────────────────────────>│                             │                      │                    │                      │
  │                              │  Read SessionDO ───────────>│                      │                    │                      │
  │                              │  Verify state=mfa_verified  │                      │                    │                      │
  │                              │<──── flow state ────────────│                      │                    │                      │
  │                              │                             │                      │                    │                      │
  │                              │  Generate auth code         │                      │                    │                      │
  │                              │  INSERT auth_codes ────────────────────────────────>│                    │                      │
  │                              │  (code, userId, spId,       │  10-min expiry       │                    │                      │
  │                              │   scopes, codeChallenge,    │                      │                    │                      │
  │                              │   nonce, ial, aal, acr)     │                      │                    │                      │
  │                              │                             │                      │                    │                      │
  │  302 → {redirect_uri}?code={code}&state={state}           │                      │                    │                      │
  │<─────────────────────────────│                             │                      │                    │                      │
  │                              │                             │                      │                    │                      │
  │  ┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐   │
  │  │ PHASE 5: TOKEN EXCHANGE — SP backend exchanges code for tokens                                                          │   │
  │  └─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘   │
  │                              │                            │                      │                    │                      │
SP Backend                       │                            │                      │                    │                      │
  │  POST /api/openid_connect/token                            │                      │                    │                      │
  │  (grant_type, code,          │                             │                      │                    │                      │
  │   code_verifier,             │                             │                      │                    │                      │
  │   client_assertion [JWT])    │                             │                      │                    │                      │
  │─────────────────────────────>│                             │                      │                    │                      │
  │                              │                             │                      │                    │                      │
  │                              │  Validate client_assertion  │                      │                    │                      │
  │                              │  (RS256 JWT, check exp,     │                      │                    │                      │
  │                              │   iss, aud, jti)            │                      │                    │                      │
  │                              │                             │                      │                    │                      │
  │                              │  Lookup auth_code ─────────────────────────────────>│                    │                      │
  │                              │  UPDATE auth_codes          │  SET usedAt=NOW()    │                    │                      │
  │                              │  WHERE usedAt IS NULL       │  (single-use atomic) │                    │                      │
  │                              │                             │                      │                    │                      │
  │                              │  Verify PKCE:               │                      │                    │                      │
  │                              │  SHA256(code_verifier)      │                      │                    │                      │
  │                              │  == code_challenge           │                      │                    │                      │
  │                              │                             │                      │                    │                      │
  │                              │  Generate access_token      │                      │                    │                      │
  │                              │  (opaque: {UUIDv7}-{UUID})  │                      │                    │                      │
  │                              │  Store in KV ──────────────────────────────────────────────────────────>│                      │
  │                              │                             │                      │  access_token:     │                      │
  │                              │                             │                      │  {token}           │                      │
  │                              │                             │                      │  TTL = 900s (15m)  │                      │
  │                              │                             │                      │                    │                      │
  │                              │  Sign id_token (RS256 JWT)  │                      │                    │                      │
  │                              │  Load signing key from KV ──────────────────────────────────────────────>│                      │
  │                              │  Claims: sub (pairwise),    │                      │  jwks:{kid}        │                      │
  │                              │  iss, aud, nonce, exp (5m), │                      │                    │                      │
  │                              │  iat, at_hash, ial, aal, acr│                      │                    │                      │
  │                              │                             │                      │                    │                      │
  │  200 {                       │                             │                      │                    │                      │
  │    access_token,             │                             │                      │                    │                      │
  │    token_type: "Bearer",     │                             │                      │                    │                      │
  │    expires_in: 900,          │                             │                      │                    │                      │
  │    id_token (JWT)            │                             │                      │                    │                      │
  │  }                           │                             │                      │                    │                      │
  │<─────────────────────────────│                             │                      │                    │                      │
```

### KV state after successful sign-in

| KV Key                                | Value                      | TTL           | Purge trigger        |
| ------------------------------------- | -------------------------- | ------------- | -------------------- |
| `access_token:{token}`                | `{ userId, scopes, spId }` | 900s (15 min) | TTL expiry or logout |
| `rate:{ip}:/openid_connect/authorize` | sliding window counter     | 60s           | TTL expiry           |
| `mfa_attempts:{userId}`               | failure count              | 900s (15 min) | TTL expiry           |
| `totp_replay:{userId}:{timestep}`     | `"1"`                      | 90s           | TTL expiry           |

### SessionDO state after successful sign-in

| Field            | Value                          | Notes                        |
| ---------------- | ------------------------------ | ---------------------------- |
| `state`          | `"code_issued"`                | Terminal state for this flow |
| `userId`         | UUID                           | Set during authentication    |
| `client_id`      | SP issuer URI                  | From authorize request       |
| `scopes`         | `["openid", "email", ...]`     | From authorize request       |
| `code_challenge` | S256 hash                      | From authorize request       |
| `nonce`          | 22+ char string                | From authorize request       |
| `ial`            | 1 or 2                         | Resolved from acr_values     |
| `aal`            | 1 or 2                         | Resolved from acr_values     |
| `mfaMethod`      | `"totp"` / `"webauthn"` / etc. | Set during MFA               |
| `expiresAt`      | Unix timestamp                 | 15 min from creation         |
| **Alarm**        | fires at `expiresAt`           | Calls `deleteAll()` to purge |

---

## 3. Sign-Out (Logout)

```
Browser                     Cloudflare Worker              SessionDO            PlanetScale (D1)         KV                    Queue
  │                              │                            │                      │                    │                      │
  │  GET /openid_connect/logout  │                             │                      │                    │                      │
  │  (id_token_hint,             │                             │                      │                    │                      │
  │   post_logout_redirect_uri,  │                             │                      │                    │                      │
  │   state)                     │                             │                      │                    │                      │
  │─────────────────────────────>│                             │                      │                    │                      │
  │                              │                             │                      │                    │                      │
  │                              │  Decode id_token_hint       │                      │                    │                      │
  │                              │  (extract sub, client_id)   │                      │                    │                      │
  │                              │                             │                      │                    │                      │
  │                              │  Validate redirect_uri      │                      │                    │                      │
  │                              │  against SP config ─────────────────────────────────>│                    │                      │
  │                              │  (postLogoutRedirectUris)   │                      │                    │                      │
  │                              │                             │                      │                    │                      │
  │                              │  Destroy SessionDO ────────>│                      │                    │                      │
  │                              │  DELETE                     │  deleteAll()         │                    │                      │
  │                              │                             │  cancel alarm        │                    │                      │
  │                              │                             │  ☠ DO purged         │                    │                      │
  │                              │                             │                      │                    │                      │
  │                              │  Revoke Better Auth session │                      │                    │                      │
  │                              │  DELETE session ───────────────────────────────────>│                    │                      │
  │                              │                             │                      │                    │                      │
  │                              │  Delete access_token from KV────────────────────────────────────────────>│                      │
  │                              │                             │                      │  DELETE             │                      │
  │                              │                             │                      │  access_token:     │                      │
  │                              │                             │                      │  {token}           │                      │
  │                              │                             │                      │                    │                      │
  │                              │  Emit session-revoked SET──────────────────────────────────────────────────────────────────────>│
  │                              │                             │                      │                    │  (logingov-set)      │
  │                              │                             │                      │                    │                      │
  │                              │  Audit: logout ─────────────────────────────────────────────────────────────────────────────────>│
  │                              │                             │                      │                    │  (logingov-audit)    │
  │                              │                             │                      │                    │                      │
  │  302 → {post_logout_redirect_uri}?state={state}            │                      │                    │                      │
  │<─────────────────────────────│                             │                      │                    │                      │
```

### What gets cleaned up on logout

| Store       | What                      | How                                          |
| ----------- | ------------------------- | -------------------------------------------- |
| SessionDO   | All DurableObject storage | `deleteAll()` + alarm cancelled              |
| PlanetScale | `session` row             | DELETE by session token                      |
| KV          | `access_token:{token}`    | Explicit `kvDelete()`                        |
| Queue       | session-revoked SET       | Published to logingov-set for delivery to SP |
| Queue       | logout audit event        | Published to logingov-audit → D1 + R2        |

---

## 4. KV Lifecycle — Complete Reference

### KV Namespaces

| Namespace       | Purpose                                  |
| --------------- | ---------------------------------------- |
| `KV_SESSIONS`   | Access tokens, PAR request objects       |
| `KV_OTP`        | SMS/TOTP codes, WebAuthn challenges      |
| `KV_RATE_LIMIT` | Per-IP and per-user rate counters        |
| `KV_JWKS`       | Cached JWKS public keys and signing keys |

### All KV Keys and Their Lifecycles

```
KV_SESSIONS
├── access_token:{token}
│   Value:   { userId, scopes, spId }
│   Created: Token exchange (Phase 5)
│   TTL:     900s (15 min)
│   Purged:  TTL expiry OR explicit delete on logout
│
├── par:{request_uri}
│   Value:   { client_id, redirect_uri, scopes, code_challenge, ... }
│   Created: POST /api/openid_connect/par
│   TTL:     60s
│   Purged:  TTL expiry OR consumed at authorize endpoint
│
KV_OTP
├── otp:{userId}:mfa_sms
│   Value:   { code (6-digit), attempts: 0 }
│   Created: POST /mfa/sms/send
│   TTL:     600s (10 min)
│   Purged:  TTL expiry OR explicit delete after successful verify
│
├── totp_replay:{userId}:{timestep}
│   Value:   "1"
│   Created: After successful TOTP verification
│   TTL:     90s
│   Purged:  TTL expiry only (prevents same code reuse within window)
│
├── webauthn_challenge:{userId}
│   Value:   { challenge, rpId }
│   Created: POST /mfa/webauthn/*/options
│   TTL:     300s (5 min)
│   Purged:  TTL expiry OR explicit delete after verify
│
KV_RATE_LIMIT
├── rate:{ip}:{method}:{path}
│   Value:   { count, windowStart }
│   Created: First request to rate-limited endpoint
│   TTL:     60s (window duration)
│   Purged:  TTL expiry (sliding window resets)
│
├── mfa_attempts:{userId}
│   Value:   failure count (int)
│   Created: First failed MFA attempt
│   TTL:     900s (15 min)
│   Purged:  TTL expiry (counter resets)
│   Note:    Account locked at count >= 5
│
├── sms_sends:{userId}
│   Value:   send count (int)
│   Created: First SMS send
│   TTL:     600s (10 min)
│   Purged:  TTL expiry
│   Note:    Rejected at count >= 3
│
KV_JWKS
├── jwks:public
│   Value:   { keys: [{ kty, n, e, kid, ... }] }
│   Created: Key rotation cron (hourly)
│   TTL:     604,800s (7 days)
│   Purged:  Overwritten by cron; TTL as safety net
│
├── jwks:{kid}:private
│   Value:   pointer/metadata (actual key in R2)
│   Created: Key rotation cron
│   TTL:     604,800s (7 days)
│   Purged:  Overwritten on rotation
```

### KV Purge Summary

| Purge Method        | Used For                                      | Mechanism                                                     |
| ------------------- | --------------------------------------------- | ------------------------------------------------------------- |
| **TTL expiry**      | All KV keys                                   | Cloudflare automatically deletes after TTL. No action needed. |
| **Explicit delete** | Access tokens, OTP codes, WebAuthn challenges | `kvDelete()` called on logout or successful verification      |
| **Overwrite**       | JWKS cache, rate limit counters               | New value replaces old on rotation or window reset            |

---

## 5. Token & Session Lifetime Reference

```
Timeline (not to scale)
─────────────────────────────────────────────────────────────────────────────────────>

├─ TOTP replay guard ──┤                                          90 seconds
│                      │
├─── PAR request_uri ──┤                                          60 seconds
│                      │
├──── WebAuthn challenge ────┤                                    5 minutes
│                            │
├──── id_token (JWT exp) ────┤                                    5 minutes
│                            │
├────── SMS OTP code ──────────────┤                              10 minutes
│                                  │
├────── Auth code ─────────────────┤                              10 minutes
│                                  │
├────── Access token (KV) ─────────────────┤                      15 minutes
│                                          │
├────── Better Auth session (D1) ──────────┤                      15 minutes
│                          ↑               │                      (refreshed every
│                    refresh on access      │                       60s on access)
│                                          │
├────── SessionDO (auth flow) ─────────────┤                      15 minutes
│                                          │                      (alarm-based cleanup)
│
├────── Password reset token (JWT) ────────────────────┤          1 hour
│                                                      │
├────── Email verification token (JWT) ────────────────────────────────────────┤   24 hours
│                                                                              │
├────── Rate limit: MFA attempts ──────────┤                      15 minutes
│                                          │
├────── Rate limit: SMS sends ─────────────────────────┤          10 minutes
│                                                      │
│                                                                              │
├────── Remember device (SessionDO) ───────────────────────────────────── ... ──┤  30 days
│                                                                               │
├────── JWKS cache (KV) ─────────────────────────────────────────────────────────────── ... ──┤  7 days
                                                                                              │  (refreshed hourly)
```

### Cron-Based Cleanup

| Schedule    | Worker    | Action                                                        |
| ----------- | --------- | ------------------------------------------------------------- |
| Every 5 min | auth-core | Delete expired auth_codes from D1 (`WHERE expiresAt < NOW()`) |
| Hourly      | infra     | Check JWKS key age; rotate if > 23h; update KV cache          |
| Daily       | infra     | Audit log flush (available for future archival jobs)          |
