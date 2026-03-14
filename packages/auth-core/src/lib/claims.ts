/**
 * Build user claims based on requested scopes.
 * Decrypts PII fields as needed.
 */
import { SCOPE_ATTRIBUTES, importKey, decrypt } from "@logingov/shared";
import type { Env, User, OIDCScope } from "@logingov/shared";

export interface UserClaims {
  sub: string;
  [key: string]: unknown;
}

/**
 * Build claims for a user filtered by the requested scopes.
 * Decrypts encrypted PII fields using the ENCRYPTION_KEY.
 */
export async function buildUserClaims(
  user: User,
  sub: string,
  scopes: string[],
  env: Env
): Promise<UserClaims> {
  const claims: UserClaims = { sub };

  // Collect all allowed attributes from scopes
  const allowedAttributes = new Set<string>();
  for (const scope of scopes) {
    const attrs = SCOPE_ATTRIBUTES[scope as OIDCScope];
    if (attrs) {
      for (const attr of attrs) {
        allowedAttributes.add(attr);
      }
    }
  }

  const encKey = await importKey(env.ENCRYPTION_KEY);

  // Map attributes to user fields, decrypting as necessary
  if (allowedAttributes.has("email")) {
    try {
      claims.email = await decrypt(user.email, encKey);
    } catch {
      claims.email = user.email; // fallback if not yet encrypted (migration)
    }
    claims.email_verified = user.emailVerifiedAt !== null;
  }

  if (allowedAttributes.has("given_name") || allowedAttributes.has("family_name")) {
    // Names are stored as encrypted JSON in the address field structure
    // For profile scope, names would need a dedicated encrypted field
    // For now, these come from a profile data structure if available
  }

  if (allowedAttributes.has("phone") && user.phone) {
    try {
      claims.phone = await decrypt(user.phone, encKey);
      claims.phone_verified = true;
    } catch {
      // If decryption fails, omit the claim
    }
  }

  if (allowedAttributes.has("birthdate") && user.birthdate) {
    try {
      claims.birthdate = await decrypt(user.birthdate, encKey);
    } catch {
      // omit on failure
    }
  }

  if (allowedAttributes.has("social_security_number") && user.ssn) {
    try {
      claims.social_security_number = await decrypt(user.ssn, encKey);
    } catch {
      // omit on failure
    }
  }

  if (allowedAttributes.has("address") && user.address) {
    try {
      const decrypted = await decrypt(user.address, encKey);
      claims.address = JSON.parse(decrypted);
    } catch {
      // omit on failure
    }
  }

  if (allowedAttributes.has("verified_at") && user.verifiedAt) {
    claims.verified_at = user.verifiedAt;
  }

  if (allowedAttributes.has("ial")) {
    claims.ial = user.ial;
  }

  if (allowedAttributes.has("aal")) {
    // AAL is determined by the authentication event, not the user record
    // Default to 1 for userinfo
    claims.aal = 1;
  }

  if (allowedAttributes.has("locale")) {
    claims.locale = user.locale;
  }

  return claims;
}
