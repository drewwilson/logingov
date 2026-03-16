-- Login.gov Modern Stack — Initial PlanetScale (MySQL 8) Schema

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
);

CREATE INDEX users_legacy_uuid_idx ON users (legacy_uuid);

CREATE TABLE IF NOT EXISTS user_emails (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  address VARCHAR(255) NOT NULL,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  verified_at VARCHAR(30),
  created_at VARCHAR(30) NOT NULL
);

CREATE INDEX user_emails_user_id_idx ON user_emails(user_id);
CREATE INDEX user_emails_address_idx ON user_emails(address);

CREATE TABLE IF NOT EXISTS credentials (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  type VARCHAR(20) NOT NULL,
  data TEXT NOT NULL,
  last_used_at VARCHAR(30),
  created_at VARCHAR(30) NOT NULL
);

CREATE INDEX credentials_user_id_idx ON credentials(user_id);

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
  created_at VARCHAR(30) NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_codes (
  code VARCHAR(255) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  sp_id VARCHAR(255) NOT NULL,
  redirect_uri TEXT NOT NULL,
  scopes TEXT NOT NULL,
  code_challenge VARCHAR(128),
  code_challenge_method VARCHAR(10),
  nonce VARCHAR(255),
  expires_at VARCHAR(30) NOT NULL,
  used_at VARCHAR(30),
  created_at VARCHAR(30) NOT NULL
);

CREATE INDEX auth_codes_user_id_idx ON auth_codes(user_id);

CREATE TABLE IF NOT EXISTS identity_events (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  sp_id VARCHAR(255),
  event_type VARCHAR(100) NOT NULL,
  ial INT,
  aal INT,
  ip VARCHAR(45) NOT NULL,
  metadata TEXT NOT NULL,
  created_at VARCHAR(30) NOT NULL
);

CREATE INDEX identity_events_user_id_idx ON identity_events(user_id);
CREATE INDEX identity_events_created_at_idx ON identity_events(created_at);

-- ── Better Auth tables ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS `user` (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  emailVerified BOOLEAN NOT NULL DEFAULT FALSE,
  image TEXT,
  createdAt TIMESTAMP NOT NULL,
  updatedAt TIMESTAMP NOT NULL,
  twoFactorEnabled BOOLEAN DEFAULT FALSE
);

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
);

CREATE TABLE IF NOT EXISTS `account` (
  id VARCHAR(36) PRIMARY KEY,
  userId VARCHAR(36) NOT NULL,
  accountId VARCHAR(255) NOT NULL,
  providerId VARCHAR(255) NOT NULL,
  accessToken TEXT,
  refreshToken TEXT,
  accessTokenExpiresAt TIMESTAMP NULL,
  refreshTokenExpiresAt TIMESTAMP NULL,
  scope TEXT,
  password TEXT,
  createdAt TIMESTAMP NOT NULL,
  updatedAt TIMESTAMP NOT NULL,
  FOREIGN KEY (userId) REFERENCES `user`(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS verification (
  id VARCHAR(36) PRIMARY KEY,
  identifier VARCHAR(255) NOT NULL,
  value TEXT NOT NULL,
  expiresAt TIMESTAMP NOT NULL,
  createdAt TIMESTAMP NOT NULL,
  updatedAt TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS twoFactor (
  id VARCHAR(36) PRIMARY KEY,
  secret TEXT NOT NULL,
  backupCodes TEXT NOT NULL,
  userId VARCHAR(36) NOT NULL,
  FOREIGN KEY (userId) REFERENCES `user`(id) ON DELETE CASCADE
);
