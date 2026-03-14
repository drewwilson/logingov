/**
 * PKCE (Proof Key for Code Exchange) utilities.
 * Supports S256 code challenge method per RFC 7636.
 */
import { AppError } from "@logingov/shared";

/**
 * Verify a PKCE code_verifier against a stored code_challenge.
 * Only S256 method is supported (plain is insecure and not allowed).
 */
export async function verifyCodeChallenge(
  codeVerifier: string,
  codeChallenge: string,
  codeChallengeMethod: string
): Promise<void> {
  if (codeChallengeMethod !== "S256") {
    throw new AppError(
      "invalid_request",
      "Only S256 code_challenge_method is supported",
      400
    );
  }

  const computed = await computeS256Challenge(codeVerifier);

  // Constant-time comparison to prevent timing attacks
  const encoder = new TextEncoder();
  const a = encoder.encode(computed);
  const b = encoder.encode(codeChallenge);
  if (a.byteLength !== b.byteLength || !crypto.subtle.timingSafeEqual(a, b)) {
    throw new AppError(
      "invalid_grant",
      "code_verifier does not match code_challenge",
      400
    );
  }
}

/**
 * Compute S256 code challenge: BASE64URL(SHA256(code_verifier)).
 */
export async function computeS256Challenge(codeVerifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(codeVerifier)
  );
  return base64urlEncode(new Uint8Array(digest));
}

/**
 * Validate code_verifier format per RFC 7636:
 * 43-128 characters, [A-Z] / [a-z] / [0-9] / "-" / "." / "_" / "~"
 */
export function validateCodeVerifier(codeVerifier: string): boolean {
  if (codeVerifier.length < 43 || codeVerifier.length > 128) {
    return false;
  }
  return /^[A-Za-z0-9\-._~]+$/.test(codeVerifier);
}

/**
 * Validate code_challenge format: BASE64URL string.
 */
export function validateCodeChallenge(codeChallenge: string): boolean {
  return /^[A-Za-z0-9\-_]+$/.test(codeChallenge) && codeChallenge.length > 0;
}

function base64urlEncode(buffer: Uint8Array): string {
  let binary = "";
  for (const byte of buffer) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
