-- Login.gov Target Schema — MySQL 8 (PlanetScale-compatible)
-- Matches drizzle/migrations/0001_init.sql and packages/shared/src/schema/index.ts

CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(36) PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  email_blind_index VARCHAR(64),
  email_verified_at VARCHAR(30),
  ial INT NOT NULL DEFAULT 1,
  locked_at VARCHAR(30),
  locale VARCHAR(10) NOT NULL DEFAULT 'en',
  ssn TEXT,
  birthdate TEXT,
  address TEXT,
  phone TEXT,
  verified_at VARCHAR(30),
  created_at VARCHAR(30) NOT NULL,
  updated_at VARCHAR(30) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

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
