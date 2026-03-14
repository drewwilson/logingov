/**
 * SMS / Phone OTP Routes
 *
 * POST /mfa/sms/send    — Generate 6-digit code, store in KV_OTP, publish to QUEUE_EMAIL (Twilio consumer)
 * POST /mfa/sms/verify  — Verify code from KV_OTP and mark session as MFA-verified
 */
import { Hono } from "hono";
import type { Env } from "@logingov/shared";
import {
  KV_KEYS,
  KV_TTL,
  kvGet,
  kvPut,
  kvDelete,
  createQueueMessage,
} from "@logingov/shared";
import type { EmailSendPayload } from "@logingov/shared";
import { users, decrypt, importKey } from "@logingov/shared";
import { eq } from "drizzle-orm";
import { getDb } from "@logingov/shared/db";
import { loadSession, updateSessionDO } from "../middleware/aal-evaluator.js";
import { checkMfaRateLimit, recordFailedAttempt, clearRateLimit } from "../middleware/rate-limiter.js";

const smsOtp = new Hono<{ Bindings: Env }>();

// ── OTP Constants ────────────────────────────────────────────

const OTP_LENGTH = 6;
const OTP_PURPOSE = "mfa_sms";

interface StoredOTP {
  code: string;
  phone: string;
  createdAt: string;
}

// ── Send OTP ─────────────────────────────────────────────────

// ── SMS send rate limit constants ────────────────────────────
const SMS_SEND_MAX = 3;
const SMS_SEND_WINDOW_SECONDS = 10 * 60; // 10 minutes

interface SmsSendRateEntry {
  count: number;
  firstSendAt: string;
}

smsOtp.post("/send", loadSession(), async (c) => {
  const userId = c.req.header("X-User-Id");
  if (!userId) return c.json({ error: "missing_user_id" }, 400);

  // Rate limit: max 3 SMS sends per 10 minutes per user
  const sendRlKey = KV_KEYS.rateLimit(`sms_send:${userId}`);
  const sendRl = await kvGet<SmsSendRateEntry>(c.env.KV_RATE_LIMIT, sendRlKey);
  if (sendRl && sendRl.count >= SMS_SEND_MAX) {
    return c.json(
      { error: "sms_send_rate_limited", message: "Too many SMS requests. Please wait before trying again." },
      429
    );
  }

  // Look up the user's registered phone from D1 — do NOT trust request body
  const db = getDb(c.env);
  const [user] = await db
    .select({ phone: users.phone })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user?.phone) {
    return c.json({ error: "no_phone_registered", message: "No phone number is registered for this account" }, 404);
  }

  // Decrypt and normalize the stored phone number
  const cryptoKey = await importKey(c.env.ENCRYPTION_KEY);
  const decryptedPhone = await decrypt(user.phone, cryptoKey);
  const phone = decryptedPhone.replace(/[^+\d]/g, "");
  if (phone.length < 10 || phone.length > 15) {
    return c.json({ error: "invalid_phone", message: "Registered phone number is invalid" }, 400);
  }

  // Increment SMS send rate limit counter
  const newSendRl: SmsSendRateEntry = {
    count: (sendRl?.count ?? 0) + 1,
    firstSendAt: sendRl?.firstSendAt ?? new Date().toISOString(),
  };
  await kvPut(c.env.KV_RATE_LIMIT, sendRlKey, newSendRl, SMS_SEND_WINDOW_SECONDS);

  // Generate cryptographically random 6-digit OTP
  const code = generateOTP(OTP_LENGTH);

  // Store in KV_OTP with 10-minute TTL
  const otpKey = KV_KEYS.otp(userId, OTP_PURPOSE);
  const otpEntry: StoredOTP = {
    code,
    phone,
    createdAt: new Date().toISOString(),
  };
  await kvPut(c.env.KV_OTP, otpKey, otpEntry, KV_TTL.OTP);

  // Publish to QUEUE_EMAIL for Twilio consumer to send SMS
  const message = createQueueMessage<EmailSendPayload>(
    "email:send",
    userId,
    {
      to: phone,
      template: "sms_otp",
      locale: c.req.header("Accept-Language")?.split(",")[0] ?? "en",
      variables: {
        code,
        expiry_minutes: "10",
      },
    },
    { traceId: c.req.header("X-Trace-Id") ?? undefined }
  );

  await c.env.QUEUE_EMAIL.send(message);

  return c.json({
    ok: true,
    message: "Verification code sent",
    phone_hint: maskPhone(phone),
    expires_in_seconds: KV_TTL.OTP,
  });
});

// ── Verify OTP ───────────────────────────────────────────────

smsOtp.post("/verify", loadSession(), checkMfaRateLimit(), async (c) => {
  const userId = c.get("userId" as never) as string;
  const sessionId = c.get("sessionId" as never) as string;

  const body = await c.req.json<{ code: string; remember_device?: boolean }>();
  if (!body.code || body.code.length !== OTP_LENGTH) {
    return c.json({ error: "invalid_code", message: `Code must be ${OTP_LENGTH} digits` }, 400);
  }

  // Retrieve OTP from KV
  const otpKey = KV_KEYS.otp(userId, OTP_PURPOSE);
  const stored = await kvGet<StoredOTP>(c.env.KV_OTP, otpKey);

  if (!stored) {
    return c.json({ error: "otp_expired", message: "Code has expired. Request a new one." }, 410);
  }

  // Constant-time comparison
  if (!timingSafeEqual(body.code, stored.code)) {
    const attempts = await recordFailedAttempt(c.env, userId);
    return c.json(
      {
        error: "invalid_code",
        message: "The code you entered is incorrect",
        attempts_remaining: Math.max(0, 5 - attempts),
      },
      401
    );
  }

  // Success — delete the OTP (single-use), clear rate limit
  await kvDelete(c.env.KV_OTP, otpKey);
  await clearRateLimit(c.env, userId);

  // Mark session as MFA-verified (with optional device remembering)
  await updateSessionDO(c.env, sessionId, {
    mfaVerified: true,
    mfaMethod: "sms",
    achievedAal: 2,
    ...(body.remember_device ? { rememberedDevice: true } : {}),
  });

  return c.json({ ok: true, method: "sms", remembered: !!body.remember_device });
});

// ── Helpers ──────────────────────────────────────────────────

/**
 * Generate a cryptographically random numeric OTP of the given length.
 * Uses rejection sampling to eliminate modulo bias.
 */
function generateOTP(length: number): string {
  const max = Math.pow(10, length);
  const limit = Math.floor(0xFFFFFFFF / max) * max;
  let value: number;
  do {
    const arr = new Uint32Array(1);
    crypto.getRandomValues(arr);
    value = arr[0];
  } while (value >= limit);
  return String(value % max).padStart(length, "0");
}

/**
 * Mask a phone number for display, showing only last 4 digits.
 */
function maskPhone(phone: string): string {
  if (phone.length <= 4) return "****";
  return "***-***-" + phone.slice(-4);
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

export { smsOtp };
