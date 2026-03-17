-- Login.gov Target Schema — MySQL 8 (PlanetScale-compatible)
-- Matches the full migration chain: 0001_init through 0007_widen_logo_columns
-- plus packages/shared/src/schema/index.ts and packages/auth-core/src/schema.ts

-- ── Login.gov application tables ─────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(36) PRIMARY KEY,
  email TEXT NOT NULL,
  email_blind_index VARCHAR(64) NOT NULL UNIQUE,
  email_verified_at VARCHAR(30),
  ial INT NOT NULL DEFAULT 1,
  locked_at VARCHAR(30),
  locale VARCHAR(10) NOT NULL DEFAULT 'en',
  legacy_uuid VARCHAR(36) NULL,
  ssn TEXT,
  birthdate TEXT,
  address TEXT,
  phone TEXT,
  verified_at VARCHAR(30),
  created_at VARCHAR(30) NOT NULL,
  updated_at VARCHAR(30) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE INDEX users_legacy_uuid_idx ON users (legacy_uuid);

CREATE TABLE IF NOT EXISTS user_emails (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  address VARCHAR(255) NOT NULL,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  verified_at VARCHAR(30),
  created_at VARCHAR(30) NOT NULL,
  INDEX user_emails_user_id_idx (user_id),
  INDEX user_emails_address_idx (address)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS credentials (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  type VARCHAR(20) NOT NULL,
  data TEXT NOT NULL,
  last_used_at VARCHAR(30),
  created_at VARCHAR(30) NOT NULL,
  INDEX credentials_user_id_idx (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS agencies (
  id VARCHAR(36) PRIMARY KEY,
  iaa_name VARCHAR(255) NOT NULL,
  friendly_name VARCHAR(255) NOT NULL,
  abbreviation VARCHAR(50),
  description TEXT,
  website_url VARCHAR(500),
  protocol VARCHAR(10) NOT NULL DEFAULT 'oidc',
  ial INT NOT NULL DEFAULT 1,
  default_aal INT NOT NULL DEFAULT 1,
  logo MEDIUMTEXT,
  public_certificate TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'draft',
  theme_config TEXT,
  created_at VARCHAR(30) NOT NULL,
  updated_at VARCHAR(30) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE INDEX agencies_status_idx ON agencies(status);

CREATE TABLE IF NOT EXISTS service_providers (
  id VARCHAR(255) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  ial_max INT NOT NULL DEFAULT 1,
  aal_max INT NOT NULL DEFAULT 1,
  redirect_uris TEXT NOT NULL,
  public_key TEXT NOT NULL,
  saml_metadata_url TEXT,
  push_notification_url TEXT,
  post_logout_redirect_uris TEXT,
  theme MEDIUMTEXT,
  agency_id VARCHAR(36),
  created_at VARCHAR(30) NOT NULL,
  INDEX service_providers_agency_id_idx (agency_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS auth_codes (
  code VARCHAR(255) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  sp_id VARCHAR(255) NOT NULL,
  redirect_uri TEXT NOT NULL,
  scopes TEXT NOT NULL,
  code_challenge VARCHAR(128),
  code_challenge_method VARCHAR(10),
  nonce VARCHAR(255),
  ial INT NOT NULL DEFAULT 1,
  aal INT NOT NULL DEFAULT 1,
  acr VARCHAR(100) NOT NULL DEFAULT 'urn:acr.login.gov:auth-only',
  expires_at VARCHAR(30) NOT NULL,
  used_at VARCHAR(30),
  created_at VARCHAR(30) NOT NULL,
  INDEX auth_codes_user_id_idx (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS identity_events (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  sp_id VARCHAR(255),
  event_type VARCHAR(100) NOT NULL,
  ial INT,
  aal INT,
  ip VARCHAR(45) NOT NULL,
  metadata TEXT NOT NULL,
  created_at VARCHAR(30) NOT NULL,
  INDEX identity_events_user_id_idx (user_id),
  INDEX identity_events_created_at_idx (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Better Auth tables ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS `user` (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  emailVerified BOOLEAN NOT NULL DEFAULT FALSE,
  image TEXT,
  createdAt TIMESTAMP NOT NULL,
  updatedAt TIMESTAMP NOT NULL,
  twoFactorEnabled BOOLEAN DEFAULT FALSE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `session` (
  id VARCHAR(36) PRIMARY KEY,
  userId VARCHAR(36) NOT NULL,
  token VARCHAR(255) NOT NULL UNIQUE,
  expiresAt TIMESTAMP NOT NULL,
  ipAddress VARCHAR(45),
  userAgent TEXT,
  createdAt TIMESTAMP NOT NULL,
  updatedAt TIMESTAMP NOT NULL,
  FOREIGN KEY (userId) REFERENCES `user`(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `account` (
  id VARCHAR(36) PRIMARY KEY,
  userId VARCHAR(36) NOT NULL,
  accountId VARCHAR(255) NOT NULL,
  providerId VARCHAR(255) NOT NULL,
  accessToken TEXT,
  refreshToken TEXT,
  idToken TEXT,
  accessTokenExpiresAt TIMESTAMP NULL,
  refreshTokenExpiresAt TIMESTAMP NULL,
  scope TEXT,
  password TEXT,
  createdAt TIMESTAMP NOT NULL,
  updatedAt TIMESTAMP NOT NULL,
  FOREIGN KEY (userId) REFERENCES `user`(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS verification (
  id VARCHAR(36) PRIMARY KEY,
  identifier VARCHAR(255) NOT NULL,
  value TEXT NOT NULL,
  expiresAt TIMESTAMP NOT NULL,
  createdAt TIMESTAMP NOT NULL,
  updatedAt TIMESTAMP NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS twoFactor (
  id VARCHAR(36) PRIMARY KEY,
  secret TEXT NOT NULL,
  backupCodes TEXT NOT NULL,
  userId VARCHAR(36) NOT NULL,
  FOREIGN KEY (userId) REFERENCES `user`(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
