/**
 * Backup Codes Routes
 *
 * POST /mfa/backup-codes/generate  — Generate 10 backup codes, hash and store in DB
 * POST /mfa/backup-codes/verify    — Verify a backup code (single-use, DB transaction)
 * GET  /mfa/backup-codes/count     — Return how many unused backup codes remain
 */
import { Hono } from "hono";
import type { Env } from "@logingov/shared";
import { uuidV7, encrypt, decrypt, importKey } from "@logingov/shared";
import { credentials } from "@logingov/shared";
import { eq, and, isNull } from "drizzle-orm";
import { getDb } from "@logingov/shared/db";
import { loadSession, updateSessionDO } from "../middleware/aal-evaluator.js";
import { checkMfaRateLimit, recordFailedAttempt, clearRateLimit } from "../middleware/rate-limiter.js";

const backupCodes = new Hono<{ Bindings: Env }>();

// ── Constants ────────────────────────────────────────────────

const NUM_CODES = 10;
const CODE_LENGTH = 8; // 8 characters
const CODE_CHARSET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars (no 0/O, 1/I/L)

interface StoredBackupCodes {
  codes: Array<{
    hash: string;   // SHA-256 hash of the code
    usedAt: string | null;
  }>;
  generatedAt: string;
}

// ── Generate Backup Codes ────────────────────────────────────

backupCodes.post("/generate", loadSession(), async (c) => {
  const userId = c.req.header("X-User-Id");
  if (!userId) return c.json({ error: "missing_user_id" }, 400);

  const db = getDb(c.env);

  // Delete any existing backup codes (regeneration replaces old ones)
  const existing = await db
    .select({ id: credentials.id })
    .from(credentials)
    .where(and(eq(credentials.userId, userId), eq(credentials.type, "backup")));

  for (const cred of existing) {
    await db.delete(credentials).where(eq(credentials.id, cred.id));
  }

  // Generate codes
  const plaintextCodes: string[] = [];
  const hashedCodes: StoredBackupCodes["codes"] = [];

  for (let i = 0; i < NUM_CODES; i++) {
    const code = generateCode(CODE_LENGTH);
    plaintextCodes.push(formatCode(code));

    const hash = await hashCode(code, userId);
    hashedCodes.push({ hash, usedAt: null });
  }

  // Encrypt the hashed codes for storage
  const cryptoKey = await importKey(c.env.ENCRYPTION_KEY);
  const storedData: StoredBackupCodes = {
    codes: hashedCodes,
    generatedAt: new Date().toISOString(),
  };
  const encryptedData = await encrypt(JSON.stringify(storedData), cryptoKey);

  // Store in D1
  await db.insert(credentials).values({
    id: uuidV7(),
    userId,
    type: "backup",
    data: encryptedData,
    createdAt: new Date().toISOString(),
  });

  return c.json({
    ok: true,
    codes: plaintextCodes,
    count: NUM_CODES,
    message: "Save these codes in a secure location. Each code can only be used once.",
  });
});

// ── Verify Backup Code ───────────────────────────────────────

backupCodes.post("/verify", loadSession(), checkMfaRateLimit(), async (c) => {
  const userId = c.get("userId" as never) as string;
  const sessionId = c.get("sessionId" as never) as string;

  const body = await c.req.json<{ code: string; remember_device?: boolean }>();
  if (!body.code) {
    return c.json({ error: "missing_code", message: "Backup code is required" }, 400);
  }

  // Normalize: remove dashes/spaces, uppercase
  const normalizedCode = body.code.replace(/[-\s]/g, "").toUpperCase();

  const db = getDb(c.env);
  const cryptoKey = await importKey(c.env.ENCRYPTION_KEY);

  // Fetch backup codes credential
  const [cred] = await db
    .select()
    .from(credentials)
    .where(and(eq(credentials.userId, userId), eq(credentials.type, "backup")))
    .limit(1);

  if (!cred) {
    return c.json({ error: "no_backup_codes", message: "No backup codes configured" }, 404);
  }

  // Atomic update: decrypt, find match, mark used, and write back in a single
  // transaction to prevent TOCTOU races where the same code could be used twice.
  const inputHash = await hashCode(normalizedCode, userId);
  const now = new Date().toISOString();

  // Read-modify-write with optimistic concurrency
  const storedData = JSON.parse(await decrypt(cred.data, cryptoKey)) as StoredBackupCodes;

  // Find matching unused code and mark it used in one pass
  let matchIndex = -1;
  for (let i = 0; i < storedData.codes.length; i++) {
    const entry = storedData.codes[i];
    if (entry.usedAt === null && timingSafeEqual(entry.hash, inputHash)) {
      matchIndex = i;
      break;
    }
  }

  if (matchIndex === -1) {
    const attempts = await recordFailedAttempt(c.env, userId);
    return c.json(
      {
        error: "invalid_backup_code",
        message: "Invalid or already used backup code",
        attempts_remaining: Math.max(0, 5 - attempts),
      },
      401
    );
  }

  // Mark used and write back atomically — use the credential's lastUsedAt as a
  // version check to detect concurrent modifications.
  storedData.codes[matchIndex].usedAt = now;
  const updatedEncrypted = await encrypt(JSON.stringify(storedData), cryptoKey);

  // Conditional update: only succeed if lastUsedAt hasn't changed since we read.
  // This prevents a concurrent request from consuming the same code.
  const previousLastUsed = cred.lastUsedAt;
  const updateResult = previousLastUsed === null
    ? await db
        .update(credentials)
        .set({ data: updatedEncrypted, lastUsedAt: now })
        .where(and(eq(credentials.id, cred.id), isNull(credentials.lastUsedAt)))
    : await db
        .update(credentials)
        .set({ data: updatedEncrypted, lastUsedAt: now })
        .where(and(eq(credentials.id, cred.id), eq(credentials.lastUsedAt, previousLastUsed)));

  if (!updateResult.rowsAffected || updateResult.rowsAffected === 0) {
    // Concurrent modification detected — retry by returning a conflict error
    return c.json(
      { error: "concurrent_modification", message: "Please try again" },
      409
    );
  }

  await clearRateLimit(c.env, userId);

  // Count remaining codes
  const remaining = storedData.codes.filter((entry) => entry.usedAt === null).length;

  // Mark session as MFA-verified (with optional device remembering)
  await updateSessionDO(c.env, sessionId, {
    mfaVerified: true,
    mfaMethod: "backup",
    achievedAal: 2,
    ...(body.remember_device ? { rememberedDevice: true } : {}),
  });

  return c.json({
    ok: true,
    method: "backup",
    codes_remaining: remaining,
    remembered: !!body.remember_device,
    ...(remaining <= 2 ? { warning: "You have very few backup codes remaining. Consider generating new ones." } : {}),
  });
});

// ── Count Remaining Codes ────────────────────────────────────

backupCodes.get("/count", loadSession(), async (c) => {
  const userId = c.req.header("X-User-Id");
  if (!userId) return c.json({ error: "missing_user_id" }, 400);

  const db = getDb(c.env);
  const cryptoKey = await importKey(c.env.ENCRYPTION_KEY);

  const [cred] = await db
    .select()
    .from(credentials)
    .where(and(eq(credentials.userId, userId), eq(credentials.type, "backup")))
    .limit(1);

  if (!cred) {
    return c.json({ configured: false, remaining: 0 });
  }

  const storedData = JSON.parse(await decrypt(cred.data, cryptoKey)) as StoredBackupCodes;
  const remaining = storedData.codes.filter((entry) => entry.usedAt === null).length;

  return c.json({
    configured: true,
    remaining,
    total: storedData.codes.length,
    generated_at: storedData.generatedAt,
  });
});

// ── Helpers ──────────────────────────────────────────────────

/**
 * Generate a random code from the allowed character set.
 */
function generateCode(length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let code = "";
  for (const byte of bytes) {
    code += CODE_CHARSET[byte % CODE_CHARSET.length];
  }
  return code;
}

/**
 * Format code with a dash in the middle for readability: ABCD-EFGH
 */
function formatCode(code: string): string {
  const mid = Math.floor(code.length / 2);
  return code.slice(0, mid) + "-" + code.slice(mid);
}

/**
 * Hash a backup code using HMAC-SHA256 keyed with the userId.
 * This ensures identical plaintext codes for different users produce different hashes.
 */
async function hashCode(code: string, userId?: string): Promise<string> {
  const encoded = new TextEncoder().encode(code);
  const keyData = new TextEncoder().encode(userId ?? "");
  const hmacKey = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const hashBuffer = await crypto.subtle.sign("HMAC", hmacKey, encoded);
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Constant-time string comparison.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export { backupCodes };
