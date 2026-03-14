# @logingov/infra

Infrastructure utilities package for the Login.gov cloud-native rebuild. Provides observability, rate limiting, queue infrastructure, cron triggers, i18n, risk evaluation, and session management -- shared across all Workers in the monorepo.

## Modules

### Observability (`observability/`)

**Tracing middleware** (`tracing`) instruments every Hono request with W3C Trace Context. Propagates incoming `traceparent` headers or generates new trace/span IDs. Attaches a request-scoped `Logger` to the Hono context.

```ts
import { tracing, getTraceContext } from "@logingov/infra";

app.use("*", tracing({ serviceName: "auth-core" }));

// In a handler:
const { traceId } = c.get("trace");
const log = c.get("logger");
log.info("Token issued", { userId });
```

**Logger** outputs structured JSON to `console.log`/`console.error`, which Cloudflare ships via Logpush. Supports child loggers with inherited context (traceId, spanId, service).

### Rate Limiter (`rate-limiter.ts`)

Application-layer sliding-window rate limiter using `KV_RATE_LIMIT`. Replaces Rack::Attack from the Rails stack. Two-layer defense:

1. **Edge** -- Cloudflare WAF rate limiting rules (configured in the dashboard)
2. **Application** -- this middleware, with per-endpoint thresholds and composite key extraction (IP + method + path by default)

Default limits are defined for auth, MFA, password, and proofing endpoints. Returns standard `X-RateLimit-*` headers and `429` responses with `Retry-After`.

```ts
import { rateLimiter } from "@logingov/infra";

app.use("*", rateLimiter());
app.use("/auth/*", rateLimiter({ limits: { "POST /auth/token": { maxRequests: 10, windowSeconds: 60 } } }));
```

### Queue (`queue/`)

Typed producer/consumer infrastructure for Cloudflare Queues.

- **`enqueue` / `enqueueBatch`** -- type-safe producers that wrap `createQueueMessage` from `@logingov/shared`. Message types include `audit:write`, `email:send`, `email:verify`, `set:outbound`, `set:fraud-action`, and `cleanup:expired`.
- **`BaseConsumer`** -- abstract class with batch or individual processing modes, exponential backoff retry (2^n seconds, capped at 5 min), and dead-letter logging after max retries (default 3).

```ts
import { enqueue } from "@logingov/infra";

await enqueue(env.QUEUE_AUDIT, "audit:write", userId, {
  eventType: "authentication",
  ip: "1.2.3.4",
  aal: 2,
  metadata: { method: "webauthn" },
});
```

### Consumers (`consumers/`)

- **`AuditConsumer`** -- processes `QUEUE_AUDIT` messages. Batch-inserts events into PlanetScale `identity_events` and appends JSON Lines to R2 (`audit/YYYY/MM/DD.jsonl`).

### Cron Triggers (`cron/`)

The infra Worker handles three cron schedules (defined in `wrangler.toml`):

| Schedule | Handler | Purpose |
|---|---|---|
| `0 */1 * * *` (hourly) | `handleKeyRotation` | Generates new RS256 keypair when the active key is >23h old. Stores encrypted private key in R2, publishes public JWKS to KV. Keeps 2 active keys for graceful rotation. |
| `*/5 * * * *` (5 min) | `handleCleanup` | Deletes expired auth codes from PlanetScale. |
| `0 0 * * *` (daily) | (reserved) | Slot available for future maintenance tasks. |

The JWKS endpoint is served at `/.well-known/jwks.json` with a 1-hour cache.

### i18n (`i18n/`)

Bundled translation strings (no KV round-trip at runtime). Supports `en`, `es`, `fr`.

- **`t(locale, key, vars?)`** -- translate with `{variable}` interpolation, falls back to English then returns the key itself.
- **`detectLocale(c)`** -- resolves locale from query param > `x-session-locale` header > `Accept-Language` header > `"en"`.

```ts
import { t, detectLocale } from "@logingov/infra";

const locale = detectLocale(c);
const msg = t(locale, "auth.login.locked", { minutes: "5" });
```

### Risk Engine (`risk/`)

Evaluates fraud signals and returns a score (0--100) with recommended actions. Used by the authorize flow to trigger step-up authentication.

Signals scored: failed MFA attempts, new device, geo mismatch (country change), blocked IP list, recently locked account.

| Score | Level | Actions |
|---|---|---|
| 0--30 | low | `allow` |
| 31--50 | medium | `step_up_mfa` |
| 51--70 | medium | `captcha` + `step_up_mfa` |
| 71+ | high | `block` |

```ts
import { evaluateRisk } from "@logingov/infra";

const result = await evaluateRisk({ ip, userId, isNewDevice: true, geo: { country: "US" } }, env);
// result: { score: 10, level: "low", actions: ["allow"] }
```

### Session (`session/`)

Typed helpers for interacting with `SessionDO` Durable Objects. Other Workers use these instead of raw fetch calls.

- `createSession(env, spId, params)` -- creates a new session DO, returns `sessionId` (UUID)
- `getSession(env, sessionId)` -- fetches current session state
- `updateSession(env, sessionId, updates)` -- patches session (e.g., after MFA verification)
- `destroySession(env, sessionId)` -- clears DO storage and KV lookup entry

## Importing

All exports are available from the package root:

```ts
import { rateLimiter, tracing, enqueue, t, evaluateRisk, createSession } from "@logingov/infra";
```

## Local Development

From the monorepo root:

```sh
pnpm dev:infra
```
