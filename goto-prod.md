# Going to Production Checklist

Everything you need to sign up for, configure, and collect before deploying.

---

## 1. Cloudflare (Hosting & Infrastructure)

**Sign up**: [dash.cloudflare.com](https://dash.cloudflare.com)

You need a **Workers Paid plan** ($5/mo base) to access all the primitives this project uses.

| What to set up             | Why                                      |
|----------------------------|------------------------------------------|
| Workers                    | Runs all backend services                |
| KV Namespaces (6)          | Sessions, SP config, JWKS, flags, OTP, rate limiting |
| R2 Buckets (3)             | Audit logs, proofing docs, key archive   |
| Queues (4)                 | Email, SET, audit, fraud pipelines       |
| Durable Objects            | Session state (SessionDO)                |
| Hyperdrive                 | Connection pooling to PlanetScale        |
| Custom domain / DNS        | Route your domain through Cloudflare     |

**Tokens to collect**:
- `CLOUDFLARE_ACCOUNT_ID` — from dashboard overview
- `CLOUDFLARE_API_TOKEN` — create one with Workers/KV/R2/Queues edit permissions

---

## 2. PlanetScale (Database)

**Sign up**: [planetscale.com](https://planetscale.com)

Create a database, run migrations, and grab the connection string.

**Tokens to collect**:
- `DATABASE_URL` — connection string (used locally and wired through Hyperdrive in prod)

---

## 3. Twilio (SMS & Voice MFA)

**Sign up**: [twilio.com/try-twilio](https://www.twilio.com/try-twilio)

Buy a phone number with SMS + Voice capability.

**Tokens to collect**:
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_FROM_NUMBER` — the phone number you provision

---

## 4. Persona (Identity Proofing / IAL2)

**Sign up**: [withpersona.com](https://withpersona.com)

Set up an inquiry template for document + selfie verification.

**Tokens to collect**:
- `PERSONA_API_KEY`

---

## 5. Google OAuth (Social Login)

**Set up**: [console.cloud.google.com](https://console.cloud.google.com) → APIs & Services → Credentials

Create an OAuth 2.0 Client ID (Web application type). Add your prod redirect URI.

**Tokens to collect**:
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`

---

## 6. GitHub OAuth (Social Login)

**Set up**: [github.com/settings/developers](https://github.com/settings/developers) → OAuth Apps → New

Add your prod callback URL.

**Tokens to collect**:
- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`

---

## 7. Secrets You Generate Yourself

These aren't from a service — you create them locally.

| Secret             | What it is                          | How to generate                         |
|--------------------|-------------------------------------|-----------------------------------------|
| `JWT_SIGNING_KEY`  | RS256 private key for signing JWTs  | `openssl genrsa 4096`                   |
| `ENCRYPTION_KEY`   | AES-256-GCM key for PII at rest    | `openssl rand -hex 32`                  |
| `PAIRWISE_SALT`    | HMAC salt for pairwise subject IDs | `openssl rand -hex 32`                  |
| `ADMIN_API_KEY`    | Admin portal auth                  | `openssl rand -hex 32`                  |
| `INTERNAL_SERVICE_KEY` | Worker-to-worker auth          | `openssl rand -hex 32`                  |

---

## 8. GitHub Actions Secrets (CI/CD)

In your repo → Settings → Secrets and variables → Actions, add:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

The deploy workflow triggers on push to `main` (staging) and `v*` tags (production).

---

## 9. Production Environment Variables

These are config values (not secrets) you'll set per environment:

| Variable          | Example                          |
|-------------------|----------------------------------|
| `ENVIRONMENT`     | `production`                     |
| `BASE_URL`        | `https://login.yourdomain.gov`   |
| `ALLOWED_ORIGINS` | `https://login.yourdomain.gov`   |

---

## 10. Service Provider Onboarding

For each agency/app that will authenticate through you, collect:

- Their **public key** (PEM, for `private_key_jwt` client auth)
- **Redirect URIs**
- **Post-logout redirect URIs**
- **IAL/AAL requirements** (1 or 2)
- **SAML metadata URL** (if using SAML instead of OIDC)
- **Push notification URL** (if using RISC/SET events)

Register these via the admin API using your `ADMIN_API_KEY`.

---

## Quick Reference: All Secrets & Tokens

```
# External services
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_FROM_NUMBER=
PERSONA_API_KEY=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
DATABASE_URL=

# Self-generated
JWT_SIGNING_KEY=
ENCRYPTION_KEY=
PAIRWISE_SALT=
ADMIN_API_KEY=
INTERNAL_SERVICE_KEY=

# Cloudflare (CI/CD)
CLOUDFLARE_API_TOKEN=
CLOUDFLARE_ACCOUNT_ID=

# Config
ENVIRONMENT=production
BASE_URL=
ALLOWED_ORIGINS=
```

---

## Order of Operations

1. **Cloudflare** — set up account, domain, and Workers paid plan
2. **PlanetScale** — create database, run migrations, configure Hyperdrive
3. **Generate secrets** — JWT key, encryption key, salts, API keys
4. **Twilio** — account + phone number
5. **Persona** — account + inquiry template
6. **Google & GitHub OAuth** — create apps with prod redirect URIs
7. **GitHub Actions** — add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as repo secrets
8. **Deploy** — push to `main` for staging, tag `v*` for production
9. **Onboard SPs** — register service providers via admin API
