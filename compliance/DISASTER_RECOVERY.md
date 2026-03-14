# Disaster Recovery Plan

**SOC II Criteria:** A1.2 (Recovery Infrastructure), A1.3 (Recovery Plan Testing)
**Last Updated:** 2026-03-14
**Owner:** Infrastructure Team

---

## 1. Recovery Objectives

| Objective | Target | Rationale |
|-----------|--------|-----------|
| **RTO** (Recovery Time Objective) | 1 hour | Max acceptable downtime before auth services must be restored |
| **RPO** (Recovery Point Objective) | 5 minutes | Max acceptable data loss window (PlanetScale replication lag) |
| **MTTR** (Mean Time To Repair) | 30 minutes | Target average resolution time for infrastructure failures |

---

## 2. Architecture & Redundancy

### Cloudflare Workers (Compute)
- **Redundancy:** Automatically deployed to 300+ edge locations globally
- **Failover:** Cloudflare handles edge failover transparently
- **Rollback:** `wrangler rollback` restores previous deployment instantly
- **Risk:** Bad deployment propagates globally within seconds

### PlanetScale / Vitess (Database)
- **Redundancy:** Multi-AZ replication within the primary region
- **Backups:** Automatic daily backups with 7-day retention (PlanetScale managed)
- **Point-in-time restore:** Available within the backup retention window
- **Branching:** PlanetScale branches allow schema testing before promotion
- **Risk:** Regional outage could affect primary database

### Cloudflare KV (Session, Config, Rate Limiting)
- **Redundancy:** Eventually consistent across all edge locations
- **Persistence:** Data survives Worker redeployments
- **Risk:** Eventual consistency means stale reads possible (acceptable for rate limiting, sessions use DOs)

### Cloudflare Durable Objects (Sessions)
- **Redundancy:** Single-point-of-presence per object (strong consistency trade-off)
- **Failover:** Cloudflare relocates DO if underlying hardware fails
- **Risk:** DO migration during failover causes brief unavailability for that session

### Cloudflare R2 (Audit Logs, Key Archive, Proofing Docs)
- **Redundancy:** 11 nines durability (S3-compatible)
- **Risk:** Accidental deletion; mitigate with R2 object lock (if available) or cross-bucket replication

### Cloudflare Queues (Email, SET, Audit, Fraud)
- **Retry:** Configured max_retries per queue (3-5 retries)
- **Dead letters:** Failed messages retained for inspection
- **Risk:** Queue backlog during outage; consumers resume processing on recovery

---

## 3. Backup Inventory

| Data | Location | Backup Method | Retention | Frequency |
|------|----------|---------------|-----------|-----------|
| User data (PII) | PlanetScale | Automatic managed backups | 7 days | Daily |
| Signing keys | R2 (`R2_KEYS/keys/{kid}.enc`) | Encrypted archive on rotation | Indefinite | Hourly (on rotation) |
| Audit logs | R2 (`R2_AUDIT/audit/YYYY/MM/DD/`) | Queue-based daily flush | 7 years | Daily |
| Proofing documents | R2 (`R2_PROOFING`) | At-rest storage | Per retention policy | On upload |
| SP configurations | KV (`KV_SP_CONFIG`) + PlanetScale | Database is source of truth | Per DB backup | On change |
| Feature flags | KV (`KV_FLAGS`) | Recreatable from deployment config | N/A | On deploy |
| Worker code | Cloudflare (version history) | Automatic versioning | 30 days | On deploy |
| Wrangler config | Git repository | Source control | Indefinite | On commit |

---

## 4. Recovery Procedures

### Scenario 1: Bad Deployment
1. Detect: Elevated error rates post-deploy (alert threshold: >1% error rate)
2. Respond: `wrangler rollback` (restores previous version, <1 min)
3. Verify: Monitor error rate returns to baseline
4. Follow-up: Debug in staging, re-deploy when fixed

### Scenario 2: PlanetScale Outage
1. Detect: Database connection failures (health check fails)
2. Impact: New auth flows fail; existing sessions (KV/DO) continue working
3. Respond:
   - Check PlanetScale status page
   - If regional: wait for PlanetScale failover (automatic)
   - If prolonged: enable degraded mode (KV-only auth for existing sessions)
4. Recovery: Database connections auto-reconnect via Hyperdrive
5. Verify: Run `SELECT 1` health check, verify auth flow end-to-end

### Scenario 3: Signing Key Compromise
1. Detect: Secret exposure alert or suspicious token activity
2. Respond:
   - Rotate `JWT_SIGNING_KEY` via `wrangler secret put`
   - Trigger immediate key rotation cron
   - Old public key remains in JWKS for token validation overlap
3. Verify: New tokens signed with new key, old tokens still validate until expiry
4. Follow-up: Audit token usage logs for unauthorized access

### Scenario 4: Encryption Key Compromise
1. Detect: Secret exposure alert
2. Respond:
   - Rotate `ENCRYPTION_KEY` via `wrangler secret put`
   - Run re-encryption migration for all PII data
   - Rotate `PAIRWISE_SALT` if also compromised
3. Verify: Decrypt/encrypt round-trip test on known records
4. Follow-up: Notify affected users per breach notification policy

### Scenario 5: Complete Cloudflare Outage
1. Detect: Global Cloudflare outage (external status page)
2. Impact: Full service outage — no mitigation possible at application layer
3. Respond:
   - Monitor Cloudflare status page
   - Communicate to stakeholders via out-of-band channels
   - Prepare for traffic surge on recovery
4. Recovery: Services auto-recover when Cloudflare restores

### Scenario 6: Accidental Data Deletion
1. Detect: Missing records, user reports, or monitoring anomalies
2. Respond:
   - If PlanetScale: restore from point-in-time backup
   - If KV: recreate from PlanetScale (source of truth)
   - If R2 audit logs: retrieve from daily backup archives
3. Verify: Row counts and checksums match pre-deletion state

---

## 5. Recovery Testing

### Quarterly Tests
| Test | Procedure | Success Criteria |
|------|-----------|-----------------|
| Deployment rollback | Deploy known-bad config to staging, execute `wrangler rollback` | Service restored within 2 minutes |
| Database restore | Restore PlanetScale backup to a branch, verify data integrity | All rows present, checksums match, PII decryptable |
| Key rotation recovery | Delete JWKS from KV, verify cron restores from R2 archive | JWKS endpoint returns valid keys within 1 hour |
| Queue backlog recovery | Pause consumers, accumulate messages, resume | All queued messages processed within 30 minutes |

### Annual Tests
| Test | Procedure | Success Criteria |
|------|-----------|-----------------|
| Full disaster simulation | Simulate complete environment rebuild from git + secrets | Service operational within RTO (1 hour) |
| Tabletop exercise | Walk through SEV-1 scenario with all stakeholders | All team members know their roles and procedures |

---

## 6. Review Schedule

- **Quarterly:** Run recovery tests, update procedures based on results
- **After every SEV-1/2:** Review DR plan relevance to the incident
- **Annually:** Full DR plan review, update RTO/RPO targets, tabletop exercise
- **On architecture change:** Update backup inventory and recovery procedures
