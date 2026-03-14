# Privacy Policy & Data Protection

**SOC II Criteria:** P1–P8 (Privacy), CC6.5 (Confidentiality)
**Last Updated:** 2026-03-14
**Owner:** Privacy / Compliance Team

---

## 1. Data Inventory

### Personal Information Collected

| Data Element | Purpose | Encrypted at Rest | Retention |
|-------------|---------|-------------------|-----------|
| Email address | Account identification, communication | Yes (AES-256-GCM) + blind index | Account lifetime |
| Password hash | Authentication | Yes (PBKDF2-SHA256, not reversible) | Account lifetime |
| Phone number | MFA (SMS OTP) | Yes (AES-256-GCM) | Account lifetime |
| Date of birth | Identity proofing (IAL2) | Yes (AES-256-GCM) | Account lifetime |
| Social Security Number | Identity proofing (IAL2) | Yes (AES-256-GCM) | Account lifetime |
| Physical address | Identity proofing (IAL2) | Yes (AES-256-GCM) | Account lifetime |
| Full name (given + family) | Identity proofing, profile | Yes (AES-256-GCM) | Account lifetime |
| TOTP secrets | MFA (authenticator app) | Yes (AES-256-GCM) | Account lifetime |
| WebAuthn credentials | MFA (security key/biometric) | Yes (AES-256-GCM) | Account lifetime |
| Backup codes | MFA recovery | Yes (AES-256-GCM, single-use) | Until used |
| IP address | Audit logging, rate limiting | No (logged, not stored in user record) | Per audit log retention |
| Identity proofing documents | KYC verification via Persona | Yes (R2 at-rest encryption) | 90 days post-verification |

### Non-Personal Data Collected

| Data Element | Purpose | Retention |
|-------------|---------|-----------|
| Session metadata | Auth flow state management | 15 min (auth) / 30 days (remembered) |
| OAuth authorization codes | Token exchange | 10 minutes |
| OTP codes | SMS verification | 10 minutes |
| Rate limit counters | Abuse prevention | Sliding window (60–300 seconds) |
| Audit events | Compliance, security monitoring | 7 years |

---

## 2. Data Collection Principles

### Minimization
- Only data required for the requested assurance level (IAL/AAL) is collected
- IAL1 (auth-only): email + password + MFA factor only
- IAL2 (identity-proofed): adds name, DOB, SSN, address, phone
- SP scope parameter restricts which claims are returned to relying parties

### Purpose Limitation
- PII is collected solely for identity verification and authentication
- Data is never used for marketing, profiling, or analytics beyond security monitoring
- Third-party sharing is limited to operational requirements (see Section 5)

### Consent
- Account creation constitutes consent for authentication-related data processing
- IAL2 proofing requires explicit user consent before collecting SSN, DOB, and address
- MFA enrollment is user-initiated (opt-in for specific MFA methods)
- Users may withdraw consent by deleting their account (see Section 4)

---

## 3. Data Protection Controls

### Encryption at Rest
- **Algorithm:** AES-256-GCM via Web Crypto API
- **IV:** Random 12-byte per encryption operation
- **Key management:** `ENCRYPTION_KEY` stored as Cloudflare Worker secret
- **Scope:** All PII fields in the `users` table, all credential data
- **Blind indexes:** HMAC-SHA256 of normalized values for lookups without decryption

### Encryption in Transit
- **TLS:** Enforced at Cloudflare edge (minimum TLS 1.2)
- **Internal:** Worker-to-Worker via Cloudflare service bindings (no network transit)
- **Tokens:** JWT signed with RS256; SAML assertions signed and optionally encrypted

### Access Controls
- **Database:** Only auth-core and account Workers access PII via Hyperdrive
- **Service bindings:** Internal-only, not exposed to public internet
- **Admin API:** Bearer token authentication (`ADMIN_API_KEY`)
- **SSN access:** Restricted to internal service key (`INTERNAL_SERVICE_KEY`)
- **Scope-gated claims:** OIDC responses only include claims matching the SP's authorized scopes

### Logging Safeguards
- PII is never written to application logs
- Structured JSON logging includes trace IDs for correlation without PII
- Audit events record event type and user ID, not PII values

---

## 4. User Rights

### Right to Access
- Users can view their profile data via the account management interface
- OIDC userinfo endpoint returns the user's stored claims (scope-gated)

### Right to Correction
- Users can update email, phone, and password via account management endpoints
- Name, DOB, SSN, and address changes require re-proofing (IAL2 verification)

### Right to Deletion (Erasure)
- Account deletion is available via `DELETE /api/account/:userId`
- Deletion is atomic: removes user record, all credentials, email records, and R2 proofing documents
- Deletion emits an `account-purged` SET event to all linked service providers
- Audit log entries referencing the user ID are retained for compliance (anonymized by absence of PII)

### Right to Data Portability
- Users can request an export of their data via the account management interface
- Export includes profile data, linked SP list, and MFA method metadata (not secrets)

---

## 5. Third-Party Data Sharing

| Third Party | Data Shared | Purpose | Safeguards |
|-------------|-------------|---------|------------|
| **Persona** (KYC provider) | Name, DOB, SSN, address, identity documents | Identity verification (IAL2) | API key authentication, TLS in transit, data deleted from Persona after verification |
| **Twilio** | Phone number | SMS OTP delivery | API key authentication, TLS in transit, Twilio does not store message content |
| **Service Providers** (relying parties) | Pairwise subject ID + authorized claims | Federated authentication (OIDC/SAML) | Claims limited by SP-registered scopes, pairwise IDs prevent cross-SP tracking |
| **Cloudflare** | Request metadata (IP, headers) | Edge compute, DDoS protection | Cloudflare DPA in place, no PII in request body logging |
| **PlanetScale** | Encrypted PII (ciphertext) | Database storage | Encryption at application layer (PlanetScale sees only ciphertext), SOC 2 Type II compliant |

---

## 6. Data Breach Notification

### Detection
- Automated alerts for anomalous data access patterns (see `INCIDENT_RESPONSE.md`)
- Manual reporting channel for suspected breaches

### Assessment (within 24 hours)
1. Determine scope: which data elements and how many users affected
2. Assess whether PII was exposed in plaintext (vs. encrypted ciphertext only)
3. Determine attack vector and whether it is contained

### Notification Timeline
| Audience | Timeline | Method |
|----------|----------|--------|
| Internal security team | Immediately | Incident channel |
| Executive / CISO | Within 1 hour | Direct communication |
| Affected users | Within 72 hours | Email notification |
| Regulatory authorities | Per applicable law (typically 72 hours) | Written notification |
| Service providers | Within 72 hours | RISC SET event (`credential-compromise` or `account-purged`) |

### Notification Content
- Description of the breach
- Data elements affected
- Actions taken to contain the breach
- Steps users should take (e.g., change password, re-enroll MFA)
- Contact information for questions

---

## 7. Review Schedule

- **Quarterly:** Review data inventory for accuracy
- **Annually:** Full privacy impact assessment
- **On new feature:** Privacy review before collecting new data elements
- **On new third-party integration:** Data sharing assessment and DPA review
