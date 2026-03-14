/**
 * Pairwise subject identifier helper.
 * Wraps computePairwiseSub from @logingov/shared/crypto for use in auth flows.
 */
import { computePairwiseSub } from "@logingov/shared";
import type { Env } from "@logingov/shared";

/**
 * Compute a pairwise subject identifier for a user + service provider.
 * Uses HMAC-SHA256(PAIRWISE_SALT, userId + spId) so each SP sees a unique sub.
 */
export async function getPairwiseSub(
  userId: string,
  spId: string,
  env: Env
): Promise<string> {
  return computePairwiseSub(userId, spId, env.PAIRWISE_SALT);
}
