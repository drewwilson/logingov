import { getDb } from "@logingov/shared/db";
import { eq } from "drizzle-orm";
import { serviceProviders, agencies } from "@logingov/shared";
import type { Env } from "@logingov/shared";

interface SPWithTheme {
  id: string;
  name: string;
  theme: string | null;
}

/**
 * Minimal SP lookup — only fetches the fields needed for theming.
 */
export async function lookupServiceProvider(
  spId: string,
  env: Env
): Promise<SPWithTheme | null> {
  const db = getDb(env);
  const rows = await db
    .select({
      id: serviceProviders.id,
      name: serviceProviders.name,
      theme: serviceProviders.theme,
    })
    .from(serviceProviders)
    .where(eq(serviceProviders.id, spId))
    .limit(1);

  if (rows.length === 0) return null;
  return rows[0];
}

/**
 * Look up an agency by ID and return its theme for preview purposes.
 */
export async function lookupAgencyTheme(
  agencyId: string,
  env: Env
): Promise<{ theme: string | null; friendlyName: string } | null> {
  const db = getDb(env);
  const rows = await db
    .select({
      themeConfig: agencies.themeConfig,
      friendlyName: agencies.friendlyName,
      logo: agencies.logo,
    })
    .from(agencies)
    .where(eq(agencies.id, agencyId))
    .limit(1);

  if (rows.length === 0) return null;

  const row = rows[0];

  if (row.themeConfig) {
    try {
      const parsed = JSON.parse(row.themeConfig);
      if (!parsed.agencyName) parsed.agencyName = row.friendlyName;
      if (!parsed.logo && row.logo) parsed.logo = row.logo;
      return { theme: JSON.stringify(parsed), friendlyName: row.friendlyName };
    } catch {}
  }

  // No theme_config JSON — build a minimal one from agency fields
  const minimal: Record<string, unknown> = { agencyName: row.friendlyName };
  if (row.logo) minimal.logo = row.logo;
  return { theme: JSON.stringify(minimal), friendlyName: row.friendlyName };
}
