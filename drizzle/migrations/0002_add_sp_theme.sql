-- Add theme column for hosted sign-in page customization per service provider
ALTER TABLE service_providers ADD COLUMN theme TEXT;
