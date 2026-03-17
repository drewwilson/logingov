/**
 * Agency registration schema — isolated from user/auth tables.
 * Only this file should be imported by the agency-admin package.
 */
import { mysqlTable, varchar, text, int, index } from "drizzle-orm/mysql-core";

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
    logo: text("logo"),
    publicCertificate: text("public_certificate"),
    status: varchar("status", { length: 20 }).notNull().default("draft"),
    themeConfig: text("theme_config"),
    createdAt: varchar("created_at", { length: 30 }).notNull(),
    updatedAt: varchar("updated_at", { length: 30 }).notNull(),
  },
  (table) => [index("agencies_status_idx").on(table.status)]
);
