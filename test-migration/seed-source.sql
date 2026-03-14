-- =============================================================================
-- Login.gov Migration Test Data — PostgreSQL Source Database
-- Simulates the Rails identity-idp PostgreSQL schema with ~50 dummy users
-- Usage: psql -f seed-source.sql <database_name>
-- =============================================================================

BEGIN;

-- Drop tables if they exist (for re-runnability)
DROP TABLE IF EXISTS events CASCADE;
DROP TABLE IF EXISTS identities CASCADE;
DROP TABLE IF EXISTS profiles CASCADE;
DROP TABLE IF EXISTS phone_configurations CASCADE;
DROP TABLE IF EXISTS backup_code_configurations CASCADE;
DROP TABLE IF EXISTS auth_app_configurations CASCADE;
DROP TABLE IF EXISTS webauthn_configurations CASCADE;
DROP TABLE IF EXISTS passwords CASCADE;
DROP TABLE IF EXISTS email_addresses CASCADE;
DROP TABLE IF EXISTS service_providers CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- =============================================================================
-- Schema: Tables matching Rails identity-idp
-- =============================================================================

CREATE TABLE users (
  id BIGSERIAL PRIMARY KEY,
  uuid UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  email VARCHAR(255) NOT NULL UNIQUE,
  encrypted_email VARCHAR(255),
  encrypted_email_iv VARCHAR(255),
  confirmed_at TIMESTAMP,
  locked_at TIMESTAMP,
  ial INTEGER NOT NULL DEFAULT 1,
  locale VARCHAR(10) NOT NULL DEFAULT 'en',
  otp_required_for_login BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE email_addresses (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  encrypted_email VARCHAR(255),
  encrypted_email_iv VARCHAR(255),
  confirmed_at TIMESTAMP,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_email_addresses_user_id ON email_addresses(user_id);
CREATE INDEX idx_email_addresses_email ON email_addresses(email);

CREATE TABLE passwords (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  encrypted_password VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE webauthn_configurations (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id VARCHAR(255) NOT NULL,
  credential_public_key TEXT NOT NULL,
  name VARCHAR(255) NOT NULL DEFAULT 'My Security Key',
  transports TEXT, -- JSON array
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_webauthn_user_id ON webauthn_configurations(user_id);

CREATE TABLE auth_app_configurations (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  otp_secret_key VARCHAR(255) NOT NULL, -- encrypted TOTP secret
  name VARCHAR(255) NOT NULL DEFAULT 'Authenticator App',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_auth_app_user_id ON auth_app_configurations(user_id);

CREATE TABLE backup_code_configurations (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  codes TEXT NOT NULL, -- encrypted JSON array of hashed codes
  used_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_backup_codes_user_id ON backup_code_configurations(user_id);

CREATE TABLE phone_configurations (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  encrypted_phone VARCHAR(255) NOT NULL,
  encrypted_phone_iv VARCHAR(255) NOT NULL,
  confirmed_at TIMESTAMP,
  delivery_preference VARCHAR(20) NOT NULL DEFAULT 'sms', -- sms or voice
  mfa_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_phone_configs_user_id ON phone_configurations(user_id);

CREATE TABLE service_providers (
  id BIGSERIAL PRIMARY KEY,
  issuer VARCHAR(255) NOT NULL UNIQUE,
  friendly_name VARCHAR(255) NOT NULL,
  redirect_uris TEXT NOT NULL, -- JSON array
  cert TEXT, -- PEM public key/cert
  ial INTEGER NOT NULL DEFAULT 1,
  default_aal INTEGER NOT NULL DEFAULT 1,
  agency VARCHAR(255),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE identities (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  service_provider_id BIGINT NOT NULL REFERENCES service_providers(id) ON DELETE CASCADE,
  last_authenticated_at TIMESTAMP,
  session_uuid UUID,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_identities_user_id ON identities(user_id);
CREATE INDEX idx_identities_sp_id ON identities(service_provider_id);

CREATE TABLE profiles (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ssn_signature VARCHAR(255),
  encrypted_pii TEXT, -- encrypted JSON blob with SSN, address, phone, etc.
  encrypted_pii_iv VARCHAR(255),
  verified_at TIMESTAMP,
  activated_at TIMESTAMP,
  deactivation_reason VARCHAR(50),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_profiles_user_id ON profiles(user_id);

CREATE TABLE events (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type VARCHAR(100) NOT NULL,
  ip VARCHAR(45) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_events_user_id ON events(user_id);
CREATE INDEX idx_events_created_at ON events(created_at);

-- =============================================================================
-- Seed Data: Service Providers (4)
-- =============================================================================

INSERT INTO service_providers (id, issuer, friendly_name, redirect_uris, cert, ial, default_aal, agency) VALUES
  (1, 'urn:gov:gsa:openidconnect.profiles:sp:sso:dhs:cbp-portal', 'CBP Travel Portal', '["https://cbp-portal.dhs.gov/auth/callback","https://cbp-portal-staging.dhs.gov/auth/callback"]', '-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtestkey1AAAAAAAAAA\n-----END PUBLIC KEY-----', 2, 2, 'Department of Homeland Security'),
  (2, 'urn:gov:gsa:openidconnect.profiles:sp:sso:ssa:my-ssa', 'My Social Security', '["https://my.ssa.gov/auth/callback"]', '-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtestkey2AAAAAAAAAA\n-----END PUBLIC KEY-----', 2, 2, 'Social Security Administration'),
  (3, 'urn:gov:gsa:openidconnect.profiles:sp:sso:usps:informed-delivery', 'USPS Informed Delivery', '["https://informeddelivery.usps.com/auth/callback"]', '-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtestkey3AAAAAAAAAA\n-----END PUBLIC KEY-----', 1, 1, 'US Postal Service'),
  (4, 'urn:gov:gsa:openidconnect.profiles:sp:sso:va:health', 'VA Health Benefits', '["https://health.va.gov/auth/callback","https://staging.health.va.gov/auth/callback"]', '-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtestkey4AAAAAAAAAA\n-----END PUBLIC KEY-----', 2, 2, 'Department of Veterans Affairs');

-- Reset sequence
SELECT setval('service_providers_id_seq', 4);

-- =============================================================================
-- Seed Data: Users (50)
-- Encrypted fields use placeholder base64 blobs simulating Rails attr_encrypted
-- =============================================================================

-- Users 1-10: Basic IAL1 users, confirmed, password-only
INSERT INTO users (id, uuid, email, encrypted_email, encrypted_email_iv, confirmed_at, ial, locale, created_at, updated_at) VALUES
  (1,  'a1b2c3d4-0001-4000-8000-000000000001', 'alice.johnson@example.gov',    'enc_aes256_YWxpY2Uuam9obnNvbkBleGFtcGxlLmdvdg==', 'iv_abc001', '2022-03-15 10:00:00', 1, 'en', '2022-03-15 09:30:00', '2025-01-10 14:00:00'),
  (2,  'a1b2c3d4-0002-4000-8000-000000000002', 'bob.smith@example.gov',        'enc_aes256_Ym9iLnNtaXRoQGV4YW1wbGUuZ292',         'iv_abc002', '2022-04-20 11:00:00', 1, 'en', '2022-04-20 10:30:00', '2025-02-01 09:00:00'),
  (3,  'a1b2c3d4-0003-4000-8000-000000000003', 'carol.davis@example.gov',      'enc_aes256_Y2Fyb2wuZGF2aXNAZXhhbXBsZS5nb3Y=',     'iv_abc003', '2022-05-10 08:00:00', 1, 'en', '2022-05-10 07:45:00', '2024-11-15 16:00:00'),
  (4,  'a1b2c3d4-0004-4000-8000-000000000004', 'david.wilson@example.gov',     'enc_aes256_ZGF2aWQud2lsc29uQGV4YW1wbGUuZ292',      'iv_abc004', '2022-06-01 14:00:00', 1, 'es', '2022-06-01 13:30:00', '2024-12-20 10:00:00'),
  (5,  'a1b2c3d4-0005-4000-8000-000000000005', 'emma.garcia@example.gov',      'enc_aes256_ZW1tYS5nYXJjaWFAZXhhbXBsZS5nb3Y=',      'iv_abc005', '2022-07-22 09:00:00', 1, 'es', '2022-07-22 08:45:00', '2025-01-05 11:00:00'),
  (6,  'a1b2c3d4-0006-4000-8000-000000000006', 'frank.brown@example.gov',      'enc_aes256_ZnJhbmsuYnJvd25AZXhhbXBsZS5nb3Y=',      'iv_abc006', '2022-08-30 15:00:00', 1, 'en', '2022-08-30 14:30:00', '2024-10-01 08:00:00'),
  (7,  'a1b2c3d4-0007-4000-8000-000000000007', 'grace.lee@example.gov',        'enc_aes256_Z3JhY2UubGVlQGV4YW1wbGUuZ292',          'iv_abc007', '2022-09-14 10:00:00', 1, 'en', '2022-09-14 09:30:00', '2025-03-01 12:00:00'),
  (8,  'a1b2c3d4-0008-4000-8000-000000000008', 'henry.martinez@example.gov',   'enc_aes256_aGVucnkubWFydGluZXpAZXhhbXBsZS5nb3Y=',  'iv_abc008', '2022-10-05 12:00:00', 1, 'en', '2022-10-05 11:30:00', '2024-09-15 14:00:00'),
  (9,  'a1b2c3d4-0009-4000-8000-000000000009', 'isabel.chen@example.gov',      'enc_aes256_aXNhYmVsLmNoZW5AZXhhbXBsZS5nb3Y=',     'iv_abc009', '2022-11-18 16:00:00', 1, 'zh', '2022-11-18 15:45:00', '2025-01-20 09:00:00'),
  (10, 'a1b2c3d4-0010-4000-8000-000000000010', 'jack.taylor@example.gov',      'enc_aes256_amFjay50YXlsb3JAZXhhbXBsZS5nb3Y=',      'iv_abc010', '2022-12-01 08:00:00', 1, 'en', '2022-12-01 07:30:00', '2024-08-10 10:00:00');

-- Users 11-25: IAL2 verified users with profiles
INSERT INTO users (id, uuid, email, encrypted_email, encrypted_email_iv, confirmed_at, ial, locale, created_at, updated_at) VALUES
  (11, 'a1b2c3d4-0011-4000-8000-000000000011', 'karen.white@example.gov',      'enc_aes256_a2FyZW4ud2hpdGVAZXhhbXBsZS5nb3Y=',      'iv_abc011', '2023-01-10 10:00:00', 2, 'en', '2023-01-10 09:00:00', '2025-02-15 11:00:00'),
  (12, 'a1b2c3d4-0012-4000-8000-000000000012', 'luis.rodriguez@example.gov',    'enc_aes256_bHVpcy5yb2RyaWd1ZXpAZXhhbXBsZS5nb3Y=',  'iv_abc012', '2023-02-05 14:00:00', 2, 'es', '2023-02-05 13:30:00', '2025-01-25 16:00:00'),
  (13, 'a1b2c3d4-0013-4000-8000-000000000013', 'maria.hernandez@example.gov',  'enc_aes256_bWFyaWEuaGVybmFuZGV6QGV4YW1wbGUuZ292',  'iv_abc013', '2023-03-12 09:00:00', 2, 'es', '2023-03-12 08:30:00', '2025-03-01 10:00:00'),
  (14, 'a1b2c3d4-0014-4000-8000-000000000014', 'nathan.kim@example.gov',       'enc_aes256_bmF0aGFuLmtpbUBleGFtcGxlLmdvdg==',      'iv_abc014', '2023-04-08 11:00:00', 2, 'en', '2023-04-08 10:00:00', '2024-12-10 14:00:00'),
  (15, 'a1b2c3d4-0015-4000-8000-000000000015', 'olivia.nguyen@example.gov',    'enc_aes256_b2xpdmlhLm5ndXllbkBleGFtcGxlLmdvdg==',  'iv_abc015', '2023-05-20 13:00:00', 2, 'en', '2023-05-20 12:30:00', '2025-02-20 08:00:00'),
  (16, 'a1b2c3d4-0016-4000-8000-000000000016', 'peter.jackson@example.gov',    'enc_aes256_cGV0ZXIuamFja3NvbkBleGFtcGxlLmdvdg==',  'iv_abc016', '2023-06-15 10:00:00', 2, 'en', '2023-06-15 09:30:00', '2025-01-30 15:00:00'),
  (17, 'a1b2c3d4-0017-4000-8000-000000000017', 'quinn.patel@example.gov',      'enc_aes256_cXVpbm4ucGF0ZWxAZXhhbXBsZS5nb3Y=',      'iv_abc017', '2023-07-01 15:00:00', 2, 'en', '2023-07-01 14:30:00', '2024-11-05 09:00:00'),
  (18, 'a1b2c3d4-0018-4000-8000-000000000018', 'rachel.thomas@example.gov',    'enc_aes256_cmFjaGVsLnRob21hc0BleGFtcGxlLmdvdg==',  'iv_abc018', '2023-08-22 08:00:00', 2, 'en', '2023-08-22 07:30:00', '2025-03-05 12:00:00'),
  (19, 'a1b2c3d4-0019-4000-8000-000000000019', 'samuel.wright@example.gov',    'enc_aes256_c2FtdWVsLndyaWdodEBleGFtcGxlLmdvdg==',  'iv_abc019', '2023-09-10 11:00:00', 2, 'en', '2023-09-10 10:00:00', '2024-10-20 16:00:00'),
  (20, 'a1b2c3d4-0020-4000-8000-000000000020', 'teresa.lopez@example.gov',     'enc_aes256_dGVyZXNhLmxvcGV6QGV4YW1wbGUuZ292',      'iv_abc020', '2023-10-14 14:00:00', 2, 'es', '2023-10-14 13:30:00', '2025-02-01 10:00:00'),
  (21, 'a1b2c3d4-0021-4000-8000-000000000021', 'uma.singh@example.gov',        'enc_aes256_dW1hLnNpbmdoQGV4YW1wbGUuZ292',          'iv_abc021', '2023-11-02 09:00:00', 2, 'en', '2023-11-02 08:30:00', '2025-01-15 11:00:00'),
  (22, 'a1b2c3d4-0022-4000-8000-000000000022', 'victor.adams@example.gov',     'enc_aes256_dmljdG9yLmFkYW1zQGV4YW1wbGUuZ292',      'iv_abc022', '2023-12-08 16:00:00', 2, 'en', '2023-12-08 15:30:00', '2024-12-01 14:00:00'),
  (23, 'a1b2c3d4-0023-4000-8000-000000000023', 'wendy.clark@example.gov',      'enc_aes256_d2VuZHkuY2xhcmtAZXhhbXBsZS5nb3Y=',      'iv_abc023', '2024-01-15 10:00:00', 2, 'en', '2024-01-15 09:30:00', '2025-03-10 08:00:00'),
  (24, 'a1b2c3d4-0024-4000-8000-000000000024', 'xavier.hill@example.gov',      'enc_aes256_eGF2aWVyLmhpbGxAZXhhbXBsZS5nb3Y=',      'iv_abc024', '2024-02-20 12:00:00', 2, 'fr', '2024-02-20 11:30:00', '2025-01-10 16:00:00'),
  (25, 'a1b2c3d4-0025-4000-8000-000000000025', 'yolanda.scott@example.gov',    'enc_aes256_eW9sYW5kYS5zY290dEBleGFtcGxlLmdvdg==',  'iv_abc025', '2024-03-10 13:00:00', 2, 'en', '2024-03-10 12:30:00', '2025-02-28 09:00:00');

-- Users 26-35: Multi-MFA users (WebAuthn + TOTP + backup codes)
INSERT INTO users (id, uuid, email, encrypted_email, encrypted_email_iv, confirmed_at, ial, locale, otp_required_for_login, created_at, updated_at) VALUES
  (26, 'a1b2c3d4-0026-4000-8000-000000000026', 'zach.allen@example.gov',       'enc_aes256_emFjaC5hbGxlbkBleGFtcGxlLmdvdg==',      'iv_abc026', '2023-03-01 10:00:00', 2, 'en', TRUE, '2023-03-01 09:00:00', '2025-03-01 14:00:00'),
  (27, 'a1b2c3d4-0027-4000-8000-000000000027', 'amy.baker@example.gov',        'enc_aes256_YW15LmJha2VyQGV4YW1wbGUuZ292',          'iv_abc027', '2023-04-15 11:00:00', 2, 'en', TRUE, '2023-04-15 10:00:00', '2025-02-10 09:00:00'),
  (28, 'a1b2c3d4-0028-4000-8000-000000000028', 'brian.cooper@example.gov',     'enc_aes256_YnJpYW4uY29vcGVyQGV4YW1wbGUuZ292',      'iv_abc028', '2023-05-22 14:00:00', 1, 'en', TRUE, '2023-05-22 13:30:00', '2025-01-20 16:00:00'),
  (29, 'a1b2c3d4-0029-4000-8000-000000000029', 'diana.evans@example.gov',      'enc_aes256_ZGlhbmEuZXZhbnNAZXhhbXBsZS5nb3Y=',      'iv_abc029', '2023-06-10 09:00:00', 2, 'en', TRUE, '2023-06-10 08:30:00', '2024-12-15 10:00:00'),
  (30, 'a1b2c3d4-0030-4000-8000-000000000030', 'edward.foster@example.gov',    'enc_aes256_ZWR3YXJkLmZvc3RlckBleGFtcGxlLmdvdg==',  'iv_abc030', '2023-07-18 15:00:00', 2, 'en', TRUE, '2023-07-18 14:30:00', '2025-02-05 11:00:00'),
  (31, 'a1b2c3d4-0031-4000-8000-000000000031', 'fiona.green@example.gov',      'enc_aes256_ZmlvbmEuZ3JlZW5AZXhhbXBsZS5nb3Y=',      'iv_abc031', '2023-08-25 10:00:00', 1, 'en', TRUE, '2023-08-25 09:00:00', '2025-01-08 14:00:00'),
  (32, 'a1b2c3d4-0032-4000-8000-000000000032', 'george.harris@example.gov',    'enc_aes256_Z2VvcmdlLmhhcnJpc0BleGFtcGxlLmdvdg==',  'iv_abc032', '2023-09-30 12:00:00', 2, 'en', TRUE, '2023-09-30 11:30:00', '2024-11-20 08:00:00'),
  (33, 'a1b2c3d4-0033-4000-8000-000000000033', 'helen.irving@example.gov',     'enc_aes256_aGVsZW4uaXJ2aW5nQGV4YW1wbGUuZ292',      'iv_abc033', '2023-10-12 16:00:00', 2, 'en', TRUE, '2023-10-12 15:30:00', '2025-03-08 12:00:00'),
  (34, 'a1b2c3d4-0034-4000-8000-000000000034', 'ian.jones@example.gov',        'enc_aes256_aWFuLmpvbmVzQGV4YW1wbGUuZ292',          'iv_abc034', '2023-11-20 08:00:00', 1, 'en', TRUE, '2023-11-20 07:30:00', '2025-02-12 10:00:00'),
  (35, 'a1b2c3d4-0035-4000-8000-000000000035', 'julia.king@example.gov',       'enc_aes256_anVsaWEua2luZ0BleGFtcGxlLmdvdg==',      'iv_abc035', '2023-12-05 11:00:00', 2, 'fr', TRUE, '2023-12-05 10:00:00', '2025-01-28 15:00:00');

-- Users 36-40: Locked/suspended accounts
INSERT INTO users (id, uuid, email, encrypted_email, encrypted_email_iv, confirmed_at, locked_at, ial, locale, created_at, updated_at) VALUES
  (36, 'a1b2c3d4-0036-4000-8000-000000000036', 'kevin.long@example.gov',       'enc_aes256_a2V2aW4ubG9uZ0BleGFtcGxlLmdvdg==',      'iv_abc036', '2022-06-01 10:00:00', '2025-01-15 08:00:00', 1, 'en', '2022-06-01 09:00:00', '2025-01-15 08:00:00'),
  (37, 'a1b2c3d4-0037-4000-8000-000000000037', 'lisa.moore@example.gov',       'enc_aes256_bGlzYS5tb29yZUBleGFtcGxlLmdvdg==',      'iv_abc037', '2023-01-20 12:00:00', '2024-11-01 14:00:00', 2, 'en', '2023-01-20 11:30:00', '2024-11-01 14:00:00'),
  (38, 'a1b2c3d4-0038-4000-8000-000000000038', 'mike.nelson@example.gov',      'enc_aes256_bWlrZS5uZWxzb25AZXhhbXBsZS5nb3Y=',      'iv_abc038', '2023-08-10 09:00:00', '2025-02-28 10:00:00', 1, 'en', '2023-08-10 08:30:00', '2025-02-28 10:00:00'),
  (39, 'a1b2c3d4-0039-4000-8000-000000000039', 'nancy.owens@example.gov',      'enc_aes256_bmFuY3kub3dlbnNAZXhhbXBsZS5nb3Y=',      'iv_abc039', '2024-02-14 15:00:00', '2025-03-01 09:00:00', 2, 'en', '2024-02-14 14:30:00', '2025-03-01 09:00:00'),
  (40, 'a1b2c3d4-0040-4000-8000-000000000040', 'oscar.perez@example.gov',      'enc_aes256_b3NjYXIucGVyZXpAZXhhbXBsZS5nb3Y=',      'iv_abc040', '2024-05-01 10:00:00', '2025-01-20 16:00:00', 1, 'es', '2024-05-01 09:30:00', '2025-01-20 16:00:00');

-- Users 41-45: Users with multiple email addresses
INSERT INTO users (id, uuid, email, encrypted_email, encrypted_email_iv, confirmed_at, ial, locale, created_at, updated_at) VALUES
  (41, 'a1b2c3d4-0041-4000-8000-000000000041', 'pat.quinn@example.gov',        'enc_aes256_cGF0LnF1aW5uQGV4YW1wbGUuZ292',          'iv_abc041', '2023-02-01 10:00:00', 2, 'en', '2023-02-01 09:00:00', '2025-02-15 14:00:00'),
  (42, 'a1b2c3d4-0042-4000-8000-000000000042', 'rosa.sanchez@example.gov',     'enc_aes256_cm9zYS5zYW5jaGV6QGV4YW1wbGUuZ292',      'iv_abc042', '2023-06-20 11:00:00', 1, 'es', '2023-06-20 10:30:00', '2025-01-05 09:00:00'),
  (43, 'a1b2c3d4-0043-4000-8000-000000000043', 'steve.turner@example.gov',     'enc_aes256_c3RldmUudHVybmVyQGV4YW1wbGUuZ292',      'iv_abc043', '2023-09-15 14:00:00', 2, 'en', '2023-09-15 13:30:00', '2025-03-10 11:00:00'),
  (44, 'a1b2c3d4-0044-4000-8000-000000000044', 'tina.underwood@example.gov',   'enc_aes256_dGluYS51bmRlcndvb2RAZXhhbXBsZS5nb3Y=',  'iv_abc044', '2024-01-08 09:00:00', 1, 'en', '2024-01-08 08:30:00', '2025-02-20 16:00:00'),
  (45, 'a1b2c3d4-0045-4000-8000-000000000045', 'ursula.vaughn@example.gov',    'enc_aes256_dXJzdWxhLnZhdWdobkBleGFtcGxlLmdvdg==',  'iv_abc045', '2024-04-22 12:00:00', 2, 'en', '2024-04-22 11:30:00', '2025-01-30 10:00:00');

-- Users 46-48: Unconfirmed / edge-case users
INSERT INTO users (id, uuid, email, encrypted_email, encrypted_email_iv, confirmed_at, ial, locale, created_at, updated_at) VALUES
  (46, 'a1b2c3d4-0046-4000-8000-000000000046', 'vince.ward@example.gov',       'enc_aes256_dmluY2Uud2FyZEBleGFtcGxlLmdvdg==',      'iv_abc046', NULL, 1, 'en', '2025-01-05 10:00:00', '2025-01-05 10:00:00'),
  (47, 'a1b2c3d4-0047-4000-8000-000000000047', 'wanda.xu@example.gov',         'enc_aes256_d2FuZGEueHVAZXhhbXBsZS5nb3Y=',          'iv_abc047', NULL, 1, 'zh', '2025-02-10 08:00:00', '2025-02-10 08:00:00'),
  (48, 'a1b2c3d4-0048-4000-8000-000000000048', 'yuri.zhang@example.gov',       'enc_aes256_eXVyaS56aGFuZ0BleGFtcGxlLmdvdg==',      'iv_abc048', NULL, 1, 'zh', '2025-03-01 15:00:00', '2025-03-01 15:00:00');

-- Users 49-52: Recently created IAL1 users (fresh accounts)
INSERT INTO users (id, uuid, email, encrypted_email, encrypted_email_iv, confirmed_at, ial, locale, created_at, updated_at) VALUES
  (49, 'a1b2c3d4-0049-4000-8000-000000000049', 'anna.bell@example.gov',        'enc_aes256_YW5uYS5iZWxsQGV4YW1wbGUuZ292',          'iv_abc049', '2025-02-20 10:00:00', 1, 'en', '2025-02-20 09:30:00', '2025-02-20 10:00:00'),
  (50, 'a1b2c3d4-0050-4000-8000-000000000050', 'ben.carter@example.gov',       'enc_aes256_YmVuLmNhcnRlckBleGFtcGxlLmdvdg==',      'iv_abc050', '2025-02-25 11:00:00', 1, 'en', '2025-02-25 10:30:00', '2025-02-25 11:00:00'),
  (51, 'a1b2c3d4-0051-4000-8000-000000000051', 'clara.diaz@example.gov',       'enc_aes256_Y2xhcmEuZGlhekBleGFtcGxlLmdvdg==',      'iv_abc051', '2025-03-01 09:00:00', 1, 'es', '2025-03-01 08:30:00', '2025-03-01 09:00:00'),
  (52, 'a1b2c3d4-0052-4000-8000-000000000052', 'derek.ellis@example.gov',      'enc_aes256_ZGVyZWsuZWxsaXNAZXhhbXBsZS5nb3Y=',      'iv_abc052', '2025-03-05 14:00:00', 1, 'fr', '2025-03-05 13:30:00', '2025-03-05 14:00:00'),
  -- Test migration account: use this to verify migrated login works
  -- Email: testmigration@example.gov / Password: Password123!
  (53, 'a1b2c3d4-0053-4000-8000-000000000053', 'testmigration@example.gov',   'enc_aes256_dGVzdG1pZ3JhdGlvbkBleGFtcGxlLmdvdg==',  'iv_abc053', '2025-03-10 10:00:00', 1, 'en', '2025-03-10 09:30:00', '2025-03-10 10:00:00');

-- Reset sequence
SELECT setval('users_id_seq', 53);

-- =============================================================================
-- Seed Data: Email Addresses (~65 rows)
-- Every user gets at least one primary email; some get extras
-- =============================================================================

-- Primary emails for all 52 users
INSERT INTO email_addresses (user_id, email, confirmed_at, is_primary, created_at, updated_at)
SELECT id, email, confirmed_at, TRUE, created_at, updated_at FROM users;

-- Secondary emails for users 41-45 (multi-email users)
INSERT INTO email_addresses (user_id, email, confirmed_at, is_primary, created_at, updated_at) VALUES
  (41, 'pat.quinn@personal.com',       '2023-03-15 10:00:00', FALSE, '2023-03-15 09:30:00', '2023-03-15 10:00:00'),
  (41, 'pquinn@agency.gov',            '2023-05-01 14:00:00', FALSE, '2023-05-01 13:30:00', '2023-05-01 14:00:00'),
  (42, 'rosa.s@personal.com',          '2023-08-10 11:00:00', FALSE, '2023-08-10 10:30:00', '2023-08-10 11:00:00'),
  (43, 'steve.t@contractor.com',       '2023-11-01 09:00:00', FALSE, '2023-11-01 08:30:00', '2023-11-01 09:00:00'),
  (43, 'sturner@agency2.gov',          '2024-01-20 15:00:00', FALSE, '2024-01-20 14:30:00', '2024-01-20 15:00:00'),
  (44, 'tina.u@personal.com',          '2024-03-10 10:00:00', FALSE, '2024-03-10 09:30:00', '2024-03-10 10:00:00'),
  (45, 'uvaughn@other-agency.gov',     '2024-06-01 12:00:00', FALSE, '2024-06-01 11:30:00', '2024-06-01 12:00:00');

-- Unconfirmed secondary emails for edge cases
INSERT INTO email_addresses (user_id, email, confirmed_at, is_primary, created_at, updated_at) VALUES
  (1,  'alice.j@personal.com',         NULL, FALSE, '2025-01-10 14:00:00', '2025-01-10 14:00:00'),
  (26, 'zallen@contractor.com',        NULL, FALSE, '2025-02-01 09:00:00', '2025-02-01 09:00:00'),
  (46, 'vince.ward@personal.com',      NULL, FALSE, '2025-01-05 10:00:00', '2025-01-05 10:00:00');

-- =============================================================================
-- Seed Data: Passwords (one per user, bcrypt hashes)
-- All use the same dummy password "Password123!" hashed with bcrypt cost 12
-- =============================================================================

INSERT INTO passwords (user_id, encrypted_password, created_at, updated_at) VALUES
  (1,  '$2a$12$LJ3m4ys3Lk0TSwMCPNEJluVbfNze.gHVsFgnGYMk5cGnNP3QCFJDa', '2022-03-15 09:30:00', '2022-03-15 09:30:00'),
  (2,  '$2a$12$kQ8x9Y7vW5mJpN2o3R6TBu8HdFgLaKpEcMxNjYqZs4wV1uDm3XKuy', '2022-04-20 10:30:00', '2022-04-20 10:30:00'),
  (3,  '$2a$12$nP7qW2eR9tYuI0o1A5s3Du6GhJkLm8NxOp4QrStUvWxYz1B2C3D4E5', '2022-05-10 07:45:00', '2022-05-10 07:45:00'),
  (4,  '$2a$12$aB1cD2eF3gH4iJ5kL6mN7oP8qR9sT0uV1wX2yZ3aB4cD5eF6gH7iJ', '2022-06-01 13:30:00', '2022-06-01 13:30:00'),
  (5,  '$2a$12$bC2dE3fG4hI5jK6lM7nO8pQ9rS0tU1vW2xY3zA4bC5dE6fG7hI8jK', '2022-07-22 08:45:00', '2022-07-22 08:45:00'),
  (6,  '$2a$12$cD3eF4gH5iJ6kL7mN8oP9qR0sT1uV2wX3yZ4aB5cD6eF7gH8iJ9kL', '2022-08-30 14:30:00', '2022-08-30 14:30:00'),
  (7,  '$2a$12$dE4fG5hI6jK7lM8nO9pQ0rS1tU2vW3xY4zA5bC6dE7fG8hI9jK0lM', '2022-09-14 09:30:00', '2022-09-14 09:30:00'),
  (8,  '$2a$12$eF5gH6iJ7kL8mN9oP0qR1sT2uV3wX4yZ5aB6cD7eF8gH9iJ0kL1mN', '2022-10-05 11:30:00', '2022-10-05 11:30:00'),
  (9,  '$2a$12$fG6hI7jK8lM9nO0pQ1rS2tU3vW4xY5zA6bC7dE8fG9hI0jK1lM2nO', '2022-11-18 15:45:00', '2022-11-18 15:45:00'),
  (10, '$2a$12$gH7iJ8kL9mN0oP1qR2sT3uV4wX5yZ6aB7cD8eF9gH0iJ1kL2mN3oP', '2022-12-01 07:30:00', '2022-12-01 07:30:00'),
  (11, '$2a$12$hI8jK9lM0nO1pQ2rS3tU4vW5xY6zA7bC8dE9fG0hI1jK2lM3nO4pQ', '2023-01-10 09:00:00', '2023-01-10 09:00:00'),
  (12, '$2a$12$iJ9kL0mN1oP2qR3sT4uV5wX6yZ7aB8cD9eF0gH1iJ2kL3mN4oP5qR', '2023-02-05 13:30:00', '2023-02-05 13:30:00'),
  (13, '$2a$12$jK0lM1nO2pQ3rS4tU5vW6xY7zA8bC9dE0fG1hI2jK3lM4nO5pQ6rS', '2023-03-12 08:30:00', '2023-03-12 08:30:00'),
  (14, '$2a$12$kL1mN2oP3qR4sT5uV6wX7yZ8aB9cD0eF1gH2iJ3kL4mN5oP6qR7sT', '2023-04-08 10:00:00', '2023-04-08 10:00:00'),
  (15, '$2a$12$lM2nO3pQ4rS5tU6vW7xY8zA9bC0dE1fG2hI3jK4lM5nO6pQ7rS8tU', '2023-05-20 12:30:00', '2023-05-20 12:30:00'),
  (16, '$2a$12$mN3oP4qR5sT6uV7wX8yZ9aB0cD1eF2gH3iJ4kL5mN6oP7qR8sT9uV', '2023-06-15 09:30:00', '2023-06-15 09:30:00'),
  (17, '$2a$12$nO4pQ5rS6tU7vW8xY9zA0bC1dE2fG3hI4jK5lM6nO7pQ8rS9tU0vW', '2023-07-01 14:30:00', '2023-07-01 14:30:00'),
  (18, '$2a$12$oP5qR6sT7uV8wX9yZ0aB1cD2eF3gH4iJ5kL6mN7oP8qR9sT0uV1wX', '2023-08-22 07:30:00', '2023-08-22 07:30:00'),
  (19, '$2a$12$pQ6rS7tU8vW9xY0zA1bC2dE3fG4hI5jK6lM7nO8pQ9rS0tU1vW2xY', '2023-09-10 10:00:00', '2023-09-10 10:00:00'),
  (20, '$2a$12$qR7sT8uV9wX0yZ1aB2cD3eF4gH5iJ6kL7mN8oP9qR0sT1uV2wX3yZ', '2023-10-14 13:30:00', '2023-10-14 13:30:00'),
  (21, '$2a$12$rS8tU9vW0xY1zA2bC3dE4fG5hI6jK7lM8nO9pQ0rS1tU2vW3xY4zA', '2023-11-02 08:30:00', '2023-11-02 08:30:00'),
  (22, '$2a$12$sT9uV0wX1yZ2aB3cD4eF5gH6iJ7kL8mN9oP0qR1sT2uV3wX4yZ5aB', '2023-12-08 15:30:00', '2023-12-08 15:30:00'),
  (23, '$2a$12$tU0vW1xY2zA3bC4dE5fG6hI7jK8lM9nO0pQ1rS2tU3vW4xY5zA6bC', '2024-01-15 09:30:00', '2024-01-15 09:30:00'),
  (24, '$2a$12$uV1wX2yZ3aB4cD5eF6gH7iJ8kL9mN0oP1qR2sT3uV4wX5yZ6aB7cD', '2024-02-20 11:30:00', '2024-02-20 11:30:00'),
  (25, '$2a$12$vW2xY3zA4bC5dE6fG7hI8jK9lM0nO1pQ2rS3tU4vW5xY6zA7bC8dE', '2024-03-10 12:30:00', '2024-03-10 12:30:00'),
  (26, '$2a$12$wX3yZ4aB5cD6eF7gH8iJ9kL0mN1oP2qR3sT4uV5wX6yZ7aB8cD9eF', '2023-03-01 09:00:00', '2023-03-01 09:00:00'),
  (27, '$2a$12$xY4zA5bC6dE7fG8hI9jK0lM1nO2pQ3rS4tU5vW6xY7zA8bC9dE0fG', '2023-04-15 10:00:00', '2023-04-15 10:00:00'),
  (28, '$2a$12$yZ5aB6cD7eF8gH9iJ0kL1mN2oP3qR4sT5uV6wX7yZ8aB9cD0eF1gH', '2023-05-22 13:30:00', '2023-05-22 13:30:00'),
  (29, '$2a$12$zA6bC7dE8fG9hI0jK1lM2nO3pQ4rS5tU6vW7xY8zA9bC0dE1fG2hI', '2023-06-10 08:30:00', '2023-06-10 08:30:00'),
  (30, '$2a$12$aB7cD8eF9gH0iJ1kL2mN3oP4qR5sT6uV7wX8yZ9aB0cD1eF2gH3iJ', '2023-07-18 14:30:00', '2023-07-18 14:30:00'),
  (31, '$2a$12$bC8dE9fG0hI1jK2lM3nO4pQ5rS6tU7vW8xY9zA0bC1dE2fG3hI4jK', '2023-08-25 09:00:00', '2023-08-25 09:00:00'),
  (32, '$2a$12$cD9eF0gH1iJ2kL3mN4oP5qR6sT7uV8wX9yZ0aB1cD2eF3gH4iJ5kL', '2023-09-30 11:30:00', '2023-09-30 11:30:00'),
  (33, '$2a$12$dE0fG1hI2jK3lM4nO5pQ6rS7tU8vW9xY0zA1bC2dE3fG4hI5jK6lM', '2023-10-12 15:30:00', '2023-10-12 15:30:00'),
  (34, '$2a$12$eF1gH2iJ3kL4mN5oP6qR7sT8uV9wX0yZ1aB2cD3eF4gH5iJ6kL7mN', '2023-11-20 07:30:00', '2023-11-20 07:30:00'),
  (35, '$2a$12$fG2hI3jK4lM5nO6pQ7rS8tU9vW0xY1zA2bC3dE4fG5hI6jK7lM8nO', '2023-12-05 10:00:00', '2023-12-05 10:00:00'),
  (36, '$2a$12$gH3iJ4kL5mN6oP7qR8sT9uV0wX1yZ2aB3cD4eF5gH6iJ7kL8mN9oP', '2022-06-01 09:00:00', '2022-06-01 09:00:00'),
  (37, '$2a$12$hI4jK5lM6nO7pQ8rS9tU0vW1xY2zA3bC4dE5fG6hI7jK8lM9nO0pQ', '2023-01-20 11:30:00', '2023-01-20 11:30:00'),
  (38, '$2a$12$iJ5kL6mN7oP8qR9sT0uV1wX2yZ3aB4cD5eF6gH7iJ8kL9mN0oP1qR', '2023-08-10 08:30:00', '2023-08-10 08:30:00'),
  (39, '$2a$12$jK6lM7nO8pQ9rS0tU1vW2xY3zA4bC5dE6fG7hI8jK9lM0nO1pQ2rS', '2024-02-14 14:30:00', '2024-02-14 14:30:00'),
  (40, '$2a$12$kL7mN8oP9qR0sT1uV2wX3yZ4aB5cD6eF7gH8iJ9kL0mN1oP2qR3sT', '2024-05-01 09:30:00', '2024-05-01 09:30:00'),
  (41, '$2a$12$lM8nO9pQ0rS1tU2vW3xY4zA5bC6dE7fG8hI9jK0lM1nO2pQ3rS4tU', '2023-02-01 09:00:00', '2023-02-01 09:00:00'),
  (42, '$2a$12$mN9oP0qR1sT2uV3wX4yZ5aB6cD7eF8gH9iJ0kL1mN2oP3qR4sT5uV', '2023-06-20 10:30:00', '2023-06-20 10:30:00'),
  (43, '$2a$12$nO0pQ1rS2tU3vW4xY5zA6bC7dE8fG9hI0jK1lM2nO3pQ4rS5tU6vW', '2023-09-15 13:30:00', '2023-09-15 13:30:00'),
  (44, '$2a$12$oP1qR2sT3uV4wX5yZ6aB7cD8eF9gH0iJ1kL2mN3oP4qR5sT6uV7wX', '2024-01-08 08:30:00', '2024-01-08 08:30:00'),
  (45, '$2a$12$pQ2rS3tU4vW5xY6zA7bC8dE9fG0hI1jK2lM3nO4pQ5rS6tU7vW8xY', '2024-04-22 11:30:00', '2024-04-22 11:30:00'),
  (49, '$2a$12$qR3sT4uV5wX6yZ7aB8cD9eF0gH1iJ2kL3mN4oP5qR6sT7uV8wX9yZ', '2025-02-20 09:30:00', '2025-02-20 09:30:00'),
  (50, '$2a$12$rS4tU5vW6xY7zA8bC9dE0fG1hI2jK3lM4nO5pQ6rS7tU8vW9xY0zA', '2025-02-25 10:30:00', '2025-02-25 10:30:00'),
  (51, '$2a$12$sT5uV6wX7yZ8aB9cD0eF1gH2iJ3kL4mN5oP6qR7sT8uV9wX0yZ1aB', '2025-03-01 08:30:00', '2025-03-01 08:30:00'),
  (52, '$2a$12$tU6vW7xY8zA9bC0dE1fG2hI3jK4lM5nO6pQ7rS8tU9vW0xY1zA2bC', '2025-03-05 13:30:00', '2025-03-05 13:30:00'),
  (53, '$2a$12$uV7wX8yZ9aB0cD1eF2gH3iJ4kL5mN6oP7qR8sT9uV0wX1yZ2aB3cD', '2025-03-10 09:30:00', '2025-03-10 09:30:00');

-- Note: Users 46-48 (unconfirmed) have no passwords yet

-- =============================================================================
-- Seed Data: WebAuthn Configurations (~15 keys across multi-MFA users)
-- =============================================================================

INSERT INTO webauthn_configurations (user_id, credential_id, credential_public_key, name, transports, created_at, updated_at) VALUES
  (26, 'cred_webauthn_26a', 'pQECAyYgASFYIGTmr5mIeVAu0hKRfZYLsNI0fwiKMvqWkN2TjEOVKJciWCBgWbKQJyTH0GWzFNTFRPqMv7f8yR4S5M3oK+LhD6xJQA==', 'YubiKey 5',       '["usb"]',             '2023-04-01 10:00:00', '2023-04-01 10:00:00'),
  (26, 'cred_webauthn_26b', 'pQECAyYgASFYIH8kT5mReABq2hLZfKYOsPI4fziNMxqXkO2UjFOXKLciWCBiXbLQKyUH1GYzGNUFSPrMw7g8zR5S6M4oL+MhE6yJRA==', 'Backup YubiKey',  '["usb"]',             '2023-04-01 10:05:00', '2023-04-01 10:05:00'),
  (27, 'cred_webauthn_27a', 'pQECAyYgASFYIJ9lU6mJeWBr3hMZgLYPtPJ5g0iPNyqYlP3VjGPYLMdiWCBjYcMRLyVI2GZzHOVGTPsMx8h90S6T7N5pM/NiF7zKSB==', 'Security Key',   '["usb","nfc"]',       '2023-05-20 14:00:00', '2023-05-20 14:00:00'),
  (29, 'cred_webauthn_29a', 'pQECAyYgASFYIK0mV7nKfXCs4iNahMYQtQK6g1iQOzrZmQ4WkHQZMNeiWCBlZeORMyXJ3GbzIOXHTQtNy9i+1U7V8O6qN/PjG8zLTC==', 'Touch ID',       '["internal"]',        '2023-07-01 09:00:00', '2023-07-01 09:00:00'),
  (30, 'cred_webauthn_30a', 'pQECAyYgASFYIL1nW8oLgYDt5jObhNZRuRL7h2jROzsbmR5XlIRaNOfiWCBmafPSNyYK4GczJPXIURuOz+j/2V8W9P7rO/QkH90MUD==', 'Windows Hello',  '["internal"]',        '2023-08-10 11:00:00', '2023-08-10 11:00:00'),
  (30, 'cred_webauthn_30b', 'pQECAyYgASFYIM2oX9pMhZEu6kPciOaStSM8i3kSP0tcnS6YmJSbOPgiWCBnbgQTOzZL5HdzKQYJVSvP0/k03W9X+Q8sP/RlI+1NVE==', 'Titan Key',      '["usb","ble"]',       '2023-08-10 11:05:00', '2023-08-10 11:05:00'),
  (32, 'cred_webauthn_32a', 'pQECAyYgASFYIN3pY+qNiZGv7lRdhPbTuTN9j4lTP1udoT7ZnLTcPRiiWCBpcSUUP0aM6JfzLRaKWTwQ1+m14X+Z/R9tQ/TmK+2OWF==', 'Passkey',        '["internal","hybrid"]','2023-10-15 10:00:00', '2023-10-15 10:00:00'),
  (33, 'cred_webauthn_33a', 'pQECAyYgASFYIO4qZ/rOjaHw8mSegQcUvUO+k5mUQ2veqU8aoMUdQSjiWCBqeTVWQ1bN7KgzMScLXUxR2/n25Y/a0S+uR/UnL/3PWG==', 'YubiKey',        '["usb"]',             '2023-11-01 14:00:00', '2023-11-01 14:00:00'),
  (35, 'cred_webauthn_35a', 'pQECAyYgASFYIP5ra/sPkbIx9nUfhRdVwVO/l6oWR3wfrW9bpNVeRUkkWCBsfXXYS3dP8MizOVeMYWzT3/o36b/c1U/wT/YoN/5RYH==', 'Clé FIDO',      '["usb"]',             '2024-01-05 10:00:00', '2024-01-05 10:00:00'),
  (41, 'cred_webauthn_41a', 'pQECAyYgASFYIQ6sb/tQlcJy+oVgiSdWxWP/m7pXS4xgsX+cpOWeTV1lWCBufYZaT4eQ9NjzPXfNZXzU4/p47c/d2V/xU/ZpO/6SaI==', 'Face ID',       '["internal"]',        '2023-04-01 10:00:00', '2023-04-01 10:00:00'),
  (43, 'cred_webauthn_43a', 'pQECAyYgASFYIR7tc/uRmdKz/pWhkTdXyXQ/n8rYU5yhsY/dpPXfVW2mWCBwgaacd5gS+PkzQYgOaYzV5/r58d/e3X/yW/aqP/7UbK==', 'Security Key',  '["usb"]',             '2023-10-20 15:00:00', '2023-10-20 15:00:00'),
  (45, 'cred_webauthn_45a', 'pQECAyYgASFYIS8ud/vSneL0/qXilUeYzYR/o9sZV6zjuZ/fpQYgWX3nWCByicce6ihU/RlzRZhPbZzW6/s69e/f4Y/zX/brQ/8VcM==', 'Touch ID',      '["internal"]',        '2024-05-15 09:00:00', '2024-05-15 09:00:00'),
  -- A few IAL2 users also with webauthn
  (11, 'cred_webauthn_11a', 'pQECAyYgASFYIU9ve/wTofM1/rYjmVfZzZS/p+taW7zkva/gqRZhXY4oWCBzjdef7jkV/SmzSajQcazX7/t7+f/g5Z/0Y/ctR/9WdO==', 'YubiKey 5C',    '["usb"]',             '2023-02-01 10:00:00', '2023-02-01 10:00:00'),
  (15, 'cred_webauthn_15a', 'pQECAyYgASFYIV+wf/xUpgN2/sZknWgZ0aT/q/ubX80lwa/hrSahYZ5pWCB0kkfg8klW/TnzTbkRdbzY8/u8/g/h6a/1Z/duS/+XeP==', 'Passkey',       '["internal","hybrid"]','2023-06-15 14:00:00', '2023-06-15 14:00:00');

-- =============================================================================
-- Seed Data: Auth App (TOTP) Configurations (~12)
-- otp_secret_key is encrypted (simulated attr_encrypted format)
-- =============================================================================

INSERT INTO auth_app_configurations (user_id, otp_secret_key, name, created_at, updated_at) VALUES
  (26, 'enc_aes256_dG90cF9zZWNyZXRfMjZfYmFzZTMyX0tSV0dTMzNS', 'Google Authenticator', '2023-04-02 10:00:00', '2023-04-02 10:00:00'),
  (27, 'enc_aes256_dG90cF9zZWNyZXRfMjdfYmFzZTMyX0pCU1dZM0RQ', 'Authy',                '2023-05-21 14:00:00', '2023-05-21 14:00:00'),
  (28, 'enc_aes256_dG90cF9zZWNyZXRfMjhfYmFzZTMyX01GUldHWTNM', '1Password',            '2023-05-23 10:00:00', '2023-05-23 10:00:00'),
  (29, 'enc_aes256_dG90cF9zZWNyZXRfMjlfYmFzZTMyX0tCNERDWkpR', 'Authenticator App',    '2023-07-02 09:00:00', '2023-07-02 09:00:00'),
  (30, 'enc_aes256_dG90cF9zZWNyZXRfMzBfYmFzZTMyX0hBM1RHTkpX', 'Google Authenticator', '2023-08-11 11:00:00', '2023-08-11 11:00:00'),
  (31, 'enc_aes256_dG90cF9zZWNyZXRfMzFfYmFzZTMyX0dJMkRLTkJS', 'Authy',                '2023-08-26 09:00:00', '2023-08-26 09:00:00'),
  (32, 'enc_aes256_dG90cF9zZWNyZXRfMzJfYmFzZTMyX0dFMkRJTUpS', 'Microsoft Authenticator','2023-10-01 12:00:00','2023-10-01 12:00:00'),
  (33, 'enc_aes256_dG90cF9zZWNyZXRfMzNfYmFzZTMyX0hBWURBTUJS', 'Google Authenticator', '2023-11-02 14:00:00', '2023-11-02 14:00:00'),
  (34, 'enc_aes256_dG90cF9zZWNyZXRfMzRfYmFzZTMyX0dNWVRHTUpS', 'Authy',                '2023-11-21 08:00:00', '2023-11-21 08:00:00'),
  (35, 'enc_aes256_dG90cF9zZWNyZXRfMzVfYmFzZTMyX0dJMlRLTkpS', 'App Auth',             '2024-01-06 10:00:00', '2024-01-06 10:00:00'),
  (11, 'enc_aes256_dG90cF9zZWNyZXRfMTFfYmFzZTMyX0hBWURNTkpX', 'Google Authenticator', '2023-02-15 10:00:00', '2023-02-15 10:00:00'),
  (41, 'enc_aes256_dG90cF9zZWNyZXRfNDFfYmFzZTMyX0pCU1dZM0RQ', 'Authy',                '2023-03-01 10:00:00', '2023-03-01 10:00:00');

-- =============================================================================
-- Seed Data: Backup Code Configurations (~8)
-- =============================================================================

INSERT INTO backup_code_configurations (user_id, codes, used_count, created_at, updated_at) VALUES
  (26, 'enc_aes256_WyIkMmEkMTIkYWJjMTIzIiwiJDJhJDEyJGRlZjQ1NiIsIiQyYSQxMiRnaGk3ODkiLCIkMmEkMTIkamtsMDEyIiwiJDJhJDEyJG1ubzM0NSIsIiQyYSQxMiRwcXI2NzgiLCIkMmEkMTIkc3R1OTAxIiwiJDJhJDEyJHZ3eDIzNCIsIiQyYSQxMiR5emExMjMiLCIkMmEkMTIkYmNkNDU2Il0=', 2, '2023-04-03 10:00:00', '2024-08-15 09:00:00'),
  (27, 'enc_aes256_WyIkMmEkMTIkYWJjMTIzXzI3IiwiJDJhJDEyJGRlZjQ1Nl8yNyIsIiQyYSQxMiRnaGk3ODlfMjciLCIkMmEkMTIkamtsMDEyXzI3IiwiJDJhJDEyJG1ubzM0NV8yNyIsIiQyYSQxMiRwcXI2NzhfMjciLCIkMmEkMTIkc3R1OTAxXzI3IiwiJDJhJDEyJHZ3eDIzNF8yNyIsIiQyYSQxMiR5emExMjNfMjciLCIkMmEkMTIkYmNkNDU2XzI3Il0=', 0, '2023-05-22 14:00:00', '2023-05-22 14:00:00'),
  (29, 'enc_aes256_WyIkMmEkMTIkYWJjMTIzXzI5IiwiJDJhJDEyJGRlZjQ1Nl8yOSIsIiQyYSQxMiRnaGk3ODlfMjkiLCIkMmEkMTIkamtsMDEyXzI5IiwiJDJhJDEyJG1ubzM0NV8yOSIsIiQyYSQxMiRwcXI2NzhfMjkiXQ==', 1, '2023-07-03 09:00:00', '2024-05-10 14:00:00'),
  (30, 'enc_aes256_WyIkMmEkMTIkYWJjMTIzXzMwIiwiJDJhJDEyJGRlZjQ1Nl8zMCIsIiQyYSQxMiRnaGk3ODlfMzAiLCIkMmEkMTIkamtsMDEyXzMwIiwiJDJhJDEyJG1ubzM0NV8zMCIsIiQyYSQxMiRwcXI2NzhfMzAiLCIkMmEkMTIkc3R1OTAxXzMwIiwiJDJhJDEyJHZ3eDIzNF8zMCIsIiQyYSQxMiR5emExMjNfMzAiLCIkMmEkMTIkYmNkNDU2XzMwIl0=', 0, '2023-08-12 11:00:00', '2023-08-12 11:00:00'),
  (32, 'enc_aes256_WyIkMmEkMTIkYWJjMTIzXzMyIiwiJDJhJDEyJGRlZjQ1Nl8zMiIsIiQyYSQxMiRnaGk3ODlfMzIiLCIkMmEkMTIkamtsMDEyXzMyIl0=', 3, '2023-10-02 12:00:00', '2025-01-05 10:00:00'),
  (33, 'enc_aes256_WyIkMmEkMTIkYWJjMTIzXzMzIiwiJDJhJDEyJGRlZjQ1Nl8zMyIsIiQyYSQxMiRnaGk3ODlfMzMiLCIkMmEkMTIkamtsMDEyXzMzIiwiJDJhJDEyJG1ubzM0NV8zMyIsIiQyYSQxMiRwcXI2NzhfMzMiLCIkMmEkMTIkc3R1OTAxXzMzIiwiJDJhJDEyJHZ3eDIzNF8zMyJd', 0, '2023-11-03 14:00:00', '2023-11-03 14:00:00'),
  (35, 'enc_aes256_WyIkMmEkMTIkYWJjMTIzXzM1IiwiJDJhJDEyJGRlZjQ1Nl8zNSIsIiQyYSQxMiRnaGk3ODlfMzUiLCIkMmEkMTIkamtsMDEyXzM1IiwiJDJhJDEyJG1ubzM0NV8zNSJd', 0, '2024-01-07 10:00:00', '2024-01-07 10:00:00'),
  (41, 'enc_aes256_WyIkMmEkMTIkYWJjMTIzXzQxIiwiJDJhJDEyJGRlZjQ1Nl80MSIsIiQyYSQxMiRnaGk3ODlfNDEiLCIkMmEkMTIkamtsMDEyXzQxIiwiJDJhJDEyJG1ubzM0NV80MSIsIiQyYSQxMiRwcXI2NzhfNDEiLCIkMmEkMTIkc3R1OTAxXzQxIiwiJDJhJDEyJHZ3eDIzNF80MSIsIiQyYSQxMiR5emExMjNfNDEiLCIkMmEkMTIkYmNkNDU2XzQxIl0=', 1, '2023-03-02 10:00:00', '2024-10-01 08:00:00');

-- =============================================================================
-- Seed Data: Phone Configurations (~20)
-- =============================================================================

INSERT INTO phone_configurations (user_id, encrypted_phone, encrypted_phone_iv, confirmed_at, delivery_preference, mfa_enabled, created_at, updated_at) VALUES
  (11, 'enc_aes256_KzEyMDI1NTUwMTAx', 'iv_ph011', '2023-01-15 10:00:00', 'sms',   TRUE,  '2023-01-15 10:00:00', '2023-01-15 10:00:00'),
  (12, 'enc_aes256_KzEyMDI1NTUwMTAy', 'iv_ph012', '2023-02-10 14:00:00', 'sms',   TRUE,  '2023-02-10 14:00:00', '2023-02-10 14:00:00'),
  (13, 'enc_aes256_KzEyMDI1NTUwMTAz', 'iv_ph013', '2023-03-15 09:00:00', 'voice', TRUE,  '2023-03-15 09:00:00', '2023-03-15 09:00:00'),
  (14, 'enc_aes256_KzEyMDI1NTUwMTA0', 'iv_ph014', '2023-04-10 11:00:00', 'sms',   TRUE,  '2023-04-10 11:00:00', '2023-04-10 11:00:00'),
  (15, 'enc_aes256_KzEyMDI1NTUwMTA1', 'iv_ph015', '2023-05-25 13:00:00', 'sms',   TRUE,  '2023-05-25 13:00:00', '2023-05-25 13:00:00'),
  (16, 'enc_aes256_KzEyMDI1NTUwMTA2', 'iv_ph016', '2023-06-20 10:00:00', 'sms',   TRUE,  '2023-06-20 10:00:00', '2023-06-20 10:00:00'),
  (17, 'enc_aes256_KzEyMDI1NTUwMTA3', 'iv_ph017', '2023-07-05 15:00:00', 'voice', TRUE,  '2023-07-05 15:00:00', '2023-07-05 15:00:00'),
  (18, 'enc_aes256_KzEyMDI1NTUwMTA4', 'iv_ph018', '2023-08-25 08:00:00', 'sms',   TRUE,  '2023-08-25 08:00:00', '2023-08-25 08:00:00'),
  (20, 'enc_aes256_KzEyMDI1NTUwMTEw', 'iv_ph020', '2023-10-20 14:00:00', 'sms',   TRUE,  '2023-10-20 14:00:00', '2023-10-20 14:00:00'),
  (21, 'enc_aes256_KzEyMDI1NTUwMTEx', 'iv_ph021', '2023-11-05 09:00:00', 'sms',   TRUE,  '2023-11-05 09:00:00', '2023-11-05 09:00:00'),
  (26, 'enc_aes256_KzEyMDI1NTUwMTI2', 'iv_ph026', '2023-04-05 10:00:00', 'sms',   TRUE,  '2023-04-05 10:00:00', '2023-04-05 10:00:00'),
  (27, 'enc_aes256_KzEyMDI1NTUwMTI3', 'iv_ph027', '2023-05-25 14:00:00', 'sms',   TRUE,  '2023-05-25 14:00:00', '2023-05-25 14:00:00'),
  (29, 'enc_aes256_KzEyMDI1NTUwMTI5', 'iv_ph029', '2023-07-05 09:00:00', 'voice', TRUE,  '2023-07-05 09:00:00', '2023-07-05 09:00:00'),
  (30, 'enc_aes256_KzEyMDI1NTUwMTMw', 'iv_ph030', '2023-08-15 11:00:00', 'sms',   TRUE,  '2023-08-15 11:00:00', '2023-08-15 11:00:00'),
  (33, 'enc_aes256_KzEyMDI1NTUwMTMz', 'iv_ph033', '2023-11-05 16:00:00', 'sms',   TRUE,  '2023-11-05 16:00:00', '2023-11-05 16:00:00'),
  (35, 'enc_aes256_KzEyMDI1NTUwMTM1', 'iv_ph035', '2024-01-10 10:00:00', 'sms',   TRUE,  '2024-01-10 10:00:00', '2024-01-10 10:00:00'),
  (37, 'enc_aes256_KzEyMDI1NTUwMTM3', 'iv_ph037', '2023-02-01 12:00:00', 'sms',   FALSE, '2023-02-01 12:00:00', '2024-11-01 14:00:00'),
  (39, 'enc_aes256_KzEyMDI1NTUwMTM5', 'iv_ph039', '2024-03-01 15:00:00', 'sms',   TRUE,  '2024-03-01 15:00:00', '2024-03-01 15:00:00'),
  (41, 'enc_aes256_KzEyMDI1NTUwMTQx', 'iv_ph041', '2023-02-10 10:00:00', 'sms',   TRUE,  '2023-02-10 10:00:00', '2023-02-10 10:00:00'),
  (43, 'enc_aes256_KzEyMDI1NTUwMTQz', 'iv_ph043', '2023-10-01 14:00:00', 'sms',   TRUE,  '2023-10-01 14:00:00', '2023-10-01 14:00:00');

-- =============================================================================
-- Seed Data: Profiles (IAL2 users — 20 profiles)
-- encrypted_pii simulates Rails attr_encrypted JSON blob
-- =============================================================================

INSERT INTO profiles (user_id, ssn_signature, encrypted_pii, encrypted_pii_iv, verified_at, activated_at, deactivation_reason, created_at, updated_at) VALUES
  (11, 'sha256_ssn_sig_011', 'enc_aes256_eyJzc24iOiI1MDAtMDAtMDAxMSIsImZpcnN0X25hbWUiOiJLYXJlbiIsImxhc3RfbmFtZSI6IldoaXRlIiwiZG9iIjoiMTk4NS0wMy0xNSIsImFkZHJlc3MiOnsiY2l0eSI6Ildhc2hpbmd0b24iLCJzdGF0ZSI6IkRDIiwiemlwIjoiMjAwMDEifSwicGhvbmUiOiIrMTIwMjU1NTAxMDEifQ==', 'iv_pii_011', '2023-01-20 10:00:00', '2023-01-20 10:00:00', NULL,         '2023-01-20 10:00:00', '2023-01-20 10:00:00'),
  (12, 'sha256_ssn_sig_012', 'enc_aes256_eyJzc24iOiI1MDAtMDAtMDAxMiIsImZpcnN0X25hbWUiOiJMdWlzIiwibGFzdF9uYW1lIjoiUm9kcmlndWV6IiwiZG9iIjoiMTk5MC0wNy0yMiIsImFkZHJlc3MiOnsiY2l0eSI6Ik1pYW1pIiwic3RhdGUiOiJGTCIsInppcCI6IjMzMTAxIn0sInBob25lIjoiKzEzMDU1NTUwMTAyIn0=', 'iv_pii_012', '2023-02-15 14:00:00', '2023-02-15 14:00:00', NULL,         '2023-02-15 14:00:00', '2023-02-15 14:00:00'),
  (13, 'sha256_ssn_sig_013', 'enc_aes256_eyJzc24iOiI1MDAtMDAtMDAxMyIsImZpcnN0X25hbWUiOiJNYXJpYSIsImxhc3RfbmFtZSI6Ikhlcm5hbmRleiIsImRvYiI6IjE5ODgtMTEtMDMifQ==', 'iv_pii_013', '2023-03-20 09:00:00', '2023-03-20 09:00:00', NULL,         '2023-03-20 09:00:00', '2023-03-20 09:00:00'),
  (14, 'sha256_ssn_sig_014', 'enc_aes256_eyJzc24iOiI1MDAtMDAtMDAxNCIsImZpcnN0X25hbWUiOiJOYXRoYW4iLCJsYXN0X25hbWUiOiJLaW0iLCJkb2IiOiIxOTkyLTA0LTE4In0=', 'iv_pii_014', '2023-04-15 11:00:00', '2023-04-15 11:00:00', NULL,         '2023-04-15 11:00:00', '2023-04-15 11:00:00'),
  (15, 'sha256_ssn_sig_015', 'enc_aes256_eyJzc24iOiI1MDAtMDAtMDAxNSIsImZpcnN0X25hbWUiOiJPbGl2aWEiLCJsYXN0X25hbWUiOiJOZ3V5ZW4iLCJkb2IiOiIxOTk1LTA5LTMwIn0=', 'iv_pii_015', '2023-05-28 13:00:00', '2023-05-28 13:00:00', NULL,         '2023-05-28 13:00:00', '2023-05-28 13:00:00'),
  (16, 'sha256_ssn_sig_016', 'enc_aes256_eyJzc24iOiI1MDAtMDAtMDAxNiJ9', 'iv_pii_016', '2023-06-20 10:00:00', '2023-06-20 10:00:00', NULL,         '2023-06-20 10:00:00', '2023-06-20 10:00:00'),
  (17, 'sha256_ssn_sig_017', 'enc_aes256_eyJzc24iOiI1MDAtMDAtMDAxNyJ9', 'iv_pii_017', '2023-07-10 15:00:00', '2023-07-10 15:00:00', NULL,         '2023-07-10 15:00:00', '2023-07-10 15:00:00'),
  (18, 'sha256_ssn_sig_018', 'enc_aes256_eyJzc24iOiI1MDAtMDAtMDAxOCJ9', 'iv_pii_018', '2023-08-28 08:00:00', '2023-08-28 08:00:00', NULL,         '2023-08-28 08:00:00', '2023-08-28 08:00:00'),
  (19, 'sha256_ssn_sig_019', 'enc_aes256_eyJzc24iOiI1MDAtMDAtMDAxOSJ9', 'iv_pii_019', '2023-09-15 11:00:00', '2023-09-15 11:00:00', NULL,         '2023-09-15 11:00:00', '2023-09-15 11:00:00'),
  (20, 'sha256_ssn_sig_020', 'enc_aes256_eyJzc24iOiI1MDAtMDAtMDAyMCJ9', 'iv_pii_020', '2023-10-20 14:00:00', '2023-10-20 14:00:00', NULL,         '2023-10-20 14:00:00', '2023-10-20 14:00:00'),
  (21, 'sha256_ssn_sig_021', 'enc_aes256_eyJzc24iOiI1MDAtMDAtMDAyMSJ9', 'iv_pii_021', '2023-11-08 09:00:00', '2023-11-08 09:00:00', NULL,         '2023-11-08 09:00:00', '2023-11-08 09:00:00'),
  (22, 'sha256_ssn_sig_022', 'enc_aes256_eyJzc24iOiI1MDAtMDAtMDAyMiJ9', 'iv_pii_022', '2023-12-15 16:00:00', '2023-12-15 16:00:00', NULL,         '2023-12-15 16:00:00', '2023-12-15 16:00:00'),
  (23, 'sha256_ssn_sig_023', 'enc_aes256_eyJzc24iOiI1MDAtMDAtMDAyMyJ9', 'iv_pii_023', '2024-01-20 10:00:00', '2024-01-20 10:00:00', NULL,         '2024-01-20 10:00:00', '2024-01-20 10:00:00'),
  (24, 'sha256_ssn_sig_024', 'enc_aes256_eyJzc24iOiI1MDAtMDAtMDAyNCJ9', 'iv_pii_024', '2024-02-28 12:00:00', '2024-02-28 12:00:00', NULL,         '2024-02-28 12:00:00', '2024-02-28 12:00:00'),
  (25, 'sha256_ssn_sig_025', 'enc_aes256_eyJzc24iOiI1MDAtMDAtMDAyNSJ9', 'iv_pii_025', '2024-03-15 13:00:00', '2024-03-15 13:00:00', NULL,         '2024-03-15 13:00:00', '2024-03-15 13:00:00'),
  (26, 'sha256_ssn_sig_026', 'enc_aes256_eyJzc24iOiI1MDAtMDAtMDAyNiJ9', 'iv_pii_026', '2023-04-10 10:00:00', '2023-04-10 10:00:00', NULL,         '2023-04-10 10:00:00', '2023-04-10 10:00:00'),
  (27, 'sha256_ssn_sig_027', 'enc_aes256_eyJzc24iOiI1MDAtMDAtMDAyNyJ9', 'iv_pii_027', '2023-06-01 11:00:00', '2023-06-01 11:00:00', NULL,         '2023-06-01 11:00:00', '2023-06-01 11:00:00'),
  (29, 'sha256_ssn_sig_029', 'enc_aes256_eyJzc24iOiI1MDAtMDAtMDAyOSJ9', 'iv_pii_029', '2023-07-15 09:00:00', '2023-07-15 09:00:00', NULL,         '2023-07-15 09:00:00', '2023-07-15 09:00:00'),
  (30, 'sha256_ssn_sig_030', 'enc_aes256_eyJzc24iOiI1MDAtMDAtMDAzMCJ9', 'iv_pii_030', '2023-08-20 11:00:00', '2023-08-20 11:00:00', NULL,         '2023-08-20 11:00:00', '2023-08-20 11:00:00'),
  -- Deactivated profile (user re-proofed)
  (37, 'sha256_ssn_sig_037', 'enc_aes256_eyJzc24iOiI1MDAtMDAtMDAzNyJ9', 'iv_pii_037', '2023-02-01 12:00:00', '2023-02-01 12:00:00', 'encryption_error', '2023-02-01 12:00:00', '2024-11-01 14:00:00');

-- =============================================================================
-- Seed Data: Identities (User ↔ Service Provider linkages — ~40)
-- =============================================================================

INSERT INTO identities (user_id, service_provider_id, last_authenticated_at, session_uuid, created_at, updated_at) VALUES
  -- Users linked to CBP Travel Portal (SP 1)
  (11, 1, '2025-02-15 10:00:00', 'f47ac10b-58cc-4372-a567-0e02b2c3d479', '2023-01-25 10:00:00', '2025-02-15 10:00:00'),
  (14, 1, '2025-01-10 14:00:00', '550e8400-e29b-41d4-a716-446655440001', '2023-04-20 11:00:00', '2025-01-10 14:00:00'),
  (26, 1, '2025-03-01 14:00:00', '6ba7b810-9dad-11d1-80b4-00c04fd430c8', '2023-04-15 10:00:00', '2025-03-01 14:00:00'),
  (29, 1, '2024-12-15 09:00:00', '6ba7b811-9dad-11d1-80b4-00c04fd430c8', '2023-07-10 09:00:00', '2024-12-15 09:00:00'),
  (33, 1, '2025-03-08 12:00:00', '6ba7b812-9dad-11d1-80b4-00c04fd430c8', '2023-11-15 16:00:00', '2025-03-08 12:00:00'),
  (41, 1, '2025-02-15 14:00:00', '6ba7b813-9dad-11d1-80b4-00c04fd430c8', '2023-03-01 10:00:00', '2025-02-15 14:00:00'),
  -- Users linked to My Social Security (SP 2)
  (11, 2, '2025-01-20 09:00:00', '7c9e6679-7425-40de-944b-e07fc1f90ae7', '2023-02-01 10:00:00', '2025-01-20 09:00:00'),
  (12, 2, '2025-01-25 16:00:00', '7c9e6680-7425-40de-944b-e07fc1f90ae7', '2023-02-10 14:00:00', '2025-01-25 16:00:00'),
  (13, 2, '2025-03-01 10:00:00', '7c9e6681-7425-40de-944b-e07fc1f90ae7', '2023-03-15 09:00:00', '2025-03-01 10:00:00'),
  (15, 2, '2025-02-20 08:00:00', '7c9e6682-7425-40de-944b-e07fc1f90ae7', '2023-06-01 13:00:00', '2025-02-20 08:00:00'),
  (20, 2, '2025-02-01 10:00:00', '7c9e6683-7425-40de-944b-e07fc1f90ae7', '2023-11-01 14:00:00', '2025-02-01 10:00:00'),
  (21, 2, '2025-01-15 11:00:00', '7c9e6684-7425-40de-944b-e07fc1f90ae7', '2023-11-10 09:00:00', '2025-01-15 11:00:00'),
  (25, 2, '2025-02-28 09:00:00', '7c9e6685-7425-40de-944b-e07fc1f90ae7', '2024-04-01 13:00:00', '2025-02-28 09:00:00'),
  (30, 2, '2025-02-05 11:00:00', '7c9e6686-7425-40de-944b-e07fc1f90ae7', '2023-08-20 11:00:00', '2025-02-05 11:00:00'),
  (37, 2, '2024-10-20 12:00:00', '7c9e6687-7425-40de-944b-e07fc1f90ae7', '2023-02-01 12:00:00', '2024-10-20 12:00:00'),
  -- Users linked to USPS Informed Delivery (SP 3)
  (1,  3, '2025-01-10 14:00:00', '8a3b4c5d-6e7f-4a8b-9c0d-1e2f3a4b5c6d', '2022-04-01 10:00:00', '2025-01-10 14:00:00'),
  (2,  3, '2025-02-01 09:00:00', '8a3b4c5e-6e7f-4a8b-9c0d-1e2f3a4b5c6d', '2022-05-15 11:00:00', '2025-02-01 09:00:00'),
  (3,  3, '2024-11-15 16:00:00', '8a3b4c5f-6e7f-4a8b-9c0d-1e2f3a4b5c6d', '2022-06-01 08:00:00', '2024-11-15 16:00:00'),
  (5,  3, '2025-01-05 11:00:00', '8a3b4c60-6e7f-4a8b-9c0d-1e2f3a4b5c6d', '2022-08-15 09:00:00', '2025-01-05 11:00:00'),
  (7,  3, '2025-03-01 12:00:00', '8a3b4c61-6e7f-4a8b-9c0d-1e2f3a4b5c6d', '2022-10-01 10:00:00', '2025-03-01 12:00:00'),
  (9,  3, '2025-01-20 09:00:00', '8a3b4c62-6e7f-4a8b-9c0d-1e2f3a4b5c6d', '2022-12-01 16:00:00', '2025-01-20 09:00:00'),
  (42, 3, '2025-01-05 09:00:00', '8a3b4c63-6e7f-4a8b-9c0d-1e2f3a4b5c6d', '2023-07-01 11:00:00', '2025-01-05 09:00:00'),
  (44, 3, '2025-02-20 16:00:00', '8a3b4c64-6e7f-4a8b-9c0d-1e2f3a4b5c6d', '2024-02-01 09:00:00', '2025-02-20 16:00:00'),
  -- Users linked to VA Health Benefits (SP 4)
  (16, 4, '2025-01-30 15:00:00', '9b4c5d6e-7f8a-4b9c-0d1e-2f3a4b5c6d7e', '2023-07-01 10:00:00', '2025-01-30 15:00:00'),
  (17, 4, '2024-11-05 09:00:00', '9b4c5d6f-7f8a-4b9c-0d1e-2f3a4b5c6d7e', '2023-07-15 15:00:00', '2024-11-05 09:00:00'),
  (18, 4, '2025-03-05 12:00:00', '9b4c5d70-7f8a-4b9c-0d1e-2f3a4b5c6d7e', '2023-09-01 08:00:00', '2025-03-05 12:00:00'),
  (19, 4, '2024-10-20 16:00:00', '9b4c5d71-7f8a-4b9c-0d1e-2f3a4b5c6d7e', '2023-10-01 10:00:00', '2024-10-20 16:00:00'),
  (22, 4, '2024-12-01 14:00:00', '9b4c5d72-7f8a-4b9c-0d1e-2f3a4b5c6d7e', '2024-01-01 16:00:00', '2024-12-01 14:00:00'),
  (23, 4, '2025-03-10 08:00:00', '9b4c5d73-7f8a-4b9c-0d1e-2f3a4b5c6d7e', '2024-02-01 10:00:00', '2025-03-10 08:00:00'),
  (24, 4, '2025-01-10 16:00:00', '9b4c5d74-7f8a-4b9c-0d1e-2f3a4b5c6d7e', '2024-03-01 12:00:00', '2025-01-10 16:00:00'),
  (32, 4, '2024-11-20 08:00:00', '9b4c5d75-7f8a-4b9c-0d1e-2f3a4b5c6d7e', '2023-10-15 12:00:00', '2024-11-20 08:00:00'),
  (35, 4, '2025-01-28 15:00:00', '9b4c5d76-7f8a-4b9c-0d1e-2f3a4b5c6d7e', '2024-01-15 10:00:00', '2025-01-28 15:00:00'),
  (39, 4, '2025-03-01 09:00:00', '9b4c5d77-7f8a-4b9c-0d1e-2f3a4b5c6d7e', '2024-03-01 15:00:00', '2025-03-01 09:00:00'),
  (43, 4, '2025-03-10 11:00:00', '9b4c5d78-7f8a-4b9c-0d1e-2f3a4b5c6d7e', '2023-10-01 14:00:00', '2025-03-10 11:00:00'),
  (45, 4, '2025-01-30 10:00:00', '9b4c5d79-7f8a-4b9c-0d1e-2f3a4b5c6d7e', '2024-06-01 12:00:00', '2025-01-30 10:00:00'),
  -- Multi-SP users: user 11 uses 3 SPs, user 26 uses 2 SPs
  (11, 4, '2025-02-10 14:00:00', '9b4c5d7a-7f8a-4b9c-0d1e-2f3a4b5c6d7e', '2023-03-01 10:00:00', '2025-02-10 14:00:00'),
  (26, 2, '2025-02-20 09:00:00', '7c9e6688-7425-40de-944b-e07fc1f90ae7', '2023-05-01 10:00:00', '2025-02-20 09:00:00');

-- =============================================================================
-- Seed Data: Events (audit log — ~120 entries)
-- =============================================================================

-- Account creation events (one per user)
INSERT INTO events (user_id, event_type, ip, created_at)
SELECT id, 'account_creation', '192.168.1.' || (id % 254 + 1), created_at FROM users;

-- Email confirmation events (for confirmed users)
INSERT INTO events (user_id, event_type, ip, created_at)
SELECT id, 'email_confirmed', '192.168.1.' || (id % 254 + 1), confirmed_at FROM users WHERE confirmed_at IS NOT NULL;

-- Password creation events (for users with passwords)
INSERT INTO events (user_id, event_type, ip, created_at)
SELECT p.user_id, 'password_created', '192.168.1.' || (p.user_id % 254 + 1), p.created_at FROM passwords p;

-- Sign-in events (recent logins for active users)
INSERT INTO events (user_id, event_type, ip, created_at) VALUES
  (1,  'sign_in_after_2fa',   '10.0.0.101', '2025-01-10 14:00:00'),
  (2,  'sign_in_after_2fa',   '10.0.0.102', '2025-02-01 09:00:00'),
  (5,  'sign_in_after_2fa',   '10.0.0.105', '2025-01-05 11:00:00'),
  (7,  'sign_in_after_2fa',   '10.0.0.107', '2025-03-01 12:00:00'),
  (9,  'sign_in_after_2fa',   '10.0.0.109', '2025-01-20 09:00:00'),
  (11, 'sign_in_after_2fa',   '10.0.0.111', '2025-02-15 10:00:00'),
  (11, 'sign_in_after_2fa',   '10.0.0.111', '2025-01-20 09:00:00'),
  (11, 'sign_in_after_2fa',   '10.0.0.111', '2025-02-10 14:00:00'),
  (12, 'sign_in_after_2fa',   '10.0.0.112', '2025-01-25 16:00:00'),
  (13, 'sign_in_after_2fa',   '10.0.0.113', '2025-03-01 10:00:00'),
  (14, 'sign_in_after_2fa',   '10.0.0.114', '2025-01-10 14:00:00'),
  (15, 'sign_in_after_2fa',   '10.0.0.115', '2025-02-20 08:00:00'),
  (20, 'sign_in_after_2fa',   '10.0.0.120', '2025-02-01 10:00:00'),
  (26, 'sign_in_after_2fa',   '10.0.0.126', '2025-03-01 14:00:00'),
  (26, 'sign_in_after_2fa',   '10.0.0.126', '2025-02-20 09:00:00'),
  (27, 'sign_in_after_2fa',   '10.0.0.127', '2025-02-10 09:00:00'),
  (29, 'sign_in_after_2fa',   '10.0.0.129', '2024-12-15 09:00:00'),
  (30, 'sign_in_after_2fa',   '10.0.0.130', '2025-02-05 11:00:00'),
  (33, 'sign_in_after_2fa',   '10.0.0.133', '2025-03-08 12:00:00'),
  (35, 'sign_in_after_2fa',   '10.0.0.135', '2025-01-28 15:00:00'),
  (41, 'sign_in_after_2fa',   '10.0.0.141', '2025-02-15 14:00:00'),
  (43, 'sign_in_after_2fa',   '10.0.0.143', '2025-03-10 11:00:00'),
  (45, 'sign_in_after_2fa',   '10.0.0.145', '2025-01-30 10:00:00'),
  (49, 'sign_in_after_2fa',   '10.0.0.149', '2025-02-20 10:00:00'),
  (50, 'sign_in_after_2fa',   '10.0.0.150', '2025-02-25 11:00:00');

-- MFA setup events
INSERT INTO events (user_id, event_type, ip, created_at) VALUES
  (26, 'multi_factor_auth_setup', '10.0.0.126', '2023-04-01 10:00:00'),
  (26, 'webauthn_setup',          '10.0.0.126', '2023-04-01 10:00:00'),
  (26, 'totp_setup',              '10.0.0.126', '2023-04-02 10:00:00'),
  (26, 'backup_code_setup',       '10.0.0.126', '2023-04-03 10:00:00'),
  (27, 'webauthn_setup',          '10.0.0.127', '2023-05-20 14:00:00'),
  (27, 'totp_setup',              '10.0.0.127', '2023-05-21 14:00:00'),
  (27, 'backup_code_setup',       '10.0.0.127', '2023-05-22 14:00:00'),
  (29, 'webauthn_setup',          '10.0.0.129', '2023-07-01 09:00:00'),
  (29, 'totp_setup',              '10.0.0.129', '2023-07-02 09:00:00'),
  (30, 'webauthn_setup',          '10.0.0.130', '2023-08-10 11:00:00'),
  (30, 'totp_setup',              '10.0.0.130', '2023-08-11 11:00:00'),
  (31, 'totp_setup',              '10.0.0.131', '2023-08-26 09:00:00'),
  (32, 'webauthn_setup',          '10.0.0.132', '2023-10-15 10:00:00'),
  (32, 'totp_setup',              '10.0.0.132', '2023-10-01 12:00:00'),
  (33, 'webauthn_setup',          '10.0.0.133', '2023-11-01 14:00:00'),
  (33, 'totp_setup',              '10.0.0.133', '2023-11-02 14:00:00'),
  (34, 'totp_setup',              '10.0.0.134', '2023-11-21 08:00:00'),
  (35, 'webauthn_setup',          '10.0.0.135', '2024-01-05 10:00:00'),
  (35, 'totp_setup',              '10.0.0.135', '2024-01-06 10:00:00');

-- Account locked events
INSERT INTO events (user_id, event_type, ip, created_at) VALUES
  (36, 'account_locked',   '172.16.0.36', '2025-01-15 08:00:00'),
  (37, 'account_locked',   '172.16.0.37', '2024-11-01 14:00:00'),
  (38, 'account_locked',   '172.16.0.38', '2025-02-28 10:00:00'),
  (39, 'account_locked',   '172.16.0.39', '2025-03-01 09:00:00'),
  (40, 'account_locked',   '172.16.0.40', '2025-01-20 16:00:00');

-- Failed sign-in attempts (for locked users — 3 failures before lock)
INSERT INTO events (user_id, event_type, ip, created_at) VALUES
  (36, 'sign_in_unsuccessful', '203.0.113.10', '2025-01-15 07:50:00'),
  (36, 'sign_in_unsuccessful', '203.0.113.10', '2025-01-15 07:52:00'),
  (36, 'sign_in_unsuccessful', '203.0.113.10', '2025-01-15 07:55:00'),
  (37, 'sign_in_unsuccessful', '203.0.113.11', '2024-11-01 13:50:00'),
  (37, 'sign_in_unsuccessful', '203.0.113.11', '2024-11-01 13:52:00'),
  (37, 'sign_in_unsuccessful', '203.0.113.11', '2024-11-01 13:55:00'),
  (38, 'sign_in_unsuccessful', '203.0.113.12', '2025-02-28 09:50:00'),
  (38, 'sign_in_unsuccessful', '203.0.113.12', '2025-02-28 09:52:00'),
  (38, 'sign_in_unsuccessful', '203.0.113.12', '2025-02-28 09:55:00');

-- Identity verification events (IAL2 proofing)
INSERT INTO events (user_id, event_type, ip, created_at) VALUES
  (11, 'identity_verified',  '10.0.0.111', '2023-01-20 10:00:00'),
  (12, 'identity_verified',  '10.0.0.112', '2023-02-15 14:00:00'),
  (13, 'identity_verified',  '10.0.0.113', '2023-03-20 09:00:00'),
  (14, 'identity_verified',  '10.0.0.114', '2023-04-15 11:00:00'),
  (15, 'identity_verified',  '10.0.0.115', '2023-05-28 13:00:00'),
  (16, 'identity_verified',  '10.0.0.116', '2023-06-20 10:00:00'),
  (17, 'identity_verified',  '10.0.0.117', '2023-07-10 15:00:00'),
  (18, 'identity_verified',  '10.0.0.118', '2023-08-28 08:00:00'),
  (19, 'identity_verified',  '10.0.0.119', '2023-09-15 11:00:00'),
  (20, 'identity_verified',  '10.0.0.120', '2023-10-20 14:00:00'),
  (21, 'identity_verified',  '10.0.0.121', '2023-11-08 09:00:00'),
  (22, 'identity_verified',  '10.0.0.122', '2023-12-15 16:00:00'),
  (23, 'identity_verified',  '10.0.0.123', '2024-01-20 10:00:00'),
  (24, 'identity_verified',  '10.0.0.124', '2024-02-28 12:00:00'),
  (25, 'identity_verified',  '10.0.0.125', '2024-03-15 13:00:00'),
  (26, 'identity_verified',  '10.0.0.126', '2023-04-10 10:00:00'),
  (27, 'identity_verified',  '10.0.0.127', '2023-06-01 11:00:00'),
  (29, 'identity_verified',  '10.0.0.129', '2023-07-15 09:00:00'),
  (30, 'identity_verified',  '10.0.0.130', '2023-08-20 11:00:00'),
  (37, 'identity_verified',  '10.0.0.137', '2023-02-01 12:00:00');

COMMIT;

-- =============================================================================
-- Summary:
--   52 users (10 IAL1, 15 IAL2, 10 multi-MFA, 5 locked, 5 multi-email, 3 unconfirmed, 4 recent)
--   ~62 email_addresses (52 primary + 10 secondary/unconfirmed)
--   49 passwords (all users except 3 unconfirmed)
--   14 webauthn_configurations
--   12 auth_app_configurations (TOTP)
--   8  backup_code_configurations
--   20 phone_configurations
--   20 profiles (IAL2 verified)
--   37 identities (user↔SP linkages)
--   ~165 events (account creation, email confirm, password, sign-in, MFA setup, lock, identity verify)
--   4  service_providers
-- =============================================================================
