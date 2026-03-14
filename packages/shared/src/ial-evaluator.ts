/**
 * Shared IAL Evaluator
 *
 * Pure function that compares a user's current IAL against a requested IAL.
 * Used by auth-core, identity-proofing, and SAML bridge to determine
 * whether a user needs to complete identity proofing.
 */
import type { IALLevel } from "./types/index.js";

export interface IALEvaluationResult {
  /** Whether the user's IAL meets or exceeds the requested IAL */
  allowed: boolean;
  /** Whether the user needs to go through identity proofing */
  needsProofing: boolean;
}

/**
 * Evaluate whether a user's current IAL satisfies the requested IAL.
 *
 * @param userIal - The user's current IAL level (1 or 2)
 * @param requestedIal - The IAL level requested by the service provider
 * @returns An object indicating whether the user is allowed and whether proofing is needed
 */
export function evaluateIAL(userIal: IALLevel, requestedIal: IALLevel): IALEvaluationResult {
  const allowed = userIal >= requestedIal;
  const needsProofing = userIal < requestedIal;

  return { allowed, needsProofing };
}
