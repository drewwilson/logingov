# Access Control Policy

**SOC II Criteria:** CC6.1 (Logical Access Security), CC6.2 (Access Credentials), CC6.3 (Access Removal)
**Last Updated:** 2026-03-14
**Owner:** Security Operations Team

---

## 1. Role Definitions

| Role | Scope | Access Mechanism | Holders |
|------|-------|-----------------|---------|
| **System Admin** | Full Cloudflare account access, secret management, deployment | Cloudflare Dashboard (SSO + MFA required) | Infrastructure team leads |
| **Deployer** | Deploy Workers, manage wrangler configs | `CLOUDFLARE_API_TOKEN` (CI/CD) | GitHub Actions (service account) |
| **SP Admin** | Create, update, delete service provider configurations | `ADMIN_API_KEY` bearer token | Identity operations team |
| **Developer** | Code access, staging deployments, log access | GitHub repo access + staging Cloudflare token | Engineering team |
| **Auditor** | Read-only access to logs and audit trails | Cloudflare Logpush dashboard, R2 read access | Compliance team |
| **On-Call** | Emergency access: secret rotation, rollback, WAF rules | Cloudflare Dashboard + `wrangler` CLI | On-call rotation |

---

## 2. Access Provisioning

### Request Process
1. Manager submits access request specifying role, scope, and business justification
2. Security team reviews and approves/denies within 2 business days
3. Access is provisioned via the appropriate mechanism:
   - **Cloudflare Dashboard:** SSO group membership
   - **GitHub:** Repository collaborator or team membership
   - **API tokens:** Generated and stored in CI/CD secrets or password manager
4. Access grant is logged in the access register (spreadsheet or ticketing system)

### Requirements
- All human access to Cloudflare Dashboard requires SSO + MFA
- API tokens must have minimum required permissions (principle of least privilege)
- Service account tokens (CI/CD) must be scoped to specific environments
- No shared personal accounts — each person has individual credentials

---

## 3. Secret Management

### Secrets Inventory

| Secret | Rotation Frequency | Storage | Access |
|--------|--------------------|---------|--------|
| `JWT_SIGNING_KEY` | Hourly (automatic via cron) | Cloudflare Worker secret | auth-core Worker only |
| `ENCRYPTION_KEY` | Annually (manual) | Cloudflare Worker secret | auth-core, account Workers |
| `PAIRWISE_SALT` | Never (changing breaks existing subject IDs) | Cloudflare Worker secret | auth-core Worker only |
| `ADMIN_API_KEY` | Quarterly | Cloudflare Worker secret | admin Worker only |
| `INTERNAL_SERVICE_KEY` | Quarterly | Cloudflare Worker secret | identity-proofing Worker |
| `PERSONA_API_KEY` | Annually | Cloudflare Worker secret | identity-proofing Worker |
| `TWILIO_AUTH_TOKEN` | Annually | Cloudflare Worker secret | mfa Worker only |
| `GOOGLE_CLIENT_SECRET` | Annually | Cloudflare Worker secret | auth-core Worker only |
| `GITHUB_CLIENT_SECRET` | Annually | Cloudflare Worker secret | auth-core Worker only |
| `CLOUDFLARE_API_TOKEN` | Quarterly | GitHub Actions secrets | CI/CD pipeline only |

### Rotation Procedure
1. Generate new secret value
2. Set via `wrangler secret put <NAME> --env <environment>`
3. Verify service health post-rotation
4. Update the access register with rotation date
5. For `JWT_SIGNING_KEY`: automatic — cron rotates hourly with overlap window
6. For `ENCRYPTION_KEY`: requires data re-encryption migration (coordinate with engineering)

---

## 4. Application-Level Access Controls

### User-Facing
| Control | Implementation | File Reference |
|---------|---------------|----------------|
| Same-user enforcement | `requireSameUser` middleware on account/proofing endpoints | `packages/account/src/routes/account.ts` |
| IAL-gated data | Claims only returned if user meets IAL requirement | `packages/auth-core/src/lib/claims.ts` |
| AAL enforcement | MFA-required operations check `achievedAal` | `packages/auth-core/src/routes/authorize.ts` |
| Scope-gated claims | OIDC responses limited to SP-authorized scopes | `packages/auth-core/src/lib/claims.ts` |

### Service-to-Service
| Control | Implementation | File Reference |
|---------|---------------|----------------|
| Service bindings | Internal Workers communicate via Cloudflare bindings (not public) | `wrangler.toml` |
| HMAC authentication | `X-Internal-Auth` header with HMAC-SHA256 signature | `packages/shared/src/service-binding.ts` |
| Admin bearer token | `Authorization: Bearer <ADMIN_API_KEY>` | `packages/admin/src/routes/service-providers.ts` |
| SSN access key | `X-Internal-Service-Key` header validation | `packages/identity-proofing/src/routes/ssn.ts` |

---

## 5. Access Review Process

### Quarterly Reviews
1. **Scope:** All human and service account access to Cloudflare, GitHub, and API tokens
2. **Reviewer:** Security team lead + engineering manager
3. **Procedure:**
   - Export current Cloudflare team members and roles
   - Export GitHub repository collaborators and permissions
   - Cross-reference with the access register and current team roster
   - Identify and remove access for departed team members
   - Verify service accounts still have minimum required permissions
   - Document findings and actions taken
4. **Output:** Access review report, filed with compliance documentation

### Triggers for Immediate Review
- Employee departure or role change
- Security incident involving compromised credentials
- Organizational restructuring

---

## 6. Access Removal

### Employee Departure
Within **24 hours** of departure notification:
1. Remove from Cloudflare Dashboard SSO group
2. Remove from GitHub repository
3. Rotate any shared secrets the departing employee had access to
4. Revoke any personal API tokens
5. Document removal in the access register

### Role Change
Within **48 hours** of role change:
1. Adjust Cloudflare Dashboard permissions to match new role
2. Update GitHub team membership if needed
3. Update the access register

---

## 7. Admin Action Audit Trail

All administrative actions should be logged with:
- Timestamp (UTC)
- Admin identity (derived from bearer token or SSO session)
- Action performed (create, update, delete)
- Target resource (SP ID, user ID, config key)
- Request metadata (IP address, trace ID)

**Implementation:** Admin audit middleware in `packages/admin/src/middleware/audit.ts`

---

## 8. Review Schedule

- **Quarterly:** Access review (Section 5)
- **Quarterly:** Secret rotation for high-frequency secrets (ADMIN_API_KEY, INTERNAL_SERVICE_KEY, CLOUDFLARE_API_TOKEN)
- **Annually:** Full policy review and update
- **On incident:** Emergency access review per `INCIDENT_RESPONSE.md`
