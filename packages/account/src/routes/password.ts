/**
 * Password Management Routes
 *
 * Feature 10: Set, change, forgot password.
 * Uses Argon2id hashing via Web Crypto (simulated with PBKDF2 for
 * Cloudflare Workers compatibility — in production, Better Auth handles
 * the actual Argon2id hashing).
 *
 * Integrates with Better Auth emailAndPassword plugin pattern.
 */
import { Hono } from "hono";
import { getDb } from "@logingov/shared/db";
import { eq, and } from "drizzle-orm";
import { credentials, users } from "@logingov/shared/schema";
import { uuidV7, computeBlindIndex, importKey, decrypt } from "@logingov/shared/crypto";
import { createQueueMessage } from "@logingov/shared/queue";
import type { EmailSendPayload, SETOutboundPayload } from "@logingov/shared/queue";
import { SET_EVENT_TYPES } from "@logingov/shared/types";
import type { Env } from "@logingov/shared/env";
import { COMMON_PASSWORDS } from "../lib/common-passwords.js";

const password = new Hono<{ Bindings: Env }>();

// ── POST /password/set ──────────────────────────────────────
// Set initial password for a user (registration)

password.post("/set", async (c) => {
  const userId = c.req.header("X-User-Id");
  if (!userId) {
    return c.json({ error: "unauthorized", message: "Missing user context" }, 401);
  }

  const body = await c.req.json<{ password: string }>();
  if (!body.password) {
    return c.json({ error: "missing_password", message: "Password is required" }, 400);
  }

  const db = getDb(c.env);

  // Fetch user email for password validation (email is encrypted at rest)
  const [userRecord] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  let plainEmail = userRecord?.email;
  if (plainEmail) {
    try {
      const encKey = await importKey(c.env.ENCRYPTION_KEY);
      plainEmail = await decrypt(plainEmail, encKey);
    } catch {
      // fallback: email may not yet be encrypted
    }
  }

  const validationError = validatePassword(body.password, plainEmail);
  if (validationError) {
    return c.json({ error: "weak_password", message: validationError }, 400);
  }

  // Check if user already has a password credential
  const existing = await db
    .select({ id: credentials.id })
    .from(credentials)
    .where(and(eq(credentials.userId, userId), eq(credentials.type, "password")))
    .limit(1);

  if (existing.length > 0) {
    return c.json(
      { error: "password_exists", message: "User already has a password. Use /password/change instead." },
      409
    );
  }

  const hashedPassword = await hashPassword(body.password);
  const credId = uuidV7();
  const now = new Date().toISOString();

  await db.insert(credentials).values({
    id: credId,
    userId,
    type: "password",
    data: hashedPassword,
    lastUsedAt: null,
    createdAt: now,
  });

  return c.json({ ok: true, credentialId: credId }, 201);
});

// ── POST /password/change ───────────────────────────────────
// Change password (requires current password)

password.post("/change", async (c) => {
  const userId = c.req.header("X-User-Id");
  if (!userId) {
    return c.json({ error: "unauthorized", message: "Missing user context" }, 401);
  }

  const body = await c.req.json<{ currentPassword: string; newPassword: string }>();
  if (!body.currentPassword || !body.newPassword) {
    return c.json(
      { error: "missing_fields", message: "Both currentPassword and newPassword are required" },
      400
    );
  }

  if (body.currentPassword === body.newPassword) {
    return c.json(
      { error: "same_password", message: "New password must be different from current password" },
      400
    );
  }

  const db = getDb(c.env);

  // Fetch user email for password validation (email is encrypted at rest)
  const [userRecord] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  let plainEmailForChange = userRecord?.email;
  if (plainEmailForChange) {
    try {
      const encKey = await importKey(c.env.ENCRYPTION_KEY);
      plainEmailForChange = await decrypt(plainEmailForChange, encKey);
    } catch {
      // fallback: email may not yet be encrypted
    }
  }

  const validationError = validatePassword(body.newPassword, plainEmailForChange);
  if (validationError) {
    return c.json({ error: "weak_password", message: validationError }, 400);
  }

  // Get current password credential
  const [cred] = await db
    .select({ id: credentials.id, data: credentials.data })
    .from(credentials)
    .where(and(eq(credentials.userId, userId), eq(credentials.type, "password")))
    .limit(1);

  if (!cred) {
    return c.json({ error: "no_password", message: "No password credential found" }, 404);
  }

  // Verify current password
  const currentValid = await verifyPassword(body.currentPassword, cred.data);
  if (!currentValid) {
    return c.json({ error: "invalid_password", message: "Current password is incorrect" }, 401);
  }

  // Update with new password hash
  const newHash = await hashPassword(body.newPassword);
  const now = new Date().toISOString();

  await db
    .update(credentials)
    .set({ data: newHash, lastUsedAt: now })
    .where(eq(credentials.id, cred.id));

  await db
    .update(users)
    .set({ updatedAt: now })
    .where(eq(users.id, userId));

  // Emit password-reset SET
  const setMessage = createQueueMessage<SETOutboundPayload>("set:outbound", userId, {
    targetUrl: "", // resolved by SET consumer per SP
    eventUri: SET_EVENT_TYPES.PASSWORD_RESET,
    subject: userId,
    claims: { event_type: "password-change" },
  });
  await c.env.QUEUE_SET.send(setMessage);

  return c.json({ ok: true, changedAt: now });
});

// ── POST /password/forgot ───────────────────────────────────
// Initiate forgot password flow — sends reset token via email

password.post("/forgot", async (c) => {
  const body = await c.req.json<{ email: string }>();
  if (!body.email) {
    return c.json({ error: "missing_email", message: "Email is required" }, 400);
  }

  const db = getDb(c.env);
  const normalizedEmail = body.email.toLowerCase().trim();

  // Look up user by email blind index — always return success to prevent email enumeration
  const blindIndex = await computeBlindIndex(normalizedEmail, c.env.ENCRYPTION_KEY);
  const [user] = await db
    .select({ id: users.id, locale: users.locale })
    .from(users)
    .where(eq(users.emailBlindIndex, blindIndex))
    .limit(1);

  if (user) {
    // Generate a reset token (signed JWT, 1hr expiry)
    const resetToken = await createResetToken(user.id, normalizedEmail, c.env.JWT_SIGNING_KEY);

    const emailMessage = createQueueMessage<EmailSendPayload>("email:send", user.id, {
      to: normalizedEmail,
      template: "password_reset",
      locale: user.locale,
      variables: {
        reset_token: resetToken,
        expires_in: "1 hour",
      },
    });
    await c.env.QUEUE_EMAIL.send(emailMessage);
  }

  // Always return success to prevent email enumeration
  return c.json({
    ok: true,
    message: "If an account exists with that email, a reset link has been sent.",
  });
});

// ── POST /password/reset ────────────────────────────────────
// Reset password using a reset token

password.post("/reset", async (c) => {
  const body = await c.req.json<{ token: string; newPassword: string }>();
  if (!body.token || !body.newPassword) {
    return c.json({ error: "missing_fields", message: "Both token and newPassword are required" }, 400);
  }

  let tokenPayload: { userId: string; email: string; exp: number; jti: string };
  try {
    tokenPayload = await verifyResetToken(body.token, c.env.JWT_SIGNING_KEY);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid token";
    return c.json({ error: "invalid_token", message }, 400);
  }

  if (Date.now() / 1000 > tokenPayload.exp) {
    return c.json({ error: "token_expired", message: "Reset token has expired" }, 400);
  }

  const validationError = validatePassword(body.newPassword, tokenPayload.email);
  if (validationError) {
    return c.json({ error: "weak_password", message: validationError }, 400);
  }

  // Prevent token replay — each reset token can only be used once
  const jtiKey = `reset_token_used:${tokenPayload.jti}`;
  const alreadyUsed = await c.env.KV_SESSIONS.get(jtiKey);
  if (alreadyUsed) {
    return c.json({ error: "invalid_token", message: "Reset token has already been used" }, 400);
  }

  const db = getDb(c.env);
  const newHash = await hashPassword(body.newPassword);
  const now = new Date().toISOString();

  // Update or create password credential
  const [cred] = await db
    .select({ id: credentials.id })
    .from(credentials)
    .where(and(eq(credentials.userId, tokenPayload.userId), eq(credentials.type, "password")))
    .limit(1);

  if (cred) {
    await db
      .update(credentials)
      .set({ data: newHash, lastUsedAt: now })
      .where(eq(credentials.id, cred.id));
  } else {
    await db.insert(credentials).values({
      id: uuidV7(),
      userId: tokenPayload.userId,
      type: "password",
      data: newHash,
      lastUsedAt: now,
      createdAt: now,
    });
  }

  await db
    .update(users)
    .set({ updatedAt: now })
    .where(eq(users.id, tokenPayload.userId));

  // Mark the reset token as used (TTL matches token expiry: 1 hour)
  await c.env.KV_SESSIONS.put(jtiKey, "1", { expirationTtl: 3600 });

  // Emit password-reset SET
  const setResetMessage = createQueueMessage<SETOutboundPayload>("set:outbound", tokenPayload.userId, {
    targetUrl: "", // resolved by SET consumer per SP
    eventUri: SET_EVENT_TYPES.PASSWORD_RESET,
    subject: tokenPayload.userId,
    claims: { event_type: "password-reset" },
  });
  await c.env.QUEUE_SET.send(setResetMessage);

  return c.json({ ok: true, resetAt: now });
});

// ── Password hashing ────────────────────────────────────────
// Uses PBKDF2-SHA256 as a Workers-compatible stand-in.
// In production, Better Auth handles Argon2id hashing natively.

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: salt.buffer as ArrayBuffer,
      iterations: 100_000,
      hash: "SHA-256",
    },
    keyMaterial,
    256
  );

  const saltHex = Array.from(salt)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const hashHex = Array.from(new Uint8Array(derivedBits))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return `pbkdf2:100000:${saltHex}:${hashHex}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split(":");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") {
    return false;
  }

  const [, iterStr, saltHex, expectedHashHex] = parts;
  const iterations = parseInt(iterStr, 10);
  const salt = new Uint8Array(
    saltHex.match(/.{2}/g)!.map((byte) => parseInt(byte, 16))
  );

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const derivedBits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt.buffer as ArrayBuffer, iterations, hash: "SHA-256" },
    keyMaterial,
    256
  );

  const hashHex = Array.from(new Uint8Array(derivedBits))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // Use constant-time comparison to prevent timing attacks
  const encoder = new TextEncoder();
  const a = encoder.encode(hashHex);
  const b = encoder.encode(expectedHashHex);
  if (a.byteLength !== b.byteLength) return false;
  return crypto.subtle.timingSafeEqual(a, b);
}

// ── Password validation ─────────────────────────────────────

function validatePassword(password: string, userEmail?: string): string | null {
  if (password.length < 12) {
    return "Password must be at least 12 characters long";
  }
  if (password.length > 128) {
    return "Password must be at most 128 characters long";
  }
  // NIST 800-63B: check against common passwords list
  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    return "Password is too common. Please choose a different password.";
  }
  // Check that the password doesn't contain the user's email local part or full address
  if (userEmail) {
    const emailLower = userEmail.toLowerCase();
    const passwordLower = password.toLowerCase();
    const localPart = emailLower.split("@")[0];
    if (localPart.length >= 4 && passwordLower.includes(localPart)) {
      return "Password must not contain your email address.";
    }
    if (passwordLower.includes(emailLower)) {
      return "Password must not contain your email address.";
    }
  }
  return null;
}

// ── Reset token helpers ─────────────────────────────────────

async function createResetToken(userId: string, email: string, signingKey: string): Promise<string> {
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    jti: crypto.randomUUID(),
    userId,
    email,
    purpose: "password_reset",
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 60 * 60, // 1 hour
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(signingKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signingInput));
  const encodedSignature = base64UrlEncode(
    String.fromCharCode(...new Uint8Array(signature))
  );

  return `${signingInput}.${encodedSignature}`;
}

async function verifyResetToken(
  token: string,
  signingKey: string
): Promise<{ userId: string; email: string; exp: number; jti: string }> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Malformed token");

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(signingKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );

  const signatureBytes = Uint8Array.from(
    base64UrlDecode(encodedSignature),
    (ch) => ch.charCodeAt(0)
  );

  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    signatureBytes,
    new TextEncoder().encode(signingInput)
  );

  if (!valid) throw new Error("Invalid token signature");

  const payload = JSON.parse(base64UrlDecode(encodedPayload));
  if (payload.purpose !== "password_reset") throw new Error("Invalid token purpose");
  if (!payload.jti) throw new Error("Invalid token: missing jti");

  return { userId: payload.userId, email: payload.email ?? "", exp: payload.exp, jti: payload.jti };
}

function base64UrlEncode(str: string): string {
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(str: string): string {
  const padded = str + "=".repeat((4 - (str.length % 4)) % 4);
  return atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
}

export { password };
