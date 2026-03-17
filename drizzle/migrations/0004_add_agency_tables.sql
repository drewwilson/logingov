-- Agency registration table (managed by local-only agency-admin dashboard)
CREATE TABLE IF NOT EXISTS agencies (
  id VARCHAR(36) PRIMARY KEY,
  iaa_name VARCHAR(255) NOT NULL,
  friendly_name VARCHAR(255) NOT NULL,
  abbreviation VARCHAR(50),
  description TEXT,
  website_url VARCHAR(500),
  protocol VARCHAR(10) NOT NULL DEFAULT 'oidc',
  ial INT NOT NULL DEFAULT 1,
  default_aal INT NOT NULL DEFAULT 1,
  logo TEXT,
  public_certificate TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'draft',
  theme_config TEXT,
  created_at VARCHAR(30) NOT NULL,
  updated_at VARCHAR(30) NOT NULL
);

CREATE INDEX agencies_status_idx ON agencies(status);
