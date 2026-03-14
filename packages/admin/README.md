# @logingov/admin

Admin portal Worker for the Login.gov cloud-native rebuild. Provides Service Provider (SP) onboarding, configuration management, and partner operations via a Hono REST API on Cloudflare Workers.

## Features

- **SP registration** — create, read, update, and delete Service Provider records
- **Certificate upload** — accept PEM public-key certs (JSON or raw body), store in PlanetScale and archive to R2 (`sp-certs/<spId>.pem`)
- **Configuration management** — manage redirect URIs, post-logout redirect URIs, IAL/AAL assurance levels, SAML metadata URLs, and push notification URLs
- **KV cache invalidation** — writes and deletes invalidate the `KV_SP_CONFIG` cache so auth-core always sees fresh SP data

## Routes

All routes are mounted under `/service-providers`.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check |
| `GET` | `/service-providers` | List all service providers |
| `GET` | `/service-providers/:spId` | Get a single service provider |
| `POST` | `/service-providers` | Create a new service provider |
| `PUT` | `/service-providers/:spId` | Update a service provider |
| `DELETE` | `/service-providers/:spId` | Delete a service provider |
| `POST` | `/service-providers/:spId/upload-cert` | Upload or replace an SP public-key certificate |

## Storage

| Binding | Type | Purpose |
|---------|------|---------|
| `DB` | PlanetScale (MySQL 8) | Primary store for the `service_providers` table via Drizzle ORM |
| `KV_SP_CONFIG` | KV Namespace | Read-through cache for SP configs; invalidated on every write/delete |
| `R2_KEYS` | R2 Bucket | Archival storage for SP PEM certificates |

SP configs live in PlanetScale as the source of truth. The `auth-core` Worker reads them through `KV_SP_CONFIG` for low-latency lookups. When the admin Worker mutates an SP record it deletes the corresponding `sp:<spId>` KV key so the next read repopulates the cache.

## Service Binding

The `auth-core` Worker calls this Worker via the `ADMIN_WORKER` service binding (a `Fetcher` defined in the shared `Env` type). This keeps admin operations internal — no public internet round-trip.

## Local Development

From the monorepo root:

```sh
pnpm dev:admin
```

## Dependencies

- `@logingov/shared` — shared `Env` type and Drizzle schema (`serviceProviders` table)
- `@logingov/infra` — tracing middleware
- `hono` — HTTP framework
- `drizzle-orm` — query builder for PlanetScale
