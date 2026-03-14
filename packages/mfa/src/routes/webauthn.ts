/**
 * WebAuthn / Passkeys Routes
 *
 * POST /mfa/webauthn/register/options   — Generate registration options
 * POST /mfa/webauthn/register/verify    — Verify registration and store credential
 * POST /mfa/webauthn/authenticate/options — Generate authentication options
 * POST /mfa/webauthn/authenticate/verify  — Verify authentication assertion
 *
 * Uses the Web Authentication API (WebAuthn L2) with:
 *   rpID = "login.gov"
 *   origin = "https://secure.login.gov"
 *
 * Credential public keys are stored encrypted in the credentials table.
 */
import { Hono } from "hono";
import type { Env } from "@logingov/shared";
import { uuidV7, encrypt, decrypt, importKey } from "@logingov/shared";
import { credentials } from "@logingov/shared";
import { eq, and } from "drizzle-orm";
import { getDb } from "@logingov/shared/db";
import { loadSession, updateSessionDO } from "../middleware/aal-evaluator.js";
import { checkMfaRateLimit, recordFailedAttempt, clearRateLimit } from "../middleware/rate-limiter.js";
import { kvGet, kvPut, kvDelete, KV_KEYS, KV_TTL } from "@logingov/shared";

const webauthn = new Hono<{ Bindings: Env }>();

// ── WebAuthn Configuration ───────────────────────────────────

const RP_ID = "login.gov";
const RP_NAME = "Login.gov";
const RP_ORIGIN = "https://secure.login.gov";

// Challenge TTL in KV: 5 minutes
const CHALLENGE_TTL = 5 * 60;

interface StoredWebAuthnCredential {
  credentialId: string; // base64url
  publicKey: string; // base64url-encoded COSE public key
  signCount: number;
  transports?: string[];
  createdAt: string;
  aaguid?: string;
  userVerified: boolean;
}

interface WebAuthnChallenge {
  challenge: string; // base64url
  userId: string;
  type: "registration" | "authentication";
  createdAt: string;
}

// ── Registration: Generate Options ───────────────────────────

webauthn.post("/register/options", loadSession(), async (c) => {
  const userId = c.req.header("X-User-Id");
  if (!userId) return c.json({ error: "missing_user_id" }, 400);

  const email = c.req.header("X-User-Email") ?? "user@login.gov";

  // Generate challenge
  const challengeBytes = crypto.getRandomValues(new Uint8Array(32));
  const challenge = base64urlEncode(challengeBytes);

  // Store challenge in KV for later verification
  const challengeKey = KV_KEYS.otp(userId, "webauthn_register");
  await kvPut<WebAuthnChallenge>(
    c.env.KV_OTP,
    challengeKey,
    { challenge, userId, type: "registration", createdAt: new Date().toISOString() },
    CHALLENGE_TTL
  );

  // Get existing credentials for excludeCredentials
  const db = getDb(c.env);
  const existingCreds = await db
    .select()
    .from(credentials)
    .where(and(eq(credentials.userId, userId), eq(credentials.type, "webauthn")));

  const cryptoKey = await importKey(c.env.ENCRYPTION_KEY);
  const excludeCredentials = await Promise.all(
    existingCreds.map(async (cred) => {
      const data = JSON.parse(await decrypt(cred.data, cryptoKey)) as StoredWebAuthnCredential;
      return {
        type: "public-key" as const,
        id: data.credentialId,
        transports: data.transports ?? [],
      };
    })
  );

  // Return PublicKeyCredentialCreationOptions
  const options = {
    rp: {
      id: RP_ID,
      name: RP_NAME,
    },
    user: {
      id: base64urlEncode(new TextEncoder().encode(userId)),
      name: email,
      displayName: email.split("@")[0],
    },
    challenge,
    pubKeyCredParams: [
      { type: "public-key", alg: -7 },   // ES256 (preferred)
      { type: "public-key", alg: -257 },  // RS256 (fallback)
    ],
    timeout: 300000, // 5 minutes
    authenticatorSelection: {
      authenticatorAttachment: "cross-platform", // allow security keys and platform authenticators
      residentKey: "preferred",
      userVerification: "preferred",
    },
    attestation: "none", // privacy-preserving — we don't need attestation for login.gov
    excludeCredentials,
  };

  return c.json({ options });
});

// ── Registration: Verify and Store ───────────────────────────

webauthn.post("/register/verify", loadSession(), async (c) => {
  const userId = c.req.header("X-User-Id");
  if (!userId) return c.json({ error: "missing_user_id" }, 400);

  const body = await c.req.json<{
    id: string;           // base64url credential ID
    rawId: string;        // base64url
    type: string;         // "public-key"
    response: {
      clientDataJSON: string;    // base64url
      attestationObject: string; // base64url
    };
    transports?: string[];
  }>();

  // Retrieve stored challenge
  const challengeKey = KV_KEYS.otp(userId, "webauthn_register");
  const storedChallenge = await kvGet<WebAuthnChallenge>(c.env.KV_OTP, challengeKey);

  if (!storedChallenge) {
    return c.json({ error: "challenge_expired", message: "Registration challenge has expired" }, 410);
  }

  // Delete challenge (single-use)
  await kvDelete(c.env.KV_OTP, challengeKey);

  // Parse clientDataJSON
  const clientDataJSON = JSON.parse(
    new TextDecoder().decode(base64urlDecode(body.response.clientDataJSON))
  ) as {
    type: string;
    challenge: string;
    origin: string;
  };

  // Verify clientDataJSON fields
  if (clientDataJSON.type !== "webauthn.create") {
    return c.json({ error: "invalid_type", message: "Expected webauthn.create" }, 400);
  }

  if (clientDataJSON.challenge !== storedChallenge.challenge) {
    return c.json({ error: "challenge_mismatch", message: "Challenge does not match" }, 400);
  }

  if (clientDataJSON.origin !== RP_ORIGIN) {
    return c.json({ error: "origin_mismatch", message: "Origin does not match" }, 400);
  }

  // Parse attestationObject to extract the COSE public key
  const attestationBytes = base64urlDecode(body.response.attestationObject);
  const attestation = decodeCborMap(attestationBytes);
  const authData = attestation.get("authData");
  if (!(authData instanceof Uint8Array)) {
    return c.json({ error: "invalid_attestation", message: "Missing authData in attestation object" }, 400);
  }

  // authData layout: rpIdHash (32) + flags (1) + signCount (4) + attestedCredentialData (if AT flag set)
  const regFlags = authData[32];
  const atPresent = (regFlags & 0x40) !== 0; // AT flag = bit 6
  if (!atPresent) {
    return c.json({ error: "invalid_attestation", message: "Attested credential data not present" }, 400);
  }

  // Extract attested credential data starting at byte 37
  // aaguid (16) + credentialIdLength (2) + credentialId (variable) + COSE public key (CBOR)
  const aaguid = base64urlEncode(authData.slice(37, 53));
  const credIdLen = (authData[53] << 8) | authData[54];
  const credId = authData.slice(55, 55 + credIdLen);
  const coseKeyBytes = authData.slice(55 + credIdLen);

  // Parse the COSE public key and convert to JWK
  const coseKeyMap = decodeCborMap(coseKeyBytes);
  const publicKeyJwk = coseKeyToJwk(coseKeyMap);
  if (!publicKeyJwk) {
    return c.json({ error: "unsupported_key", message: "Unsupported COSE key algorithm. Only ES256 and RS256 are supported." }, 400);
  }

  const credentialData: StoredWebAuthnCredential = {
    credentialId: body.id,
    publicKey: base64urlEncode(new TextEncoder().encode(JSON.stringify(publicKeyJwk))),
    signCount: 0,
    transports: body.transports,
    createdAt: new Date().toISOString(),
    aaguid,
    userVerified: (regFlags & 0x04) !== 0,
  };

  // Encrypt and store credential
  const cryptoKey = await importKey(c.env.ENCRYPTION_KEY);
  const encryptedData = await encrypt(JSON.stringify(credentialData), cryptoKey);

  const db = getDb(c.env);
  await db.insert(credentials).values({
    id: uuidV7(),
    userId,
    type: "webauthn",
    data: encryptedData,
    createdAt: new Date().toISOString(),
  });

  return c.json({ ok: true, credential_id: body.id });
});

// ── Authentication: Generate Options ─────────────────────────

webauthn.post("/authenticate/options", loadSession(), async (c) => {
  const userId = c.req.header("X-User-Id");
  if (!userId) return c.json({ error: "missing_user_id" }, 400);

  // Generate challenge
  const challengeBytes = crypto.getRandomValues(new Uint8Array(32));
  const challenge = base64urlEncode(challengeBytes);

  // Store challenge
  const challengeKey = KV_KEYS.otp(userId, "webauthn_auth");
  await kvPut<WebAuthnChallenge>(
    c.env.KV_OTP,
    challengeKey,
    { challenge, userId, type: "authentication", createdAt: new Date().toISOString() },
    CHALLENGE_TTL
  );

  // Get user's registered credentials
  const db = getDb(c.env);
  const userCreds = await db
    .select()
    .from(credentials)
    .where(and(eq(credentials.userId, userId), eq(credentials.type, "webauthn")));

  if (userCreds.length === 0) {
    return c.json({ error: "no_credentials", message: "No WebAuthn credentials registered" }, 404);
  }

  const cryptoKey = await importKey(c.env.ENCRYPTION_KEY);
  const allowCredentials = await Promise.all(
    userCreds.map(async (cred) => {
      const data = JSON.parse(await decrypt(cred.data, cryptoKey)) as StoredWebAuthnCredential;
      return {
        type: "public-key" as const,
        id: data.credentialId,
        transports: data.transports ?? [],
      };
    })
  );

  const options = {
    challenge,
    rpId: RP_ID,
    timeout: 300000,
    allowCredentials,
    userVerification: "preferred",
  };

  return c.json({ options });
});

// ── Authentication: Verify Assertion ─────────────────────────

webauthn.post("/authenticate/verify", loadSession(), checkMfaRateLimit(), async (c) => {
  const userId = c.get("userId" as never) as string;
  const sessionId = c.get("sessionId" as never) as string;

  const body = await c.req.json<{
    id: string;
    rawId: string;
    type: string;
    response: {
      clientDataJSON: string;
      authenticatorData: string;
      signature: string;
      userHandle?: string;
    };
    remember_device?: boolean;
  }>();

  // Retrieve stored challenge
  const challengeKey = KV_KEYS.otp(userId, "webauthn_auth");
  const storedChallenge = await kvGet<WebAuthnChallenge>(c.env.KV_OTP, challengeKey);

  if (!storedChallenge) {
    return c.json({ error: "challenge_expired", message: "Authentication challenge has expired" }, 410);
  }

  await kvDelete(c.env.KV_OTP, challengeKey);

  // Parse and verify clientDataJSON
  const clientDataJSON = JSON.parse(
    new TextDecoder().decode(base64urlDecode(body.response.clientDataJSON))
  ) as {
    type: string;
    challenge: string;
    origin: string;
  };

  if (clientDataJSON.type !== "webauthn.get") {
    return c.json({ error: "invalid_type", message: "Expected webauthn.get" }, 400);
  }

  if (clientDataJSON.challenge !== storedChallenge.challenge) {
    const attempts = await recordFailedAttempt(c.env, userId);
    return c.json(
      { error: "challenge_mismatch", message: "Challenge does not match", attempts_remaining: Math.max(0, 5 - attempts) },
      401
    );
  }

  if (clientDataJSON.origin !== RP_ORIGIN) {
    const attempts = await recordFailedAttempt(c.env, userId);
    return c.json(
      { error: "origin_mismatch", message: "Origin does not match", attempts_remaining: Math.max(0, 5 - attempts) },
      401
    );
  }

  // Find matching credential
  const db = getDb(c.env);
  const userCreds = await db
    .select()
    .from(credentials)
    .where(and(eq(credentials.userId, userId), eq(credentials.type, "webauthn")));

  const cryptoKey = await importKey(c.env.ENCRYPTION_KEY);
  let matchedCred: (typeof userCreds)[0] | null = null;
  let matchedData: StoredWebAuthnCredential | null = null;

  for (const cred of userCreds) {
    const data = JSON.parse(await decrypt(cred.data, cryptoKey)) as StoredWebAuthnCredential;
    if (data.credentialId === body.id) {
      matchedCred = cred;
      matchedData = data;
      break;
    }
  }

  if (!matchedCred || !matchedData) {
    const attempts = await recordFailedAttempt(c.env, userId);
    return c.json(
      { error: "credential_not_found", message: "Unknown credential", attempts_remaining: Math.max(0, 5 - attempts) },
      401
    );
  }

  // Verify authenticator data — check RP ID hash and flags
  const authData = base64urlDecode(body.response.authenticatorData);
  const rpIdHash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(RP_ID)));

  // First 32 bytes = RP ID hash
  const receivedRpIdHash = authData.slice(0, 32);
  if (!arrayEqual(rpIdHash, receivedRpIdHash)) {
    const attempts = await recordFailedAttempt(c.env, userId);
    return c.json(
      { error: "rp_id_mismatch", message: "RP ID hash mismatch", attempts_remaining: Math.max(0, 5 - attempts) },
      401
    );
  }

  // Flags byte (byte 32): bit 0 = UP (user present), bit 2 = UV (user verified)
  const flags = authData[32];
  const userPresent = (flags & 0x01) !== 0;
  if (!userPresent) {
    const attempts = await recordFailedAttempt(c.env, userId);
    return c.json(
      { error: "user_not_present", message: "User presence flag not set", attempts_remaining: Math.max(0, 5 - attempts) },
      401
    );
  }

  // Update sign counter (bytes 33-36, big-endian)
  const signCountView = new DataView(authData.buffer, authData.byteOffset + 33, 4);
  const newSignCount = signCountView.getUint32(0, false);

  if (newSignCount > 0 && newSignCount <= matchedData.signCount) {
    // Possible cloned authenticator
    const attempts = await recordFailedAttempt(c.env, userId);
    return c.json(
      {
        error: "sign_count_regression",
        message: "Authenticator sign count indicates possible cloning",
        attempts_remaining: Math.max(0, 5 - attempts),
      },
      401
    );
  }

  // ── Verify the cryptographic signature against the stored public key ──
  const publicKeyJwkStored = JSON.parse(
    new TextDecoder().decode(base64urlDecode(matchedData.publicKey))
  ) as JsonWebKey & { alg?: string };

  // Determine algorithm from stored JWK
  const importAlg = publicKeyJwkStored.alg === "RS256"
    ? { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" } as const
    : { name: "ECDSA", namedCurve: "P-256" } as const;

  const verifyAlg = publicKeyJwkStored.alg === "RS256"
    ? { name: "RSASSA-PKCS1-v1_5" } as const
    : { name: "ECDSA", hash: "SHA-256" } as const;

  let verifyKey: CryptoKey;
  try {
    verifyKey = await crypto.subtle.importKey("jwk", publicKeyJwkStored, importAlg, false, ["verify"]);
  } catch {
    const attempts = await recordFailedAttempt(c.env, userId);
    return c.json(
      { error: "key_import_failed", message: "Failed to import stored public key", attempts_remaining: Math.max(0, 5 - attempts) },
      401
    );
  }

  // Signed data = authenticatorData || SHA-256(clientDataJSON)
  const clientDataHash = new Uint8Array(
    await crypto.subtle.digest("SHA-256", base64urlDecode(body.response.clientDataJSON))
  );
  const signedData = new Uint8Array(authData.length + clientDataHash.length);
  signedData.set(authData, 0);
  signedData.set(clientDataHash, authData.length);

  const signatureBytes = base64urlDecode(body.response.signature);
  const signatureValid = await crypto.subtle.verify(verifyAlg, verifyKey, signatureBytes, signedData);

  if (!signatureValid) {
    const attempts = await recordFailedAttempt(c.env, userId);
    return c.json(
      { error: "signature_invalid", message: "WebAuthn signature verification failed", attempts_remaining: Math.max(0, 5 - attempts) },
      401
    );
  }

  // Success — update credential sign count and last used
  matchedData.signCount = newSignCount;
  const updatedEncrypted = await encrypt(JSON.stringify(matchedData), cryptoKey);

  await db
    .update(credentials)
    .set({ data: updatedEncrypted, lastUsedAt: new Date().toISOString() })
    .where(eq(credentials.id, matchedCred.id));

  await clearRateLimit(c.env, userId);

  // Mark session as MFA-verified (with optional device remembering)
  await updateSessionDO(c.env, sessionId, {
    mfaVerified: true,
    mfaMethod: "webauthn",
    achievedAal: 2,
    ...(body.remember_device ? { rememberedDevice: true } : {}),
  });

  return c.json({ ok: true, method: "webauthn", remembered: !!body.remember_device });
});

// ── Minimal CBOR Decoder ─────────────────────────────────────

/**
 * Minimal CBOR decoder sufficient for parsing WebAuthn attestation objects
 * and COSE public keys. Supports maps, byte strings, text strings, integers,
 * and negative integers.
 */
function decodeCborMap(data: Uint8Array): Map<string | number, unknown> {
  let offset = 0;

  function readUint8(): number {
    return data[offset++];
  }

  function readUint16(): number {
    const val = (data[offset] << 8) | data[offset + 1];
    offset += 2;
    return val;
  }

  function readUint32(): number {
    const val = ((data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3]) >>> 0;
    offset += 4;
    return val;
  }

  function readLength(additionalInfo: number): number {
    if (additionalInfo < 24) return additionalInfo;
    if (additionalInfo === 24) return readUint8();
    if (additionalInfo === 25) return readUint16();
    if (additionalInfo === 26) return readUint32();
    throw new Error(`Unsupported CBOR length encoding: ${additionalInfo}`);
  }

  function decodeItem(): unknown {
    const initial = readUint8();
    const majorType = initial >> 5;
    const additionalInfo = initial & 0x1f;

    switch (majorType) {
      case 0: // unsigned integer
        return readLength(additionalInfo);
      case 1: // negative integer
        return -1 - readLength(additionalInfo);
      case 2: { // byte string
        const len = readLength(additionalInfo);
        const bytes = data.slice(offset, offset + len);
        offset += len;
        return bytes;
      }
      case 3: { // text string
        const len = readLength(additionalInfo);
        const text = new TextDecoder().decode(data.slice(offset, offset + len));
        offset += len;
        return text;
      }
      case 4: { // array
        const len = readLength(additionalInfo);
        const arr: unknown[] = [];
        for (let i = 0; i < len; i++) arr.push(decodeItem());
        return arr;
      }
      case 5: { // map
        const len = readLength(additionalInfo);
        const map = new Map<string | number, unknown>();
        for (let i = 0; i < len; i++) {
          const key = decodeItem() as string | number;
          const value = decodeItem();
          map.set(key, value);
        }
        return map;
      }
      case 7: // simple values / float
        if (additionalInfo === 20) return false;
        if (additionalInfo === 21) return true;
        if (additionalInfo === 22) return null;
        throw new Error(`Unsupported CBOR simple value: ${additionalInfo}`);
      default:
        throw new Error(`Unsupported CBOR major type: ${majorType}`);
    }
  }

  const result = decodeItem();
  if (!(result instanceof Map)) {
    throw new Error("Expected CBOR map at top level");
  }
  return result;
}

/**
 * Convert a COSE public key map to JWK format for use with crypto.subtle.importKey.
 * Supports ES256 (COSE alg -7, P-256) and RS256 (COSE alg -257).
 *
 * COSE key labels:
 *   1 = kty, 3 = alg, -1 = crv/n, -2 = x/e, -3 = y
 */
function coseKeyToJwk(coseMap: Map<string | number, unknown>): (JsonWebKey & { alg: string }) | null {
  const kty = coseMap.get(1) as number; // 2 = EC, 3 = RSA
  const alg = coseMap.get(3) as number; // -7 = ES256, -257 = RS256

  if (kty === 2 && alg === -7) {
    // EC2 key, ES256 (P-256)
    const crv = coseMap.get(-1) as number; // 1 = P-256
    if (crv !== 1) return null;
    const x = coseMap.get(-2) as Uint8Array;
    const y = coseMap.get(-3) as Uint8Array;
    if (!x || !y) return null;
    return {
      kty: "EC",
      crv: "P-256",
      alg: "ES256",
      x: base64urlEncode(x),
      y: base64urlEncode(y),
    };
  }

  if (kty === 3 && alg === -257) {
    // RSA key, RS256
    const n = coseMap.get(-1) as Uint8Array;
    const e = coseMap.get(-2) as Uint8Array;
    if (!n || !e) return null;
    return {
      kty: "RSA",
      alg: "RS256",
      n: base64urlEncode(n),
      e: base64urlEncode(e),
    };
  }

  return null;
}

// ── Base64url Helpers ────────────────────────────────────────

function base64urlEncode(buffer: Uint8Array): string {
  let binary = "";
  for (const byte of buffer) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlDecode(str: string): Uint8Array {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function arrayEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a[i] ^ b[i];
  }
  return result === 0;
}

export { webauthn };
