/**
 * Pairwise subject identifier helper.
 * Wraps computePairwiseSub from @logingov/shared/crypto for use in auth flows.
 *
 * For migrated users (those with a legacy_uuid from the old Rails system),
 * uses the legacy computation to preserve the same sub values agencies already have.
 * For new users, uses the standard HMAC-SHA256 computation.
 */
import { computePairwiseSub, computeLegacyPairwiseSub } from "@logingov/shared";
import type { Env } from "@logingov/shared";

/**
 * Compute a pairwise subject identifier for a user + service provider.
 *
 * @param userId - The new UUID v7 user ID
 * @param spId - The service provider's issuer URI
 * @param env - Worker environment bindings
 * @param legacyUuid - The old Rails UUID (if this is a migrated user)
 */
export async function getPairwiseSub(
  userId: string,
  spId: string,
  env: Env,
  legacyUuid?: string | null
): Promise<string> {
  // Migrated users: replicate the old Rails SHA-256 computation so agencies
  // continue to see the same sub they've stored in their databases.
  if (legacyUuid && env.LEGACY_PAIRWISE_SALT) {
    return computeLegacyPairwiseSub(legacyUuid, spId, env.LEGACY_PAIRWISE_SALT);
  }

  // New users: standard HMAC-SHA256 computation
  return computePairwiseSub(userId, spId, env.PAIRWISE_SALT);
}
