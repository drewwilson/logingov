/**
 * TOTP Authenticator App Routes
 *
 * POST /mfa/totp/setup    — Generate TOTP secret, return QR URI + secret
 * POST /mfa/totp/verify   — Verify a TOTP code and mark session as MFA-verified
 */
import { Hono } from "hono";
import type { Env } from "@logingov/shared";
import { uuidV7, encrypt, decrypt, importKey } from "@logingov/shared";
import { credentials } from "@logingov/shared";
import { kvGet, kvPut, KV_KEYS } from "@logingov/shared";
import { eq, and } from "drizzle-orm";
import { getDb } from "@logingov/shared/db";
import { loadSession, updateSessionDO } from "../middleware/aal-evaluator.js";
import { checkMfaRateLimit, recordFailedAttempt, clearRateLimit } from "../middleware/rate-limiter.js";

const totp = new Hono<{ Bindings: Env }>();

// ── TOTP Constants ───────────────────────────────────────────

const TOTP_DIGITS = 6;
const TOTP_PERIOD = 30; // seconds
const TOTP_ALGORITHM = "SHA-1";
const TOTP_ISSUER = "Login.gov";

// ── Setup: Generate Secret ───────────────────────────────────

totp.post("/setup", loadSession(), async (c) => {
  const userId = c.req.header("X-User-Id");
  if (!userId) return c.json({ error: "missing_user_id" }, 400);

  const db = getDb(c.env);

  // Check if user already has a TOTP credential
  const existing = await db
    .select({ id: credentials.id })
    .from(credentials)
    .where(and(eq(credentials.userId, userId), eq(credentials.type, "totp")))
    .limit(1);

  if (existing.length > 0) {
    return c.json({ error: "totp_already_configured", message: "TOTP is already set up for this account" }, 409);
  }

  // Generate a 20-byte random secret
  const secretBytes = crypto.getRandomValues(new Uint8Array(20));
  const secretBase32 = base32Encode(secretBytes);

  // Build otpauth URI for QR code generation
  const email = c.req.header("X-User-Email") ?? "user";
  const otpauthUri = `otpauth://totp/${encodeURIComponent(TOTP_ISSUER)}:${encodeURIComponent(email)}?secret=${secretBase32}&issuer=${encodeURIComponent(TOTP_ISSUER)}&algorithm=${TOTP_ALGORITHM}&digits=${TOTP_DIGITS}&period=${TOTP_PERIOD}`;

  // Encrypt the secret for storage
  const cryptoKey = await importKey(c.env.ENCRYPTION_KEY);
  const encryptedData = await encrypt(
    JSON.stringify({ secret: secretBase32, algorithm: TOTP_ALGORITHM, digits: TOTP_DIGITS, period: TOTP_PERIOD }),
    cryptoKey
  );

  // Store as pending (not yet verified) — use a pending credential entry
  const credentialId = uuidV7();
  await db.insert(credentials).values({
    id: credentialId,
    userId,
    type: "totp",
    data: encryptedData,
    createdAt: new Date().toISOString(),
  });

  return c.json({
    credential_id: credentialId,
    secret: secretBase32,
    otpauth_uri: otpauthUri,
    qr_hint: "Render the otpauth_uri as a QR code for the user to scan",
  });
});

// ── Verify TOTP Code ─────────────────────────────────────────

totp.post("/verify", loadSession(), checkMfaRateLimit(), async (c) => {
  const userId = c.get("userId" as never) as string;
  const sessionId = c.get("sessionId" as never) as string;

  const body = await c.req.json<{ code: string; remember_device?: boolean }>();
  if (!body.code || body.code.length !== TOTP_DIGITS) {
    return c.json({ error: "invalid_code", message: "Code must be 6 digits" }, 400);
  }

  const db = getDb(c.env);

  // Retrieve TOTP credential
  const [cred] = await db
    .select()
    .from(credentials)
    .where(and(eq(credentials.userId, userId), eq(credentials.type, "totp")))
    .limit(1);

  if (!cred) {
    return c.json({ error: "totp_not_configured", message: "TOTP is not set up for this account" }, 404);
  }

  // Decrypt secret
  const cryptoKey = await importKey(c.env.ENCRYPTION_KEY);
  const decryptedData = JSON.parse(await decrypt(cred.data, cryptoKey)) as {
    secret: string;
    algorithm: string;
    digits: number;
    period: number;
  };

  // Verify the TOTP code (check current window and +/- 1 window for clock drift)
  const now = Math.floor(Date.now() / 1000);
  const isValid = await verifyTOTP(body.code, decryptedData.secret, now, decryptedData.period, c.env, userId);

  if (!isValid) {
    const attempts = await recordFailedAttempt(c.env, userId);
    return c.json(
      {
        error: "invalid_totp_code",
        message: "The code you entered is incorrect",
        attempts_remaining: Math.max(0, 5 - attempts),
      },
      401
    );
  }

  // Success — clear rate limit, update session DO
  await clearRateLimit(c.env, userId);

  // Update last_used_at on the credential
  await db
    .update(credentials)
    .set({ lastUsedAt: new Date().toISOString() })
    .where(eq(credentials.id, cred.id));

  // Mark session as MFA-verified (with optional device remembering)
  await updateSessionDO(c.env, sessionId, {
    mfaVerified: true,
    mfaMethod: "totp",
    achievedAal: 2,
    ...(body.remember_device ? { rememberedDevice: true } : {}),
  });

  return c.json({ ok: true, method: "totp", remembered: !!body.remember_device });
});

// ── TOTP Generation / Verification ──────────────────────────

/**
 * Generate a TOTP code for a given time step using HMAC-SHA1.
 */
async function generateTOTP(secret: string, timeStep: number): Promise<string> {
  const secretBytes = base32Decode(secret);

  // Time step as 8-byte big-endian
  const timeBuffer = new ArrayBuffer(8);
  const timeView = new DataView(timeBuffer);
  timeView.setUint32(4, timeStep, false);

  const key = await crypto.subtle.importKey(
    "raw",
    secretBytes,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign("HMAC", key, timeBuffer);
  const hmac = new Uint8Array(signature);

  // Dynamic truncation
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  const otp = code % Math.pow(10, TOTP_DIGITS);
  return otp.toString().padStart(TOTP_DIGITS, "0");
}

/**
 * TOTP replay prevention TTL — covers 3 time windows (current +/- 1) plus buffer.
 */
const TOTP_REPLAY_TTL = 90; // seconds

/**
 * Verify a TOTP code against the secret, allowing for clock skew (+/- 1 window).
 * Prevents replay attacks by storing used time steps in KV.
 */
async function verifyTOTP(
  code: string,
  secret: string,
  nowSeconds: number,
  period: number,
  env: Env,
  userId: string
): Promise<boolean> {
  const currentStep = Math.floor(nowSeconds / period);

  // Check current window and +/- 1 for clock drift tolerance
  for (const offset of [-1, 0, 1]) {
    const timeStep = currentStep + offset;
    const expected = await generateTOTP(secret, timeStep);
    if (timingSafeEqual(code, expected)) {
      // Check for replay: has this time step already been used?
      const replayKey = `totp:used:${userId}:${timeStep}`;
      const alreadyUsed = await kvGet<boolean>(env.KV_OTP, replayKey);
      if (alreadyUsed) {
        return false; // Replay detected — reject
      }
      // Mark this time step as used
      await kvPut(env.KV_OTP, replayKey, true, TOTP_REPLAY_TTL);
      return true;
    }
  }
  return false;
}

/**
 * Constant-time string comparison to prevent timing attacks.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

// ── Base32 Encoding / Decoding ──────────────────────────────

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(buffer: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = "";

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      output += BASE32_ALPHABET[(value >>> bits) & 0x1f];
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 0x1f];
  }

  return output;
}

function base32Decode(encoded: string): Uint8Array {
  const cleaned = encoded.toUpperCase().replace(/=+$/, "");
  const output: number[] = [];
  let bits = 0;
  let value = 0;

  for (const char of cleaned) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      output.push((value >>> bits) & 0xff);
    }
  }

  return new Uint8Array(output);
}

export { totp };
