-- Add idToken column for social login (Better Auth stores OIDC id_tokens here)
ALTER TABLE `account` ADD COLUMN idToken TEXT;
