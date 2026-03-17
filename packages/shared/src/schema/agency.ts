/**
 * Agency registration schema — isolated from user/auth tables.
 * Only this file should be imported by the agency-admin package.
 *
 * Includes the service_providers table so agency-admin can create
 * the full OIDC registration in one step.
 */
import { mysqlTable, varchar, text, mediumtext, int, index } from "drizzle-orm/mysql-core";

export const agencies = mysqlTable(
  "agencies",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    iaaName: varchar("iaa_name", { length: 255 }).notNull(),
    friendlyName: varchar("friendly_name", { length: 255 }).notNull(),
    abbreviation: varchar("abbreviation", { length: 50 }),
    description: text("description"),
    websiteUrl: varchar("website_url", { length: 500 }),
    protocol: varchar("protocol", { length: 10 }).notNull().default("oidc"),
    ial: int("ial").notNull().default(1),
    defaultAal: int("default_aal").notNull().default(1),
    logo: mediumtext("logo"),
    publicCertificate: text("public_certificate"),
    status: varchar("status", { length: 20 }).notNull().default("draft"),
    themeConfig: text("theme_config"),
    createdAt: varchar("created_at", { length: 30 }).notNull(),
    updatedAt: varchar("updated_at", { length: 30 }).notNull(),
  },
  (table) => [index("agencies_status_idx").on(table.status)]
);

export const serviceProviders = mysqlTable(
  "service_providers",
  {
    id: varchar("id", { length: 255 }).primaryKey(),
    agencyId: varchar("agency_id", { length: 36 }),
    name: varchar("name", { length: 255 }).notNull(),
    ialMax: int("ial_max").notNull().default(1),
    aalMax: int("aal_max").notNull().default(1),
    redirectUris: text("redirect_uris").notNull(),
    publicKey: text("public_key").notNull(),
    samlMetadataUrl: text("saml_metadata_url"),
    pushNotificationUrl: text("push_notification_url"),
    postLogoutRedirectUris: text("post_logout_redirect_uris"),
    theme: mediumtext("theme"),
    createdAt: varchar("created_at", { length: 30 }).notNull(),
  },
  (table) => [index("service_providers_agency_id_idx").on(table.agencyId)]
);
