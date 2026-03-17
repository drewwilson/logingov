-- Link service providers to their parent agency
ALTER TABLE service_providers ADD COLUMN agency_id VARCHAR(36);
CREATE INDEX service_providers_agency_id_idx ON service_providers(agency_id);
