-- Migration: Encrypt email field at rest (SOC II P1-P8 compliance)
--
-- Changes:
--   1. Convert email column from VARCHAR(255) to TEXT (encrypted blobs vary in length)
--   2. Make email_blind_index NOT NULL and UNIQUE (required for lookups on encrypted email)
--   3. Drop the unique constraint on email (plaintext uniqueness replaced by blind index uniqueness)
--
-- IMPORTANT: Before running this migration:
--   1. Run the ETL script to encrypt all existing email values and populate email_blind_index
--   2. Verify all rows have a non-null email_blind_index
--   3. Then apply this migration to enforce the NOT NULL + UNIQUE constraints
--
-- Rollback: see 0002_encrypt_email_rollback.sql

-- Step 1: Drop the old unique index on plaintext email
ALTER TABLE `users` DROP INDEX `users_email_unique`;

-- Step 2: Change email column to TEXT (encrypted blobs are longer than 255 chars)
ALTER TABLE `users` MODIFY COLUMN `email` TEXT NOT NULL;

-- Step 3: Make email_blind_index NOT NULL (must be populated before this runs)
ALTER TABLE `users` MODIFY COLUMN `email_blind_index` VARCHAR(64) NOT NULL;

-- Step 4: Add unique index on email_blind_index
ALTER TABLE `users` ADD UNIQUE INDEX `users_email_blind_index_unique` (`email_blind_index`);
