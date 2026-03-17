-- Widen logo and theme columns to MEDIUMTEXT to support large inline SVGs
ALTER TABLE agencies MODIFY COLUMN logo MEDIUMTEXT;
ALTER TABLE service_providers MODIFY COLUMN theme MEDIUMTEXT;
