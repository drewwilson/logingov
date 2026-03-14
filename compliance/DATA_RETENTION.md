# Data Retention Policy

**SOC II Criteria:** CC6.5 (Data Disposal), P4.2 (Retention and Disposal)
**Last Updated:** 2026-03-14
**Owner:** Compliance Team

---

## 1. Retention Schedule

| Data Category | Storage | Retention Period | Disposal Method | Justification |
|--------------|---------|-----------------|-----------------|---------------|
| **User PII** (email, phone, SSN, DOB, address, name) | PlanetScale (encrypted) | Account lifetime | Hard delete on account deletion | Needed for authentication and identity verification |
| **Password hashes** | PlanetScale (credentials table) | Account lifetime | Hard delete on account deletion | Needed for authentication |
| **MFA credentials** (TOTP secrets, WebAuthn keys, backup codes) | PlanetScale (credentials table) | Account lifetime | Hard delete on account deletion | Needed for multi-factor authentication |
| **Audit log events** (`identity_events` table) | PlanetScale → R2 archive | **7 years** | Automatic purge after retention window | Regulatory compliance, security forensics |
| **R2 audit archives** | R2 (`R2_AUDIT/audit/YYYY/MM/DD/`) | **7 years** | Automatic lifecycle deletion | Long-term compliance record |
| **Identity proofing documents** | R2 (`R2_PROOFING`) | **90 days** post-verification | Automatic lifecycle deletion | KYC verification evidence; minimize PII exposure |
| **Signing key archive** | R2 (`R2_KEYS/keys/{kid}.enc`) | **Indefinite** | Manual review annually | Needed to verify historical token signatures |
| **Session data** (Durable Objects) | Cloudflare DO | 15 min (auth) / 30 days (remembered) | Automatic TTL expiry via DO alarm | Short-lived auth flow state |
| **KV session tokens** | Cloudflare KV (`KV_SESSIONS`) | 15 min (auth) / 30 days (remembered) | Automatic KV TTL expiry | Session validation cache |
| **OAuth authorization codes** | PlanetScale | **10 minutes** | Cron cleanup every 5 min | Single-use, short-lived by protocol |
| **OTP codes** (SMS) | Cloudflare KV (`KV_OTP`) | **10 minutes** | Automatic KV TTL expiry | Short-lived verification codes |
| **Rate limit counters** | Cloudflare KV (`KV_RATE_LIMIT`) | **60–300 seconds** (sliding window) | Automatic KV TTL expiry | Abuse prevention; no PII |
| **JWKS cache** | Cloudflare KV (`KV_JWKS`) | **7 days** | Automatic KV TTL expiry; refreshed hourly | Public key distribution |
| **SP configuration cache** | Cloudflare KV (`KV_SP_CONFIG`) | Until next update | Overwritten on change | Performance cache of DB records |
| **Feature flags** | Cloudflare KV (`KV_FLAGS`) | Until deployment change | Overwritten on deploy | Runtime configuration |
| **Worker deployment history** | Cloudflare | **30 days** (Cloudflare managed) | Automatic by Cloudflare | Rollback capability |
| **Application logs** | Cloudflare Logpush | **30 days** | Automatic by log pipeline | Operational debugging |

---

## 2. Automated Enforcement

### Currently Implemented
- **Session TTL:** Durable Object alarm-based cleanup (15 min / 30 days)
- **KV TTLs:** All KV entries use explicit TTL (OTP: 10 min, sessions: 15 min/30 days, JWKS: 7 days, rate limits: 60–300s)
- **Auth code cleanup:** Cron job every 5 minutes deletes expired authorization codes from PlanetScale
- **Account deletion:** Atomic hard delete of user + credentials + emails + R2 proofing docs

### To Be Implemented
- **Audit log archival purge:** R2 lifecycle rule to delete objects in `R2_AUDIT/audit/` older than 7 years
- **Proofing document purge:** R2 lifecycle rule to delete objects in `R2_PROOFING/` older than 90 days
- **Database audit log cleanup:** Cron job to delete `identity_events` rows older than 7 years after R2 archival is confirmed
- **Application log rotation:** Configure Cloudflare Logpush retention to 30 days

---

## 3. Account Deletion Flow

When a user requests account deletion (`DELETE /api/account/:userId`):

1. **Verify identity:** `requireSameUser` middleware ensures only the account owner can delete
2. **Delete credentials:** All rows in `credentials` table for the user
3. **Delete emails:** All rows in `emails` table for the user
4. **Delete user record:** The `users` row (PII is destroyed)
5. **Delete proofing documents:** Remove all R2 objects in `R2_PROOFING` for the user
6. **Notify service providers:** Emit `account-purged` SET event via `QUEUE_SET`
7. **Audit log preserved:** `identity_events` entries remain (contain userId but no PII — PII was in the now-deleted user record)

---

## 4. Legal Holds

If a legal hold is in place:
- Suspend automated deletion for affected records
- Document the hold scope, requestor, and start date
- Resume normal retention/deletion when the hold is lifted
- Legal holds are tracked outside this system (legal team maintains the register)

---

## 5. Review Schedule

- **Quarterly:** Verify automated purge jobs are running correctly
- **Annually:** Review retention periods against regulatory requirements
- **On regulatory change:** Update retention periods as required
