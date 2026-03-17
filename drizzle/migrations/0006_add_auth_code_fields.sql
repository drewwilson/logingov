-- Add ial, aal, and acr columns to auth_codes (match Drizzle schema)
ALTER TABLE auth_codes ADD COLUMN ial INT NOT NULL DEFAULT 1;
ALTER TABLE auth_codes ADD COLUMN aal INT NOT NULL DEFAULT 1;
ALTER TABLE auth_codes ADD COLUMN acr VARCHAR(100) NOT NULL DEFAULT 'urn:acr.login.gov:auth-only';
