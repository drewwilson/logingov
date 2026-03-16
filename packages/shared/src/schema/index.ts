/**
 * Drizzle ORM schema definitions for PlanetScale (MySQL 8).
 */
import { mysqlTable, varchar, text, int, boolean, index } from "drizzle-orm/mysql-core";

// ── users ───────────────────────────────────────────────────

export const users = mysqlTable("users", {
  id: varchar("id", { length: 36 }).primaryKey(), // UUID v7
  email: text("email").notNull(), // AES-256-GCM encrypted blob
  emailBlindIndex: varchar("email_blind_index", { length: 64 }).notNull().unique(), // HMAC-SHA256 of normalized email for lookups
  emailVerifiedAt: varchar("email_verified_at", { length: 30 }), // ISO 8601
  ial: int("ial").notNull().default(1), // 1 or 2
  lockedAt: varchar("locked_at", { length: 30 }),
  locale: varchar("locale", { length: 10 }).notNull().default("en"),
  // PII fields — AES-256-GCM encrypted blobs
  ssn: text("ssn"),
  birthdate: text("birthdate"),
  address: text("address"), // encrypted JSON
  phone: text("phone"),
  verifiedAt: varchar("verified_at", { length: 30 }),
  legacyUuid: varchar("legacy_uuid", { length: 36 }), // Old Rails UUID for pairwise sub backward compat
  createdAt: varchar("created_at", { length: 30 }).notNull(),
  updatedAt: varchar("updated_at", { length: 30 }).notNull(),
});

// ── user_emails (multiple emails per user) ──────────────────

export const userEmails = mysqlTable(
  "user_emails",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    userId: varchar("user_id", { length: 36 }).notNull(),
    address: varchar("address", { length: 255 }).notNull(),
    isPrimary: boolean("is_primary").notNull().default(false),
    verifiedAt: varchar("verified_at", { length: 30 }),
    createdAt: varchar("created_at", { length: 30 }).notNull(),
  },
  (table) => [
    index("user_emails_user_id_idx").on(table.userId),
    index("user_emails_address_idx").on(table.address),
  ]
);

// ── credentials (password, webauthn, totp, backup) ──────────

export const credentials = mysqlTable(
  "credentials",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    userId: varchar("user_id", { length: 36 }).notNull(),
    type: varchar("type", { length: 20 }).notNull(), // password | webauthn | totp | backup
    data: text("data").notNull(), // encrypted JSON blob
    lastUsedAt: varchar("last_used_at", { length: 30 }),
    createdAt: varchar("created_at", { length: 30 }).notNull(),
  },
  (table) => [index("credentials_user_id_idx").on(table.userId)]
);

// ── service_providers ───────────────────────────────────────

export const serviceProviders = mysqlTable("service_providers", {
  id: varchar("id", { length: 255 }).primaryKey(), // issuer URI
  name: varchar("name", { length: 255 }).notNull(),
  ialMax: int("ial_max").notNull().default(1),
  aalMax: int("aal_max").notNull().default(1),
  redirectUris: text("redirect_uris").notNull(), // JSON array
  publicKey: text("public_key").notNull(), // PEM
  samlMetadataUrl: text("saml_metadata_url"),
  pushNotificationUrl: text("push_notification_url"),
  postLogoutRedirectUris: text("post_logout_redirect_uris"), // JSON array, nullable
  theme: text("theme"), // JSON blob — hosted sign-in page theming
  createdAt: varchar("created_at", { length: 30 }).notNull(),
});

// ── auth_codes (single-use, short-lived) ────────────────────

export const authCodes = mysqlTable(
  "auth_codes",
  {
    code: varchar("code", { length: 255 }).primaryKey(),
    userId: varchar("user_id", { length: 36 }).notNull(),
    spId: varchar("sp_id", { length: 255 }).notNull(),
    redirectUri: text("redirect_uri").notNull(),
    scopes: text("scopes").notNull(), // JSON array
    codeChallenge: varchar("code_challenge", { length: 128 }),
    codeChallengeMethod: varchar("code_challenge_method", { length: 10 }),
    nonce: varchar("nonce", { length: 255 }),
    ial: int("ial").notNull().default(1),
    aal: int("aal").notNull().default(1),
    acr: varchar("acr", { length: 100 }).notNull().default("urn:acr.login.gov:auth-only"),
    expiresAt: varchar("expires_at", { length: 30 }).notNull(),
    usedAt: varchar("used_at", { length: 30 }), // null = unused
    createdAt: varchar("created_at", { length: 30 }).notNull(),
  },
  (table) => [index("auth_codes_user_id_idx").on(table.userId)]
);

// ── twoFactor (Better Auth two-factor secrets) ──────────────
// Mirrors the Better Auth twoFactor plugin table so the MFA worker
// can look up TOTP secrets created via Better Auth's UI flow.

export const twoFactor = mysqlTable("twoFactor", {
  id: varchar("id", { length: 36 }).primaryKey(),
  secret: text("secret").notNull(), // base32-encoded TOTP secret
  backupCodes: text("backupCodes").notNull(),
  userId: varchar("userId", { length: 36 }).notNull(),
});

// ── identity_events (append-only audit log) ─────────────────

export const identityEvents = mysqlTable(
  "identity_events",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    userId: varchar("user_id", { length: 36 }).notNull(),
    spId: varchar("sp_id", { length: 255 }),
    eventType: varchar("event_type", { length: 100 }).notNull(),
    ial: int("ial"),
    aal: int("aal"),
    ip: varchar("ip", { length: 45 }).notNull(),
    metadata: text("metadata").$type<Record<string, unknown>>().notNull(),
    createdAt: varchar("created_at", { length: 30 }).notNull(),
  },
  (table) => [
    index("identity_events_user_id_idx").on(table.userId),
    index("identity_events_created_at_idx").on(table.createdAt),
  ]
);
