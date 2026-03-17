-- Seed data for local development and testing

-- Test service providers
INSERT INTO service_providers (id, name, ial_max, aal_max, redirect_uris, public_key, saml_metadata_url, push_notification_url, created_at)
VALUES
  (
    'urn:gov:gsa:openidconnect.profiles:sp:sso:agency:test-app',
    'Test Agency App',
    2, 2,
    '["http://localhost:3000/auth/callback","https://test-app.agency.gov/auth/callback"]',
    '-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0Z3VS5JJcds3xfn/ygWe\nGGEFMEBEk1dBFOKaKfmVkLBtwpFjGRsKMOv3JFN9Ql9V9dx7aBYFvf8nIWjDHHH\nWAZGHGcHvIMPMnNvOsFq6HkZiUhA3GHvOJAKk3UVV7xjz7R9KkMmGfBiTkr9W3T\nvUQIOdfJy4FP4Ie6OChQcBPnFC5HH1OFgGJxCfN0aN7VMYiB1JfG6d5ORpFG4Wsh\ntest-key-placeholder\n-----END PUBLIC KEY-----',
    NULL,
    'http://localhost:3000/api/risc/events',
    '2025-01-01T00:00:00.000Z'
  ),
  (
    'urn:gov:gsa:openidconnect.profiles:sp:sso:agency:saml-app',
    'Test SAML Agency',
    1, 1,
    '["https://saml-app.agency.gov/saml/acs"]',
    '-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0Z3VS5JJcds3xfn/ygWe\ntest-saml-key-placeholder\n-----END PUBLIC KEY-----',
    'https://saml-app.agency.gov/saml/metadata',
    NULL,
    '2025-01-01T00:00:00.000Z'
  );

-- Demo SP used by the /demo page's OIDC test flow.
-- The public key here is a static test key — the demo page's /demo/seed-sp
-- endpoint generates a fresh key pair at runtime and will overwrite this if called.
-- This entry ensures /authorize works immediately after seeding without hitting seed-sp.
INSERT INTO service_providers (id, name, ial_max, aal_max, redirect_uris, public_key, saml_metadata_url, push_notification_url, post_logout_redirect_uris, created_at)
VALUES
  (
    'urn:gov:gsa:openidconnect.profiles:sp:sso:example:app',
    'Example Demo App',
    2, 2,
    '["https://example.gov/auth/callback","http://localhost:3000/auth/callback"]',
    '-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0Z3VS5JJcds3xfn/ygWe\ndemo-placeholder-key\n-----END PUBLIC KEY-----',
    NULL,
    NULL,
    '["https://example.gov","http://localhost:3000"]',
    '2025-01-01T00:00:00.000Z'
  );

-- Test users (passwords will be set via Better Auth in actual dev)
-- email_blind_index values are SHA-256 hashes of the email with test key, for dev/test only
INSERT INTO users (id, email, email_blind_index, email_verified_at, ial, locked_at, locale, ssn, birthdate, address, phone, verified_at, created_at, updated_at)
VALUES
  (
    '01950000-0000-7000-8000-000000000001',
    'testuser@example.gov',
    'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
    '2025-01-01T00:00:00.000Z',
    1,
    NULL,
    'en',
    NULL, NULL, NULL, NULL, NULL,
    '2025-01-01T00:00:00.000Z',
    '2025-01-01T00:00:00.000Z'
  ),
  (
    '01950000-0000-7000-8000-000000000002',
    'verified@example.gov',
    'b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3',
    '2025-01-01T00:00:00.000Z',
    2,
    NULL,
    'en',
    NULL, NULL, NULL, NULL,
    '2025-06-01T00:00:00.000Z',
    '2025-01-01T00:00:00.000Z',
    '2025-06-01T00:00:00.000Z'
  );

-- Test user emails
INSERT INTO user_emails (id, user_id, address, is_primary, verified_at, created_at)
VALUES
  (
    '01950000-0000-7000-8000-000000000010',
    '01950000-0000-7000-8000-000000000001',
    'testuser@example.gov',
    1,
    '2025-01-01T00:00:00.000Z',
    '2025-01-01T00:00:00.000Z'
  ),
  (
    '01950000-0000-7000-8000-000000000011',
    '01950000-0000-7000-8000-000000000002',
    'verified@example.gov',
    1,
    '2025-01-01T00:00:00.000Z',
    '2025-01-01T00:00:00.000Z'
  );
