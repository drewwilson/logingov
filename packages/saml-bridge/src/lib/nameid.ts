/**
 * SAML NameID generation using pairwise subject identifiers.
 *
 * Converts the HMAC-SHA256 hex digest from computePairwiseSub into a
 * UUID v5-style format (deterministic, reproducible per user+SP pair).
 */
import { computePairwiseSub } from "@logingov/shared/crypto";

/**
 * Generate a pairwise NameID in UUID format for a given user + SP.
 * The result is a deterministic UUID derived from HMAC-SHA256(salt, userId + spEntityId).
 */
export async function generateNameID(
  userId: string,
  spEntityId: string,
  pairwiseSalt: string
): Promise<string> {
  const hex = await computePairwiseSub(userId, spEntityId, pairwiseSalt);

  // Format the first 32 hex chars as a UUID (8-4-4-4-12)
  // Set version nibble to 5 (name-based SHA) and variant to 10xx
  const uuid = [
    hex.slice(0, 8),
    hex.slice(8, 12),
    // Version: replace first nibble with '5'
    "5" + hex.slice(13, 16),
    // Variant: replace first nibble with '8'-'b' range
    ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16) + hex.slice(17, 20),
    hex.slice(20, 32),
  ].join("-");

  return uuid;
}
