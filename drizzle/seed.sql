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

-- Test users (passwords will be set via Better Auth in actual dev)
INSERT INTO users (id, email, email_verified_at, ial, locked_at, locale, ssn, birthdate, address, phone, verified_at, created_at, updated_at)
VALUES
  (
    '01950000-0000-7000-8000-000000000001',
    'testuser@example.gov',
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
