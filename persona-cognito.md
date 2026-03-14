# Persona vs Cognito (Plaid) — Identity Verification Comparison

## Overview

| | Persona | Cognito (Plaid) |
|---|---|---|
| **Parent Company** | Persona Identities, Inc. | Plaid (acquired Cognito 2022) |
| **Core Model** | Inquiry-based: document capture + selfie in a single flow | Two products: **Flow** (hosted IDV UI) + **Identity** (phone-based database lookup) |
| **API Style** | REST, Bearer token auth | REST, HMAC-SHA256 request signing (JSON:API format) |
| **Base URL** | `https://withpersona.com/api/v1` | Sandbox: `sandbox.cognitohq.com` / Prod: `api.cognitohq.com` |
| **Content Type** | `application/json` | `application/vnd.api+json` |

---

## Products & Features

### Document Verification (IAL2)

| | Persona | Cognito |
|---|---|---|
| **Product** | Inquiries API | Flow |
| **How it works** | Server creates inquiry → user completes in embedded SDK → poll or webhook for result | Frontend opens Flow SDK with publishable key → user completes in hosted UI → webhook notifies backend |
| **Document types** | Driver's license, passport, national ID, visa, etc. | Driver's license, passport, national ID |
| **PII extracted** | First/last name, DOB, address, SSN (from document), document type, issuing country | First/last name, DOB, address (from document) |
| **SSN collection** | Extracted from document or user-input step in inquiry template | Separate user-input step in Flow template, or via Identity API database lookup |
| **Anti-fraud checks** | Liveness detection, document tampering, barcode cross-check | Email reputation (social network registration, breach history, disposable email detection) |

### Facial Match / Biometric Verification

| | Persona | Cognito |
|---|---|---|
| **Product** | Selfie verification (part of inquiry) | Built into Flow templates |
| **API access** | Separate `/verifications/:id` endpoint with selfie_comparison check | Included in Flow session result — not a separate API call |
| **Confidence scoring** | Check status (passed/failed) per verification | Flow returns pass/fail status at session level |
| **Liveness** | Active liveness detection | Liveness detection in Flow |

### Phone-Based Identity Lookup (No Equivalent in Persona)

| | Persona | Cognito |
|---|---|---|
| **Product** | N/A | **Identity** API |
| **How it works** | — | Send phone number (+ optional name) → get identity records from data sources |
| **Data returned** | — | Names, US addresses (with date ranges), phone numbers, DOB, death dates, SSN components (area/group/serial) |
| **Latency** | — | Most searches < 5 seconds; async fallback with job polling |
| **Use case** | — | Pre-fill verification forms, low-friction KYC for lower-risk users, supplement document verification |

### Watchlist / AML Screening

| | Persona | Cognito |
|---|---|---|
| **Product** | Watchlist reports (add-on) | **Screening** API |
| **Coverage** | PEP, sanctions, adverse media | PEP, sanctions, AML watchlists |

---

## Integration Architecture

### Persona Flow

```
Frontend                    Backend                         Persona
   |                          |                               |
   |--- POST /proofing/start ->|                               |
   |                          |--- POST /inquiries ----------->|
   |                          |<-- { inquiryId, sessionToken } |
   |<- { inquiryId, token } --|                               |
   |                          |                               |
   |== Persona SDK opens ===========================>|        |
   |   (user uploads doc + selfie)                   |        |
   |<= SDK completes ===============================>|        |
   |                          |                               |
   |--- POST /proofing/verify->|                               |
   |                          |--- GET /inquiries/:id -------->|
   |                          |<-- { status, fields, PII }     |
   |                          |                               |
   |                          |--- GET /inquiries/:id/verifications (for facial match)
   |                          |--- GET /verifications/:id ---->|
   |                          |<-- { selfie check result }     |
   |<- { ok, ial: 2 } -------|                               |
```

### Cognito Flow

```
Frontend                    Backend                         Cognito
   |                          |                               |
   |== Cognito Flow SDK opens (publishable key) ====>|        |
   |   (user uploads doc + selfie)                   |        |
   |<= SDK completes ===============================>|        |
   |                          |                               |
   |                          |<-- Webhook: flow_session.status.updated (status: success)
   |                          |                               |
   |                          |--- GET /flow_sessions/:id --->|
   |                          |<-- { status, verified data }   |
   |                          |                               |
   |  (optional: enrich with Identity API)                    |
   |                          |--- POST /profiles ----------->|
   |                          |--- POST /identity_searches -->|
   |                          |<-- { SSN, DOB, addresses }     |
   |                          |                               |
   |<- { ok, ial: 2 } -------|                               |
```

**Key difference:** Cognito Flow is frontend-initiated (no server call to start a session). The backend only gets involved after a webhook confirms completion. Persona requires a server-side inquiry creation before the frontend SDK can open.

---

## Authentication

### Persona
```
Authorization: Bearer persona_sandbox_xxxxxxxx
Persona-Version: 2023-01-05
```
Single API key, straightforward Bearer token.

### Cognito
```
Date: Thu, 25 Aug 2016 22:37:14 GMT
Digest: SHA-256=<base64-encoded-sha256-of-body>
Authorization: Signature keyId="<api-key>",algorithm="hmac-sha256",
  headers="(request-target) date digest",signature="<signature>"
```
HMAC-SHA256 request signing. Requires computing a signature over the request target, date, and body digest using the API secret. More complex but arguably more secure (secret never transmitted).

---

## Webhook Comparison

| | Persona | Cognito |
|---|---|---|
| **Events** | `inquiry.completed`, `inquiry.failed`, `inquiry.expired`, `verification.completed` | `flow_session.status.updated`, `flow_session.step.updated`, `flow_session.retried` |
| **Delivery** | Configurable via dashboard | Configurable via dashboard |
| **Retry policy** | Exponential backoff | Up to 7 retries, exponential backoff (~4 days total) |
| **Signing** | Webhook secret + HMAC | HMAC-SHA256 with same signing scheme as API |
| **Ordering guarantee** | Not guaranteed | Not guaranteed |

### Status Mapping

| Persona Status | Cognito Flow Status |
|---|---|
| `completed` | `success` |
| `failed` | `failed` |
| `pending` | *(no direct equivalent — use step webhook)* |
| `needs_review` | `pending_review` |
| `expired` | `expired` |
| — | `canceled` |

---

## SDK & Client Libraries

| | Persona | Cognito |
|---|---|---|
| **Frontend SDK** | JavaScript (inline embed or popup) | JavaScript (inline embed) |
| **Mobile SDKs** | iOS, Android, React Native, Flutter | iOS, Android (via Flow mobile integration) |
| **Server SDKs** | Ruby, Python, Node.js, Go, Java, PHP (official) | Node.js, Python, Go, Java, PHP, .NET (beta — contact support) |
| **Community libs** | Multiple (well-established) | Ruby (community) |

---

## Estimated Pricing

> Neither vendor publishes fixed pricing. These are approximate ranges based on public information and industry reports. Actual pricing requires contacting sales.

| | Persona | Cognito (Plaid) |
|---|---|---|
| **Document + Selfie verification** | ~$1–5 per verification (volume-dependent) | ~$2–5 per Flow session (volume-dependent) |
| **Phone-based identity lookup** | N/A | ~$0.50–1.50 per search |
| **Watchlist/AML screening** | Add-on pricing | Included in Screening product |
| **Pricing model** | Per-inquiry, tiered by volume | Pay-as-you-go, Growth (12-mo commitment), or Custom (volume discounts) |
| **Free tier / sandbox** | Sandbox environment (free) | Sandbox environment (free) |

### Cost Optimization with Cognito

Cognito's two-product model enables a **tiered verification strategy**:

1. **Low cost — Identity API first** (~$0.50–1.50): Phone number lookup returns SSN, DOB, addresses from data sources. If confidence is high enough, skip document verification entirely.
2. **Higher cost — Flow fallback** (~$2–5): Only trigger full document + selfie verification when the Identity lookup is insufficient.

Persona has no equivalent low-cost database lookup — every IAL2 verification requires document capture.

---

## Impact on Login.gov Implementation

### What Changes

| Area | Current (Persona) | New (Cognito) |
|---|---|---|
| **Env vars** | `PERSONA_API_KEY` | `COGNITO_API_KEY` + `COGNITO_API_SECRET` |
| **Client library** | [persona.ts](packages/identity-proofing/src/lib/persona.ts) — Bearer token, simple REST | New `cognito.ts` — HMAC-SHA256 signing, JSON:API envelope |
| **`/proofing/start`** | Server creates Persona inquiry, returns `inquiryId` + `sessionToken` | Returns publishable key + template ID + `customer_reference` for frontend SDK |
| **`/proofing/verify`** | Polls Persona inquiry by ID | Receives webhook, then fetches Flow session result |
| **`/proofing/verify-with-facial-match`** | Separate selfie verification lookup | Facial match is part of Flow result (no extra API call) |
| **SSN extraction** | From document fields in inquiry | From Identity API search (phone-based) or Flow user-input step |
| **KV binding key** | `persona_inquiry:{inquiryId}` | `cognito_session:{customerReference}` |
| **Frontend** | Persona SDK with session token | Cognito Flow SDK with publishable key |

### What Stays the Same

- R2 document upload route (`/proofing/document/upload`)
- PII encryption (AES-256-GCM) and storage in PlanetScale
- IAL evaluator logic
- SSN route (`/ssn/:userId`)
- `verified_at` timestamp route
- Re-proofing SET event emission
- All downstream OIDC/SAML claim behavior

---

## Recommendation

Cognito's **Identity API** (phone-based lookup) is the differentiator. If a significant portion of users can be verified via database lookup alone, the cost savings could be substantial compared to Persona's document-only model. The trade-off is a more complex auth scheme (HMAC signing) and beta-quality server SDKs.

**Go with Cognito if:**
- You want a cheaper pre-verification step before document capture
- Phone-based identity lookup provides sufficient confidence for some user cohorts
- You're already in the Plaid ecosystem

**Stay with Persona if:**
- Simpler integration is a priority (Bearer auth, mature SDKs)
- Every user must go through document + selfie regardless
- You need broader international document coverage
