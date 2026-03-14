# Login.gov Test Migration

Local test harness for migrating data from PostgreSQL (Rails identity-idp) to MySQL 8 (PlanetScale/Vitess). Includes a CLI for running the migration and a web viewer for inspecting both databases side by side.

## Prerequisites

- **PostgreSQL** running on `localhost:5432`
- **MySQL 8** running on `localhost:3306` (user `root`, no password)
- **Node.js** (v18+)

## Setup

### 1. Install dependencies

```bash
cd test-migration
pnpm install
```

### 2. Create the source database (PostgreSQL)

```bash
createdb logingov_source
psql -f seed-source.sql logingov_source
```

This creates ~50 dummy users with emails, passwords, WebAuthn keys, TOTP secrets, backup codes, service providers, profiles, and audit events.

### 3. Create the target database (MySQL)

```bash
mysql -u root -e "CREATE DATABASE IF NOT EXISTS logingov_target"
mysql -u root logingov_target < target-schema.sql
```

### 4. Run the migration

```bash
pnpm migrate
```

This populates `logingov_target` with migrated data and creates Better Auth tables.

### 5. Start the PlanetScale proxy

The Cloudflare Workers runtime can't use `mysql2` directly (workerd blocks `eval`). A lightweight HTTP proxy translates `@planetscale/database` requests into local MySQL queries.

```bash
# From the project root — run in a separate terminal
pnpm run dev:db
```

This starts the proxy on `http://localhost:3900`. Keep it running alongside `pnpm run dev`.

### 6. Start the dev server

```bash
# From the project root — in another terminal
pnpm run dev
```

Open **http://localhost:8787/demo** to use the demo UI.

## Commands

### Run the full migration

```bash
pnpm migrate
```

Migrates all tables in order: users → profiles → emails → credentials → service providers → events. Runs validation after completion (row counts, credential breakdown, referential integrity).

### Dry run (preview without writing)

```bash
pnpm migrate:dry-run
```

Connects to both databases and reports row counts for each table, but writes nothing to MySQL.

### Migrate a single table

```bash
node migrate.js --table=users
node migrate.js --table=credentials
node migrate.js --table=events
```

Available tables: `users`, `profiles`, `emails`, `credentials`, `service_providers`, `events`.

Note: the user ID mapping is always built first, even for single-table runs.

### Reset the target database

```bash
pnpm reset
```

Deletes all rows from every target table (identity_events, auth_codes, credentials, user_emails, service_providers, users).

### Start the migration viewer

```bash
pnpm start
```

Opens a web UI at **http://localhost:4321** that shows the PostgreSQL source and MySQL target side by side — table counts, schemas, and sample rows.

## What gets migrated

| Source (PostgreSQL)                           | Target (MySQL)                | Notes                                                    |
| --------------------------------------------- | ----------------------------- | -------------------------------------------------------- |
| `users` + `profiles` + `phone_configurations` | `users`                       | PII re-encrypted, phone/profile data merged in           |
| `email_addresses`                             | `user_emails`                 | `primary` → `is_primary`, `confirmed_at` → `verified_at` |
| `passwords`                                   | `credentials` (type=password) | Hash stored as JSON with `needsRehash: true`             |
| `webauthn_configurations`                     | `credentials` (type=webauthn) | Credential ID, public key, sign count                    |
| `auth_app_configurations`                     | `credentials` (type=totp)     | Secret re-encrypted                                      |
| `backup_code_configurations`                  | `credentials` (type=backup)   | Codes re-encrypted                                       |
| `service_providers`                           | `service_providers`           | `issuer` becomes the primary key                         |
| `events`                                      | `identity_events`             | Batched in chunks of 5,000                               |

### Not migrated

- `auth_codes` — ephemeral, expire in minutes
- Better Auth runtime tables — populated when users authenticate
- `identities` — user↔SP linkage rebuilt at runtime

## Test User

- Email: testmigration@example.gov
- Password: Password123! (same as all other seed users)

## Key details

- **IDs**: PostgreSQL integer PKs are mapped to UUID v7s (timestamp-preserving)
- **Encryption**: PII fields use a simulated re-encryption (`migrated_` prefix) until Rails encryption keys are available
- **Batch size**: 5,000 rows per insert
- **Validation**: row count comparison, credential type breakdown, and referential integrity checks (orphaned user_id references)
