/**
 * Cloudflare Workers environment bindings.
 * Every Worker imports this type for its Env parameter.
 */
export interface Env {
  // Hyperdrive (PlanetScale)
  HYPERDRIVE: Hyperdrive;
  DATABASE_URL?: string; // local dev fallback

  // KV Namespaces
  KV_SESSIONS: KVNamespace;
  KV_SP_CONFIG: KVNamespace;
  KV_JWKS: KVNamespace;
  KV_FLAGS: KVNamespace;
  KV_OTP: KVNamespace;
  KV_RATE_LIMIT: KVNamespace;

  // R2 Buckets
  R2_AUDIT: R2Bucket;
  R2_PROOFING: R2Bucket;
  R2_KEYS: R2Bucket;

  // Queues
  QUEUE_EMAIL: Queue;
  QUEUE_SET: Queue;
  QUEUE_AUDIT: Queue;
  QUEUE_FRAUD: Queue;

  // Durable Objects
  SESSION_DO: DurableObjectNamespace;

  // Service Bindings (Worker-to-Worker)
  AUTH_CORE: Fetcher;
  MFA_WORKER: Fetcher;
  SAML_BRIDGE: Fetcher;
  IDENTITY_PROOFING: Fetcher;
  SECURITY_EVENTS: Fetcher;
  ACCOUNT_WORKER: Fetcher;
  ADMIN_WORKER: Fetcher;
  INFRA_WORKER: Fetcher;

  // Secrets
  JWT_SIGNING_KEY: string;
  ENCRYPTION_KEY: string;
  PAIRWISE_SALT: string;
  LEGACY_PAIRWISE_SALT?: string; // Old Rails pairwise salt for migrated user sub computation
  PERSONA_API_KEY: string;
  TWILIO_AUTH_TOKEN: string;
  TWILIO_ACCOUNT_SID: string;
  TWILIO_FROM_NUMBER: string;
  ADMIN_API_KEY: string;
  INTERNAL_SERVICE_KEY: string;

  // Social Login OAuth Secrets
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  MICROSOFT_CLIENT_ID: string;
  MICROSOFT_CLIENT_SECRET: string;

  // Configuration
  ALLOWED_ORIGINS?: string;
  ENVIRONMENT?: string;
  BASE_URL?: string;

}
