# Incident Response Plan

**SOC II Criteria:** CC7.3 (Risk Mitigation), CC7.4 (Response to Identified Anomalies)
**Last Updated:** 2026-03-14
**Owner:** Security Operations Team

---

## 1. Severity Levels

| Level | Definition | Response Time | Examples |
|-------|-----------|---------------|----------|
| **SEV-1** (Critical) | Service fully unavailable or active data breach | 15 minutes | Database compromise, credential leak, total outage |
| **SEV-2** (High) | Significant degradation or potential security incident | 1 hour | Auth failures >10%, key rotation failure, elevated error rates |
| **SEV-3** (Medium) | Partial degradation or suspicious activity | 4 hours | Single service degraded, unusual traffic patterns, failed dependency |
| **SEV-4** (Low) | Minor issue, no user impact | Next business day | Cosmetic errors, non-critical alerting noise |

---

## 2. Alert Thresholds

### Authentication & Authorization
| Metric | Threshold | Severity | Action |
|--------|-----------|----------|--------|
| Failed auth rate | >5% of requests over 5 min | SEV-2 | Investigate credential stuffing or system error |
| Token endpoint errors | >1% over 5 min | SEV-2 | Check PlanetScale connectivity, key signing |
| PKCE validation failures | >10 in 1 min | SEV-3 | Possible integration misconfiguration or attack |
| Authorization code reuse attempts | >5 in 1 min | SEV-2 | Potential replay attack |

### Infrastructure
| Metric | Threshold | Severity | Action |
|--------|-----------|----------|--------|
| Worker error rate | >1% of requests over 5 min | SEV-2 | Check Cloudflare status, recent deployments |
| Response time p95 | >2000ms over 5 min | SEV-3 | Check Hyperdrive/PlanetScale latency |
| Queue dead letters | >0 messages | SEV-3 | Inspect failed messages, check consumer health |
| Rate limit violations | >100/min from single IP | SEV-3 | Review WAF rules, potential DDoS |
| Key rotation cron miss | >2 consecutive failures | SEV-2 | Manual key rotation, check cron health |

### MFA
| Metric | Threshold | Severity | Action |
|--------|-----------|----------|--------|
| TOTP verification failures | >10/min per user | SEV-2 | Potential brute force, enforce lockout |
| SMS OTP delivery failures | >5% over 10 min | SEV-3 | Check Twilio status, SMS provider health |

### Data & Privacy
| Metric | Threshold | Severity | Action |
|--------|-----------|----------|--------|
| PII decryption errors | >0 | SEV-2 | Possible key mismatch, check ENCRYPTION_KEY |
| Database connection failures | >3 in 1 min | SEV-1 | Check Hyperdrive, PlanetScale status |

---

## 3. Escalation Path

```
Alert Triggered
    │
    ├─ SEV-4 → On-call engineer (async, next business day)
    ├─ SEV-3 → On-call engineer (4hr SLA)
    ├─ SEV-2 → On-call engineer (1hr SLA) → Engineering Lead
    └─ SEV-1 → On-call engineer (15min SLA) → Engineering Lead → CISO → Executive Team
```

### Contact Channels
- **Primary:** PagerDuty (or configured alerting tool)
- **Secondary:** Dedicated #incidents Slack channel
- **Escalation:** Phone tree for SEV-1

---

## 4. Incident Response Procedure

### Step 1: Detect & Acknowledge
- Acknowledge the alert within the response time SLA
- Create an incident ticket with severity, description, and affected services
- Join the incident channel (e.g., #incident-YYYY-MM-DD)

### Step 2: Assess & Triage
- Confirm the severity level
- Identify affected components (auth-core, mfa, session-do, saml-bridge, etc.)
- Check recent deployments: `wrangler deployments list`
- Check Cloudflare dashboard for platform-level issues
- Review logs: Cloudflare Logpush → search by trace ID

### Step 3: Contain
- If active breach: rotate compromised secrets immediately
  - `wrangler secret put JWT_SIGNING_KEY`
  - `wrangler secret put ENCRYPTION_KEY`
  - `wrangler secret put ADMIN_API_KEY`
- If bad deployment: roll back via `wrangler rollback`
- If DDoS: escalate to Cloudflare Under Attack mode
- If database compromise: enable PlanetScale read-only mode

### Step 4: Remediate
- Deploy the fix through the standard CI/CD pipeline
- Verify fix in staging before production
- Monitor metrics for 30 minutes post-deploy

### Step 5: Communicate
- **Internal:** Post status updates every 30 min (SEV-1/2), every 2 hours (SEV-3)
- **External:** Update status page for user-facing impact
- **Regulatory:** If PII breach confirmed, initiate breach notification per `PRIVACY_POLICY.md`

---

## 5. Runbooks

### Runbook: Key Rotation Failure
1. Check cron trigger logs: `wrangler tail --format json | grep key-rotation`
2. Verify KV_JWKS has valid keys: check key TTLs (should be 7 days)
3. Manual rotation: trigger the cron handler directly via `curl POST /internal/rotate-keys`
4. Verify JWKS endpoint returns valid keys: `curl https://secure.login.gov/api/openid_connect/certs`
5. If keys are missing, restore from R2 backup: `R2_KEYS/keys/{kid}.enc`

### Runbook: Database Connection Loss
1. Check PlanetScale status page
2. Check Hyperdrive binding status in Cloudflare dashboard
3. Verify `HYPERDRIVE` binding ID matches environment config
4. Test connectivity: deploy a minimal health-check Worker
5. If PlanetScale outage: service degrades gracefully (KV sessions still work, new auth flows fail)

### Runbook: Elevated Error Rate
1. Check `wrangler tail` for error patterns
2. Correlate with recent deployments: `wrangler deployments list`
3. If deployment-related: `wrangler rollback`
4. If dependency-related: check Twilio, Persona, PlanetScale status
5. If traffic-related: review rate limiter effectiveness, adjust WAF rules

### Runbook: Suspected Credential Stuffing
1. Check rate limit violation logs for IP concentration
2. If single IP: block via Cloudflare WAF rule
3. If distributed: enable Cloudflare Bot Management (if available)
4. Review failed auth logs for targeted accounts
5. If accounts compromised: force password reset via `QUEUE_EMAIL`
6. Emit RISC SET events to affected SPs

### Runbook: Secret Exposure
1. **Immediately** rotate the exposed secret via `wrangler secret put <NAME>`
2. If JWT_SIGNING_KEY: rotate keys, old tokens remain valid until expiry (short-lived)
3. If ENCRYPTION_KEY: assess scope — existing encrypted data needs re-encryption migration
4. If ADMIN_API_KEY: rotate and audit admin action logs for unauthorized access
5. Open SEV-1 incident ticket
6. Assess breach scope and initiate notification per `PRIVACY_POLICY.md`

---

## 6. Post-Incident Review (PIR) Template

Complete within **5 business days** of SEV-1/2 resolution.

```markdown
# Post-Incident Review: [Incident Title]

**Date:** YYYY-MM-DD
**Severity:** SEV-X
**Duration:** X hours Y minutes
**Impact:** [Number of affected users/requests]
**Incident Commander:** [Name]

## Timeline
| Time (UTC) | Event |
|------------|-------|
| HH:MM | Alert triggered |
| HH:MM | Acknowledged by [name] |
| HH:MM | Root cause identified |
| HH:MM | Fix deployed |
| HH:MM | Monitoring confirmed resolution |

## Root Cause
[Description of the underlying cause]

## What Went Well
- [Item]

## What Could Be Improved
- [Item]

## Action Items
| Action | Owner | Due Date | Status |
|--------|-------|----------|--------|
| [Action] | [Name] | YYYY-MM-DD | Open |

## Lessons Learned
[Key takeaways for preventing recurrence]
```

---

## 7. Review Schedule

- **Quarterly:** Review and update alert thresholds based on traffic patterns
- **After every SEV-1/2:** Conduct PIR and update runbooks
- **Annually:** Full incident response plan review and tabletop exercise
