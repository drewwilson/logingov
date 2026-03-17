/**
 * Shared test helpers for login.gov integration tests.
 *
 * Provides mock Cloudflare bindings (KV, R2, DO, Queues),
 * test SP configuration, and user factories.
 */

// ── Mock KV Namespace ────────────────────────────────────────

export class MockKV {
  private store = new Map<string, { value: string; expiration?: number }>();

  async get(key: string, opts?: any): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiration && Date.now() / 1000 > entry.expiration) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async put(key: string, value: string, opts?: { expirationTtl?: number; expiration?: number }): Promise<void> {
    const expiration = opts?.expirationTtl
      ? Math.floor(Date.now() / 1000) + opts.expirationTtl
      : opts?.expiration;
    this.store.set(key, { value, expiration });
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async list(opts?: any): Promise<KVNamespaceListResult<unknown, string>> {
    const keys: KVNamespaceListKey<unknown, string>[] = [];
    for (const [name] of this.store) {
      if (opts?.prefix && !name.startsWith(opts.prefix)) continue;
      keys.push({ name } as any);
    }
    return { keys, list_complete: true, cacheStatus: null } as any;
  }

  async getWithMetadata(key: string): Promise<any> {
    return { value: await this.get(key), metadata: null, cacheStatus: null };
  }

  // Expose internal store for test assertions
  _getStore() { return this.store; }
  _clear() { this.store.clear(); }
}

// ── Mock R2 Bucket ──────────────────────────────────────────

export class MockR2 {
  private store = new Map<string, { body: string; httpMetadata?: any }>();

  async get(key: string): Promise<R2ObjectBody | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    return {
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(entry.body));
          controller.close();
        },
      }),
      json: async () => JSON.parse(entry.body),
      text: async () => entry.body,
      arrayBuffer: async () => new TextEncoder().encode(entry.body).buffer,
      key,
      size: entry.body.length,
      httpMetadata: entry.httpMetadata ?? {},
    } as any;
  }

  async put(key: string, value: string | ArrayBuffer | ReadableStream): Promise<any> {
    const body = typeof value === "string" ? value : "";
    this.store.set(key, { body });
    return { key } as any;
  }

  async delete(key: string | string[]): Promise<void> {
    const keys = Array.isArray(key) ? key : [key];
    for (const k of keys) this.store.delete(k);
  }

  async list(opts?: any): Promise<R2Objects> {
    const objects: any[] = [];
    for (const [key] of this.store) {
      if (opts?.prefix && !key.startsWith(opts.prefix)) continue;
      objects.push({ key });
    }
    return { objects, truncated: false } as any;
  }

  _getStore() { return this.store; }
  _clear() { this.store.clear(); }
}

// ── Mock Queue ──────────────────────────────────────────────

export class MockQueue {
  public messages: any[] = [];

  async send(message: any): Promise<void> {
    this.messages.push(message);
  }

  async sendBatch(messages: { body: any }[]): Promise<void> {
    for (const m of messages) this.messages.push(m.body);
  }

  _clear() { this.messages = []; }
}

// ── Mock Durable Object Namespace ───────────────────────────

export class MockSessionDO {
  private sessions = new Map<string, any>();

  idFromName(name: string): { toString: () => string } {
    return { toString: () => name };
  }

  idFromString(id: string): { toString: () => string } {
    return { toString: () => id };
  }

  get(id: any): { fetch: (req: Request) => Promise<Response> } {
    const sessions = this.sessions;
    return {
      fetch: async (req: Request) => {
        const url = new URL(req.url);
        const method = req.method;

        switch (`${method} ${url.pathname}`) {
          case "POST /create": {
            const body = await req.json() as any;
            const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
            const session = { ...body, expiresAt };
            sessions.set(id.toString(), session);
            return new Response(JSON.stringify({ ok: true, expiresAt }), {
              status: 201,
              headers: { "Content-Type": "application/json" },
            });
          }
          case "GET /get": {
            const session = sessions.get(id.toString());
            if (!session) {
              return new Response(JSON.stringify({ error: "session_not_found" }), {
                status: 404,
                headers: { "Content-Type": "application/json" },
              });
            }
            if (new Date(session.expiresAt) < new Date()) {
              sessions.delete(id.toString());
              return new Response(JSON.stringify({ error: "session_expired" }), {
                status: 410,
                headers: { "Content-Type": "application/json" },
              });
            }
            return new Response(JSON.stringify(session), {
              headers: { "Content-Type": "application/json" },
            });
          }
          case "PATCH /update": {
            const session = sessions.get(id.toString());
            if (!session) {
              return new Response(JSON.stringify({ error: "session_not_found" }), {
                status: 404,
                headers: { "Content-Type": "application/json" },
              });
            }
            const updates = await req.json() as any;
            Object.assign(session, updates);
            sessions.set(id.toString(), session);
            return new Response(JSON.stringify({ ok: true }), {
              headers: { "Content-Type": "application/json" },
            });
          }
          case "DELETE /destroy": {
            sessions.delete(id.toString());
            return new Response(JSON.stringify({ ok: true }), {
              headers: { "Content-Type": "application/json" },
            });
          }
          default:
            return new Response("Not Found", { status: 404 });
        }
      },
    };
  }

  _getSessions() { return this.sessions; }
  _clear() { this.sessions.clear(); }
}

// ── Mock Hyperdrive ─────────────────────────────────────────

export class MockHyperdrive {
  connectionString = "mysql://test:test@localhost:3306/logingov_test";
  host = "localhost";
  port = 3306;
  user = "test";
  password = "test";
  database = "logingov_test";
}

// ── Test SP Configuration ────────────────────────────────────

export const TEST_SP = {
  id: "urn:gov:gsa:openidconnect.profiles:sp:sso:agency:test-app",
  name: "Test Agency App",
  ialMax: 2 as const,
  aalMax: 2 as const,
  redirectUris: ["https://agency.example.gov/auth/callback", "https://agency.example.gov/auth/callback2"],
  publicKey: "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA...\n-----END PUBLIC KEY-----",
  samlMetadataUrl: null,
  pushNotificationUrl: "https://agency.example.gov/api/risc/events",
  postLogoutRedirectUris: ["https://agency.example.gov/logout/callback"],
  theme: null,
  createdAt: "2024-01-01T00:00:00.000Z",
};

export const TEST_SP_IAL1_ONLY = {
  ...TEST_SP,
  id: "urn:gov:gsa:openidconnect.profiles:sp:sso:agency:ial1-only-app",
  name: "IAL1 Only Agency App",
  ialMax: 1 as const,
};

// ── Test User Factories ──────────────────────────────────────

export function createTestUser(overrides: Partial<{
  id: string;
  email: string;
  emailVerifiedAt: string | null;
  ial: 1 | 2;
  lockedAt: string | null;
  locale: string;
  ssn: string | null;
  birthdate: string | null;
  address: string | null;
  phone: string | null;
  verifiedAt: string | null;
  legacyUuid: string | null;
}> = {}) {
  return {
    id: "01234567-89ab-7def-0123-456789abcdef",
    email: "encrypted-email-blob",
    emailBlindIndex: "abc123def456",
    emailVerifiedAt: new Date().toISOString(),
    ial: 1 as const,
    lockedAt: null,
    locale: "en",
    ssn: null,
    birthdate: null,
    address: null,
    phone: null,
    verifiedAt: null,
    legacyUuid: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ── Mock Env Builder ────────────────────────────────────────

export function createMockEnv(overrides: Partial<Record<string, any>> = {}) {
  return {
    HYPERDRIVE: new MockHyperdrive(),
    KV_SESSIONS: new MockKV(),
    KV_SP_CONFIG: new MockKV(),
    KV_JWKS: new MockKV(),
    KV_FLAGS: new MockKV(),
    KV_OTP: new MockKV(),
    KV_RATE_LIMIT: new MockKV(),
    R2_AUDIT: new MockR2(),
    R2_PROOFING: new MockR2(),
    R2_KEYS: new MockR2(),
    QUEUE_EMAIL: new MockQueue(),
    QUEUE_SET: new MockQueue(),
    QUEUE_AUDIT: new MockQueue(),
    QUEUE_FRAUD: new MockQueue(),
    SESSION_DO: new MockSessionDO(),
    AUTH_CORE: {} as any,
    MFA_WORKER: {} as any,
    SAML_BRIDGE: {} as any,
    IDENTITY_PROOFING: {} as any,
    SECURITY_EVENTS: {} as any,
    ACCOUNT_WORKER: {} as any,
    ADMIN_WORKER: {} as any,
    INFRA_WORKER: {} as any,
    JWT_SIGNING_KEY: "test-jwt-signing-key-at-least-32-chars-long",
    ENCRYPTION_KEY: "dGVzdC1lbmNyeXB0aW9uLWtleS0zMi1ieXRlcw==", // base64 of 32-byte key
    PAIRWISE_SALT: "test-pairwise-salt-value",
    LEGACY_PAIRWISE_SALT: "test-legacy-pairwise-salt",
    PERSONA_API_KEY: "test-persona-key",
    TWILIO_AUTH_TOKEN: "test-twilio-token",
    TWILIO_ACCOUNT_SID: "test-twilio-sid",
    TWILIO_FROM_NUMBER: "+15005550006",
    ADMIN_API_KEY: "test-admin-key",
    INTERNAL_SERVICE_KEY: "test-internal-key",
    GOOGLE_CLIENT_ID: "test-google-client-id",
    GOOGLE_CLIENT_SECRET: "test-google-secret",
    MICROSOFT_CLIENT_ID: "test-microsoft-client-id",
    MICROSOFT_CLIENT_SECRET: "test-microsoft-secret",
    ALLOWED_ORIGINS: "https://secure.login.gov",
    ENVIRONMENT: "test",
    BASE_URL: "https://secure.login.gov",
    ...overrides,
  } as any;
}

// ── OIDC Helper: build authorize URL ────────────────────────

export function buildAuthorizeUrl(params: {
  clientId?: string;
  redirectUri?: string;
  responseType?: string;
  scope?: string;
  state?: string;
  nonce?: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
  acrValues?: string;
  locale?: string;
  requestUri?: string;
} = {}): string {
  const url = new URL("https://secure.login.gov/openid_connect/authorize");
  if (params.clientId !== undefined) url.searchParams.set("client_id", params.clientId);
  if (params.redirectUri !== undefined) url.searchParams.set("redirect_uri", params.redirectUri);
  if (params.responseType !== undefined) url.searchParams.set("response_type", params.responseType);
  if (params.scope !== undefined) url.searchParams.set("scope", params.scope);
  if (params.state !== undefined) url.searchParams.set("state", params.state);
  if (params.nonce !== undefined) url.searchParams.set("nonce", params.nonce);
  if (params.codeChallenge !== undefined) url.searchParams.set("code_challenge", params.codeChallenge);
  if (params.codeChallengeMethod !== undefined) url.searchParams.set("code_challenge_method", params.codeChallengeMethod);
  if (params.acrValues !== undefined) url.searchParams.set("acr_values", params.acrValues);
  if (params.locale !== undefined) url.searchParams.set("locale", params.locale);
  if (params.requestUri !== undefined) url.searchParams.set("request_uri", params.requestUri);
  return url.toString();
}

// ── PKCE Helper ─────────────────────────────────────────────

export async function generatePKCE(): Promise<{ codeVerifier: string; codeChallenge: string }> {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const codeVerifier = base64UrlEncode(bytes);

  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(codeVerifier));
  const codeChallenge = base64UrlEncode(new Uint8Array(digest));

  return { codeVerifier, codeChallenge };
}

function base64UrlEncode(buffer: Uint8Array): string {
  let binary = "";
  for (const byte of buffer) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ── Seed SP into mock KV ────────────────────────────────────

export async function seedSP(env: any, sp: typeof TEST_SP = TEST_SP): Promise<void> {
  const kv = env.KV_SP_CONFIG as MockKV;
  await kv.put(`sp:${sp.id}`, JSON.stringify(sp));
}

// ── Valid authorize params (convenience) ─────────────────────

export async function validAuthorizeParams() {
  const { codeVerifier, codeChallenge } = await generatePKCE();
  return {
    params: {
      clientId: TEST_SP.id,
      redirectUri: TEST_SP.redirectUris[0],
      responseType: "code",
      scope: "openid email",
      state: "test-state-123",
      nonce: "test-nonce-456",
      codeChallenge,
      codeChallengeMethod: "S256",
      acrValues: "urn:acr.login.gov:auth-only",
    },
    codeVerifier,
    codeChallenge,
  };
}
