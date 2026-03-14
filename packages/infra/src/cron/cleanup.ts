/**
 * Cleanup cron — runs every 5 minutes.
 *
 * Removes expired auth codes and stale rate-limit entries.
 * Session cleanup is handled by SessionDO alarms, so this focuses on
 * table rows that outlive their usefulness.
 */

import { getDb } from "@logingov/shared/db";
import { lt } from "drizzle-orm";
import type { Env } from "@logingov/shared";
import { authCodes } from "@logingov/shared";

/**
 * Delete auth_codes where expires_at < now and used_at is not null (already consumed)
 * or expires_at < now (expired unused).
 */
export async function handleCleanup(env: Env): Promise<void> {
  const db = getDb(env);
  const now = new Date().toISOString();

  // Delete expired auth codes (both used and unused)
  const result = await db.delete(authCodes).where(lt(authCodes.expiresAt, now));

  // Log for observability — the structured logger will capture this
  console.log(
    JSON.stringify({
      level: "info",
      message: "Cleanup cron completed",
      timestamp: now,
    })
  );
}
