# Global Users: One Person, One Record

How login.gov's centralized identity model eliminates duplicate user records and redundant identity-proofing charges across government.

---

## The Problem Today

When government agencies manage their own user databases, a single person ends up with multiple identity records:

```
Jane Doe (SSN: ***-**-1234)
  ├── IRS.gov         → User #A8F2  (identity-proofed — $4.00)
  ├── SSA.gov         → User #9C17  (identity-proofed — $4.00)
  ├── VA.gov          → User #D4E1  (identity-proofed — $4.00)
  └── USAJOBS.gov     → User #71B5  (identity-proofed — $4.00)

Total: 4 user records, 4 identity-proofing charges = $16.00 for one person
```

Multiply this by hundreds of millions of Americans interacting with dozens of agencies, and the government is paying orders of magnitude more than necessary for identity verification.

---

## The Solution: Centralized Identity at login.gov

Login.gov acts as the **single identity provider** for all participating agencies. Instead of each agency proofing users independently, login.gov proofs a person **once** and shares verified attributes with every agency that needs them.

```
Jane Doe (SSN: ***-**-1234)
  └── login.gov       → User #F3A9  (proofed once — $4.00)
        ├── IRS.gov         ← receives verified claims via OIDC
        ├── SSA.gov         ← receives verified claims via OIDC
        ├── VA.gov          ← receives verified claims via OIDC
        └── USAJOBS.gov     ← receives verified claims via OIDC

Total: 1 user record, 1 identity-proofing charge = $4.00 for one person
```

---

## How It Works Technically

### 1. Single User Record, Verified Once

When a person creates a login.gov account and completes identity proofing (IAL2), the system:

1. **Creates one `users` row** with a unique UUID
2. **Calls the identity-proofing vendor exactly once** to verify their government-issued ID + selfie
3. **Stores verified PII** (SSN, name, DOB, address) encrypted with AES-256-GCM in that single record
4. **Sets `ial=2`** on the user, marking them as identity-proofed

From this point forward, the person never needs to be proofed again — their verified identity lives in login.gov.

### 2. SSN as the Deduplication Key

The SSN field is the natural unique identifier for a real person. The system can enforce one-account-per-SSN:

- When a user completes identity proofing, the vendor extracts and verifies their SSN from their government ID
- Before creating the proofed record, login.gov checks for an existing user with that SSN (via encrypted lookup)
- If a match exists, the system links the authentication to the existing proofed identity rather than creating a duplicate
- This guarantees **one proofing call per human**, regardless of how many agencies they interact with

### 3. Agencies Get Claims, Not Raw Identity

When an agency (service provider) needs to authenticate a user, the OIDC flow handles everything:

```
Agency (SP)                         login.gov
    |                                   |
    |── authorize request ──────────────>|
    |   (scopes: openid profile ssn)    |
    |                                   |── user already proofed?
    |                                   |   YES → skip Persona entirely
    |                                   |   NO  → proof once, store result
    |                                   |
    |<────────── auth code ─────────────|
    |── token exchange ─────────────────>|
    |<────────── id_token + access ─────|
    |── userinfo request ───────────────>|
    |<────────── verified claims ───────|
    |   (name, DOB, SSN, address)       |
```

The agency receives verified identity claims without ever touching an identity-proofing vendor directly. Login.gov decrypts the stored PII and returns it via the userinfo endpoint, scoped to only what the agency requested.

### 4. Privacy-Preserving Cross-Agency Isolation

Even though there is one user record internally, agencies **cannot correlate users across services**:

- Each agency receives a **pairwise `sub` identifier**: `HMAC-SHA256(PAIRWISE_SALT, userId + spId)`
- IRS sees `sub: abc123`, SSA sees `sub: def456` — both are Jane Doe, but neither can tell
- Agencies only receive the specific claims their scopes authorize (e.g., IRS gets SSN, USAJOBS may not)

This means centralized identity does not compromise privacy between agencies.

---

## Better Experience for Citizens

With a single login.gov account, citizens manage their identity in **one place** instead of repeating the same process across every agency:

- **One account to create and remember** — no more juggling separate credentials for IRS, SSA, VA, USAJOBS, etc.
- **One identity proofing session** — upload your ID and take a selfie once, not every time you interact with a new agency
- **One place to update information** — change your address, phone number, or email at login.gov and every agency sees the update
- **One place to manage security** — set up MFA, review login history, and revoke sessions from a single dashboard
- **One password to reset** — instead of navigating different recovery flows across dozens of agency sites

Today, a citizen who interacts with 5 agencies has 5 accounts to create, 5 passwords to remember, 5 identity proofing sessions to sit through, and 5 places to update when they move. With login.gov's global user model, all of that collapses to 1.

---

## Cost Impact

### Per-Person Savings

| Scenario | Proofing Calls | Cost per Person |
|----------|---------------|-----------------|
| Decentralized (4 agencies) | 4 | $16.00 |
| Decentralized (10 agencies) | 10 | $40.00 |
| **login.gov (any # of agencies)** | **1** | **$4.00** |

### At Scale

| Metric | Old login.gov | New login.gov |
|--------|--------------|----------------------|
| US adults (~260M) across avg 5 agencies | 1.3B proofing calls | 260M proofing calls |
| Cost at $4/proof | $5.2B | $1.04B |
| **Savings** | — | **$4.16B** |

Even conservative estimates (not everyone uses all agencies, not all agencies require IAL2) show savings in the hundreds of millions.

### Ongoing Savings

The savings compound over time:

- **New agency onboarded** — zero incremental proofing cost for already-verified users
- **Re-proofing events** — happen once at login.gov, propagated to all agencies via RISC/SET events
- **No vendor lock-in per agency** — only login.gov holds the identity-proofing vendor relationship

---

## Implementation Details in This Codebase

### What Already Exists

This system already implements the global user model:

| Capability | Where |
|-----------|-------|
| Single `users` table with encrypted PII | `packages/shared/src/schema/index.ts` |
| Persona integration (one-time proofing) | `packages/identity-proofing/src/lib/persona.ts` |
| IAL tracking (`ial=1` or `ial=2` per user) | `users.ial` column |
| OIDC token issuance with scoped claims | `packages/auth-core/src/routes/` |
| Pairwise subject identifiers | `HMAC-SHA256(PAIRWISE_SALT, userId + spId)` |
| PII encryption at rest (AES-256-GCM) | `packages/shared/src/crypto.ts` |
| Re-proofing with SET notifications | `packages/identity-proofing/src/routes/proofing.ts` |
| Service provider management | `packages/admin/src/routes/service-providers.ts` |

### What Needs to Be Added for SSN Deduplication

To enforce one-account-per-SSN, add:

1. **SSN blind index column** on the `users` table — similar to the existing `emailBlindIndex`
   - `ssnBlindIndex`: `HMAC-SHA256(BLIND_INDEX_KEY, normalized_ssn)`
   - Enables equality lookups on encrypted SSN without exposing plaintext

2. **Dedup check in the proofing flow** — after the identity-proofing vendor returns a verified SSN:
   - Compute the blind index
   - Query `users` for a matching `ssnBlindIndex`
   - If found: link the current authentication session to the existing user (merge accounts)
   - If not found: store the SSN and blind index on the current user, set `ial=2`

3. **Account merge logic** — when a duplicate is detected:
   - Migrate credentials (passwords, WebAuthn keys, TOTP secrets) to the existing account
   - Re-point `authCodes` and `identityEvents` to the surviving user ID
   - Notify affected service providers via RISC/SET `identifier-changed` event
   - Delete the orphaned user record

---

## How Agencies Adopt This

Onboarding an agency requires **zero identity infrastructure** on their side:

1. **Register as a service provider** via the login.gov admin API (public key, redirect URIs, IAL/AAL requirements)
2. **Integrate OIDC or SAML** — standard protocol libraries in any language
3. **Request scopes** — `openid`, `profile`, `social_security_number`, etc.
4. **Receive verified claims** — name, DOB, SSN, address — all from login.gov's single proofed record

The agency never calls an identity-proofing vendor. Never stores raw PII (unless they choose to cache claims). Never pays a per-user proofing fee.

---

## Summary

| Without login.gov | With login.gov |
|---|---|
| Each agency proofs each user independently | Login.gov proofs each person once |
| Same person = N user records across N agencies | Same person = 1 user record at login.gov |
| N identity-proofing charges per person | 1 proofing charge per person, ever |
| Each agency manages PII storage and encryption | PII stored once, encrypted, at login.gov |
| No cross-agency identity consistency | Consistent verified identity, privacy-preserving pairwise IDs |
| Agencies build and maintain identity infrastructure | Agencies integrate a standard OIDC/SAML flow |

The architecture in this repository already implements the core of this model. The main addition needed is SSN-based deduplication (blind index + merge logic) to guarantee that no person is ever proofed twice, regardless of how many agencies they interact with.
