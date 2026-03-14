# Infrastructure Security & WAF Configuration

**SOC II Criteria:** CC6.6 (Logical Access), CC6.7 (System Operations), CC7.1 (Vulnerability Management)
**Last Updated:** 2026-03-14
**Owner:** Infrastructure Team

---

## 1. Architecture Overview

```
                         ┌─────────────────────────┐
                         │   Cloudflare Edge (WAF)  │
                         │   DDoS + TLS + Headers   │
                         └──────────┬──────────────┘
                                    │
              ┌─────────────────────┼─────────────────────┐
              │                     │                     │
        ┌─────┴─────┐       ┌──────┴──────┐       ┌──────┴──────┐
        │ auth-core  │       │     mfa     │       │   account   │
        │  (Worker)  │       │  (Worker)   │       │  (Worker)   │
        └─────┬──────┘       └──────┬──────┘       └──────┬──────┘
              │                     │                     │
              ├─────── Service Bindings (internal) ───────┤
              │                                           │
     ┌────────┴────────┐                        ┌─────────┴─────────┐
     │  PlanetScale DB │                        │  Cloudflare KV/DO │
     │  (via Hyperdrive)│                        │  (Sessions, Cache) │
     └─────────────────┘                        └───────────────────┘
```

---

## 2. Cloudflare WAF Rules

The following WAF rules should be configured in the Cloudflare Dashboard for the `login.gov` zone. These rules are managed outside the codebase and should be reviewed quarterly.

### Rate Limiting Rules

| Rule Name | Scope | Threshold | Window | Action | Rationale |
|-----------|-------|-----------|--------|--------|-----------|
| Auth endpoint rate limit | `/openid_connect/authorize` | 30 req | 60s | Challenge | Prevent automated auth probing |
| Token endpoint rate limit | `/api/openid_connect/token` | 20 req | 60s | Block | Prevent token brute force |
| MFA verification rate limit | `/mfa/verify*` | 5 req | 60s | Block | Prevent MFA brute force |
| Password endpoints rate limit | `/password/*` | 5 req | 300s | Block | Prevent credential stuffing |
| Global rate limit | `*` | 300 req | 60s | Challenge | General abuse prevention |
| Login page rate limit | `/api/auth/sign-in*` | 10 req | 60s | Block | Prevent password spraying |

### IP Reputation Rules

| Rule Name | Condition | Action | Rationale |
|-----------|-----------|--------|-----------|
| Block known bad IPs | Cloudflare Threat Score > 50 | Block | Known malicious sources |
| Challenge suspicious IPs | Cloudflare Threat Score > 25 | JS Challenge | Moderate risk sources |
| Bot management | Bot Score < 30 (non-verified) | Challenge | Automated attack prevention |

### Firewall Rules

| Rule Name | Expression | Action | Rationale |
|-----------|-----------|--------|-----------|
| Block non-HTTPS | `not ssl` | Block | Enforce TLS |
| Admin IP restriction | Path `/service-providers/*` AND IP not in admin allowlist | Block | Restrict admin access to known IPs |
| Country restrictions | Country not in allowed list (if applicable) | Challenge | Geographic restrictions per policy |
| Block malicious user agents | Known scanner/attacker user agents | Block | Prevent automated scanning |

### Managed Rulesets

| Ruleset | Status | Notes |
|---------|--------|-------|
| Cloudflare Managed Rules | Enabled | OWASP Core Ruleset |
| Cloudflare OWASP Core Rules | Enabled, Paranoia Level 2 | Covers SQLi, XSS, RCE, LFI |
| Cloudflare Leaked Credentials | Enabled | Alerts on compromised credentials |
| Cloudflare Exposed Credentials | Enabled | Checks against breach databases |

---

## 3. TLS Configuration

| Setting | Value | Rationale |
|---------|-------|-----------|
| Minimum TLS Version | TLS 1.2 | Government compliance minimum |
| TLS 1.3 | Enabled | Preferred for new connections |
| Automatic HTTPS Rewrites | Enabled | Prevent mixed content |
| Always Use HTTPS | Enabled | Enforce encrypted transit |
| HSTS | Enabled (max-age=63072000, includeSubDomains, preload) | Set via security headers middleware |
| Opportunistic Encryption | Enabled | Encrypt where possible |
| Certificate Transparency | Enabled | Detect mis-issued certificates |

---

## 4. Network Segmentation

### Public-Facing Endpoints
- `auth-core` Worker: OIDC/OAuth2 endpoints, Well-Known endpoints, health check
- `saml-bridge` Worker: SAML SSO/SLO endpoints

### Internal-Only (Service Bindings)
- `mfa` Worker: Only reachable via `MFA_WORKER` binding from auth-core
- `account` Worker: Only via `ACCOUNT_WORKER` binding
- `admin` Worker: Only via `ADMIN_WORKER` binding (additionally bearer-token gated)
- `identity-proofing` Worker: Only via `IDENTITY_PROOFING` binding
- `security-events` Worker: Only via `SECURITY_EVENTS` binding
- `infra` Worker: Only via `INFRA_WORKER` binding

### Database Access
- PlanetScale: Accessible only via Cloudflare Hyperdrive binding
- No direct database connections from the internet
- Connection pooling handled by Hyperdrive

---

## 5. DDoS Protection

| Layer | Protection | Provider |
|-------|-----------|----------|
| L3/L4 | Always-on network-layer DDoS mitigation | Cloudflare |
| L7 | HTTP flood protection, WAF rate limiting | Cloudflare |
| Application | KV-backed rate limiting (sliding window) | Application code |
| Emergency | Under Attack Mode (manual activation) | Cloudflare |

---

## 6. Content Delivery & Caching

| Endpoint Type | Cache Behavior | Rationale |
|--------------|----------------|-----------|
| `/.well-known/*` | Cache 1 hour (Cloudflare edge) | Public discovery metadata |
| `/api/openid_connect/certs` | Cache 1 hour (Cloudflare + KV) | Public JWKS |
| Auth/token endpoints | No cache (`Cache-Control: no-store`) | Sensitive, dynamic |
| Health checks | No cache | Real-time status |

---

## 7. Secrets & Environment Configuration

### Environment Isolation

| Environment | Wrangler Config | Secrets Scope | Database |
|-------------|----------------|---------------|----------|
| Development | Default (`wrangler dev`) | Local `.dev.vars` | Local D1 |
| Staging | `--env staging` | Staging Worker secrets | Staging PlanetScale branch |
| Production | `--env production` | Production Worker secrets | Production PlanetScale |

### Secret Deployment
```bash
# Set a secret for an environment
wrangler secret put JWT_SIGNING_KEY --env production

# List secrets (names only — values never displayed)
wrangler secret list --env production
```

---

## 8. Deployment Security

### Deployment Pipeline
1. Code pushed to GitHub
2. CI pipeline runs (typecheck, test, audit) — see `.github/workflows/ci.yml`
3. Staging deploy on merge to `main` — see `.github/workflows/deploy.yml`
4. Production deploy on version tag (`v*`)
5. Each environment has its own Cloudflare API token (scoped)

### Rollback Procedure
```bash
# List recent deployments
wrangler deployments list

# Rollback to previous version (instant, <1 minute)
wrangler rollback
```

### Deployment Versioning
- Cloudflare retains deployment history for 30 days
- Each deployment is immutable and versioned
- Rollback restores the previous version atomically

---

## 9. Review Schedule

- **Weekly:** Review WAF analytics for blocked requests and false positives
- **Monthly:** Review rate limiting effectiveness and adjust thresholds
- **Quarterly:** Full WAF rule audit, update IP reputation rules
- **Annually:** TLS configuration review, managed ruleset updates
- **On incident:** Review and update WAF rules based on attack patterns
