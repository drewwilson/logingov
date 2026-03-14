# @logingov/shared

Shared types, schemas, cryptography, and utilities used across all Login.gov Workers. This package is a dependency of every other package in the monorepo and contains no runtime-specific code beyond the Web Crypto API (available in Cloudflare Workers).

## Modules

### `types/` — Core entity types and constants

- **Entity interfaces**: `User`, `Credential`, `ServiceProvider`, `IdentityEvent`
- **Assurance levels**: `IALLevel`, `AALLevel`, `AssuranceLevels`
- **ACR value mappings** (`ACR_VALUES`): Maps OIDC ACR URNs (current and deprecated) to IAL/AAL levels
- **OIDC scope-to-attribute mappings** (`SCOPE_ATTRIBUTES`): Defines which user attributes each scope grants access to
- **RISC/SET event types** (`SET_EVENT_TYPES`): Security Event Token URIs for account lifecycle events

### `schema/` — Drizzle ORM table definitions

Drizzle ORM schema for PlanetScale (MySQL 8 / Vitess). Tables:

- `users` — Core user records with encrypted PII fields
- `userEmails` — Multiple email addresses per user
- `credentials` — Password, WebAuthn, TOTP, and backup codes (encrypted JSON blobs)
- `serviceProviders` — Relying party configuration
- `authCodes` — Single-use OIDC authorization codes with PKCE support
- `identityEvents` — Append-only audit log

### `crypto/` — AES-256-GCM encryption and UUID v7

All functions use the Web Crypto API with no Node.js dependencies.

- `importKey(hexKey)` — Import a raw hex key into a `CryptoKey`
- `encrypt(plaintext, key)` / `decrypt(encoded, key)` — AES-256-GCM with random IV, output as base64
- `generateKeyHex()` — Generate a new 256-bit key as hex
- `computePairwiseSub(userId, sectorIdentifier, salt)` — HMAC-SHA256 pairwise subject identifiers per OIDC spec
- `uuidV7()` — Time-ordered UUID v7 generation

### `queue/` — Queue message types

Typed envelope (`QueueMessage<T>`) and payload interfaces for all Cloudflare Queue workstreams:

- `email:send`, `email:verify` — Transactional email
- `set:outbound`, `set:fraud-action` — Security Event Tokens and fraud response
- `audit:write` — Audit log ingestion
- `cleanup:expired` — TTL-based cleanup
- `createQueueMessage()` — Factory with automatic timestamp and trace ID

### `env.ts` — Worker environment bindings

The `Env` interface used by every Worker, declaring all database bindings (PlanetScale via Hyperdrive), KV namespaces, R2 buckets, Queues, Durable Objects, service bindings, and secrets.

### `kv.ts` — KV key patterns and helpers

- `KV_KEYS` — Namespaced key builders for sessions, SP config, JWKS, feature flags, OTPs, and rate limits
- `KV_TTL` — Standard TTL constants (e.g., 15-minute sessions, 10-minute OTPs)
- `kvGet<T>()` / `kvPut<T>()` / `kvDelete()` — Typed JSON serialization wrappers around `KVNamespace`
- `getFlag()` / `getFlags()` — Boolean feature flag readers

### `errors.ts` — Error classes and response helpers

- `AppError` base class with `code`, `statusCode`, and optional `details`
- Subclasses: `UnauthorizedError`, `ForbiddenError`, `NotFoundError`, `ConflictError`, `RateLimitError`, `ServiceUnavailableError`
- `errorResponse(error)` — Serialize an `AppError` to a JSON `Response` with correct status and headers
- `jsonResponse(data, status?, headers?)` — Generic JSON response builder

### `service-binding.ts` — Worker-to-Worker RPC

`callWorker<T>(fetcher, path, options?)` wraps Cloudflare service binding `fetch()` calls with JSON serialization, error propagation, and automatic trace ID forwarding. Supports both JSON-parsed and raw `Response` return modes.

### `ial-evaluator.ts` — IAL evaluation

`evaluateIAL(userIal, requestedIal)` — Pure function that determines whether a user's current identity assurance level satisfies a service provider's request, and whether identity proofing is needed.

## Usage

All exports are available from the package root:

```ts
import { type User, ACR_VALUES, encrypt, importKey, kvGet, KV_KEYS, AppError } from "@logingov/shared";
```
