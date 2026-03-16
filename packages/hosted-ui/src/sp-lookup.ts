import { getDb } from "@logingov/shared/db";
import { eq } from "drizzle-orm";
import { serviceProviders } from "@logingov/shared";
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
