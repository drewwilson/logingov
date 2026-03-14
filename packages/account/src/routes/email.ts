/**
 * Email Management Routes
 *
 * Feature 8: CRUD for user emails. Add/remove/set primary.
 * Feature 9: Email verification via signed JWT token.
 */
import { Hono } from "hono";
import type { Context, Next } from "hono";
import { getDb } from "@logingov/shared/db";
import { eq, and } from "drizzle-orm";
import { userEmails, users } from "@logingov/shared/schema";
import { uuidV7 } from "@logingov/shared/crypto";
import { createQueueMessage } from "@logingov/shared/queue";
import type { EmailVerifyPayload, SETOutboundPayload } from "@logingov/shared/queue";
import { SET_EVENT_TYPES } from "@logingov/shared/types";
import type { Env } from "@logingov/shared/env";

const email = new Hono<{ Bindings: Env }>();

// Middleware: verify the authenticated user matches the :userId URL param
async function requireSameUser(c: Context<{ Bindings: Env }>, next: Next) {
  const requestedUserId = c.req.param("userId");
  const authenticatedUserId = c.req.header("X-User-Id");
  if (!authenticatedUserId) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  if (requestedUserId && requestedUserId !== authenticatedUserId) {
    return c.json({ error: "Forbidden" }, 403);
  }
  await next();
}

// Apply requireSameUser to all routes with :userId param
email.use("/:userId", requireSameUser);
email.use("/:userId/*", requireSameUser);

// ── GET /emails/:userId ─────────────────────────────────────
// List all emails for a user

email.get("/:userId", async (c) => {
  const userId = c.req.param("userId");
  const db = getDb(c.env);

  const emails = await db
    .select()
    .from(userEmails)
    .where(eq(userEmails.userId, userId));

  return c.json({
    emails: emails.map((e: { id: string; userId: string; address: string; isPrimary: boolean; verifiedAt: string | null; createdAt: string }) => ({
      id: e.id,
      address: e.address,
      isPrimary: e.isPrimary,
      verified: !!e.verifiedAt,
      verifiedAt: e.verifiedAt,
      createdAt: e.createdAt,
    })),
  });
});

// ── POST /emails/:userId ────────────────────────────────────
// Add a new email address for the user

email.post("/:userId", async (c) => {
  const userId = c.req.param("userId");
  const body = await c.req.json<{ address: string }>();

  if (!body.address || !isValidEmail(body.address)) {
    return c.json({ error: "invalid_email", message: "A valid email address is required" }, 400);
  }

  const db = getDb(c.env);
  const normalizedAddress = body.address.toLowerCase().trim();

  // Check for duplicate
  const existing = await db
    .select({ id: userEmails.id })
    .from(userEmails)
    .where(eq(userEmails.address, normalizedAddress))
    .limit(1);

  if (existing.length > 0) {
    return c.json({ error: "email_exists", message: "This email address is already registered" }, 409);
  }

  const emailId = uuidV7();
  const now = new Date().toISOString();

  await db.insert(userEmails).values({
    id: emailId,
    userId,
    address: normalizedAddress,
    isPrimary: false,
    verifiedAt: null,
    createdAt: now,
  });

  // Send verification email via queue
  const verificationToken = await createVerificationToken(userId, normalizedAddress, c.env.JWT_SIGNING_KEY, emailId);
  const verifyMessage = createQueueMessage<EmailVerifyPayload>("email:verify", userId, {
    to: normalizedAddress,
    token: verificationToken,
    locale: "en",
  });
  await c.env.QUEUE_EMAIL.send(verifyMessage);

  return c.json(
    {
      id: emailId,
      address: normalizedAddress,
      isPrimary: false,
      verified: false,
      verificationSent: true,
    },
    201
  );
});

// ── DELETE /emails/:userId/:emailId ─────────────────────────
// Remove an email address

email.delete("/:userId/:emailId", async (c) => {
  const userId = c.req.param("userId");
  const emailId = c.req.param("emailId");
  const db = getDb(c.env);

  // Cannot delete primary email
  const [emailRecord] = await db
    .select({ isPrimary: userEmails.isPrimary })
    .from(userEmails)
    .where(and(eq(userEmails.id, emailId), eq(userEmails.userId, userId)))
    .limit(1);

  if (!emailRecord) {
    return c.json({ error: "not_found", message: "Email not found" }, 404);
  }

  if (emailRecord.isPrimary) {
    return c.json(
      { error: "cannot_delete_primary", message: "Cannot delete the primary email address" },
      400
    );
  }

  await db
    .delete(userEmails)
    .where(and(eq(userEmails.id, emailId), eq(userEmails.userId, userId)));

  return c.json({ ok: true, deleted: emailId });
});

// ── PATCH /emails/:userId/:emailId/primary ──────────────────
// Set an email as the primary address

email.patch("/:userId/:emailId/primary", async (c) => {
  const userId = c.req.param("userId");
  const emailId = c.req.param("emailId");
  const db = getDb(c.env);

  // Verify the email exists, belongs to user, and is verified
  const [emailRecord] = await db
    .select({ verifiedAt: userEmails.verifiedAt })
    .from(userEmails)
    .where(and(eq(userEmails.id, emailId), eq(userEmails.userId, userId)))
    .limit(1);

  if (!emailRecord) {
    return c.json({ error: "not_found", message: "Email not found" }, 404);
  }

  if (!emailRecord.verifiedAt) {
    return c.json(
      { error: "not_verified", message: "Email must be verified before it can be set as primary" },
      400
    );
  }

  // Unset all existing primaries for this user
  await db
    .update(userEmails)
    .set({ isPrimary: false })
    .where(eq(userEmails.userId, userId));

  // Set the new primary
  await db
    .update(userEmails)
    .set({ isPrimary: true })
    .where(and(eq(userEmails.id, emailId), eq(userEmails.userId, userId)));

  // Get the old primary email before updating users table
  const [currentUser] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const oldEmail = currentUser?.email ?? "";

  // Also update the main users table email field
  const [newPrimary] = await db
    .select({ address: userEmails.address })
    .from(userEmails)
    .where(eq(userEmails.id, emailId))
    .limit(1);

  if (newPrimary) {
    await db
      .update(users)
      .set({ email: newPrimary.address, updatedAt: new Date().toISOString() })
      .where(eq(users.id, userId));

    // Emit identifier-changed SET if the email actually changed
    if (oldEmail && oldEmail !== newPrimary.address) {
      const setMessage = createQueueMessage<SETOutboundPayload>("set:outbound", userId, {
        targetUrl: "", // resolved by SET consumer per SP
        eventUri: SET_EVENT_TYPES.IDENTIFIER_CHANGED,
        subject: userId,
        claims: {
          "new-value": newPrimary.address,
        },
      });
      await c.env.QUEUE_SET.send(setMessage);
    }
  }

  return c.json({ ok: true, primaryEmailId: emailId });
});

// ── POST /emails/verify ─────────────────────────────────────
// Feature 9: Verify email by checking JWT signature and exp

email.post("/verify", async (c) => {
  const body = await c.req.json<{ token: string }>();
  if (!body.token) {
    return c.json({ error: "missing_token", message: "Verification token is required" }, 400);
  }

  let payload: { userId: string; email: string; emailId: string; exp: number };
  try {
    payload = await verifyVerificationToken(body.token, c.env.JWT_SIGNING_KEY);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid token";
    return c.json({ error: "invalid_token", message }, 400);
  }

  // Check expiration
  if (Date.now() / 1000 > payload.exp) {
    return c.json({ error: "token_expired", message: "Verification token has expired" }, 400);
  }

  const db = getDb(c.env);
  const now = new Date().toISOString();

  // Mark the email as verified — include emailId in the WHERE clause to prevent
  // cross-account confusion (the token is bound to a specific email row)
  const emailIdClause = payload.emailId
    ? and(eq(userEmails.id, payload.emailId), eq(userEmails.userId, payload.userId), eq(userEmails.address, payload.email))
    : and(eq(userEmails.userId, payload.userId), eq(userEmails.address, payload.email));

  const result = await db
    .update(userEmails)
    .set({ verifiedAt: now })
    .where(emailIdClause);

  // If this is the user's primary/first email, update emailVerifiedAt on users table
  const [primaryEmail] = await db
    .select({ isPrimary: userEmails.isPrimary })
    .from(userEmails)
    .where(emailIdClause)
    .limit(1);

  if (primaryEmail?.isPrimary) {
    await db
      .update(users)
      .set({ emailVerifiedAt: now, updatedAt: now })
      .where(eq(users.id, payload.userId));
  }

  return c.json({ ok: true, email: payload.email, verifiedAt: now });
});

// ── POST /emails/:userId/:emailId/resend-verification ───────
// Resend verification email

email.post("/:userId/:emailId/resend-verification", async (c) => {
  const userId = c.req.param("userId");
  const emailId = c.req.param("emailId");
  const db = getDb(c.env);

  const [emailRecord] = await db
    .select({ address: userEmails.address, verifiedAt: userEmails.verifiedAt })
    .from(userEmails)
    .where(and(eq(userEmails.id, emailId), eq(userEmails.userId, userId)))
    .limit(1);

  if (!emailRecord) {
    return c.json({ error: "not_found", message: "Email not found" }, 404);
  }

  if (emailRecord.verifiedAt) {
    return c.json({ error: "already_verified", message: "Email is already verified" }, 400);
  }

  const verificationToken = await createVerificationToken(
    userId,
    emailRecord.address,
    c.env.JWT_SIGNING_KEY,
    emailId
  );
  const verifyMessage = createQueueMessage<EmailVerifyPayload>("email:verify", userId, {
    to: emailRecord.address,
    token: verificationToken,
    locale: "en",
  });
  await c.env.QUEUE_EMAIL.send(verifyMessage);

  return c.json({ ok: true, verificationSent: true });
});

// ── Helpers ─────────────────────────────────────────────────

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Create a signed JWT token for email verification.
 * Uses HMAC-SHA256 — no DB storage needed.
 * Token expires in 24 hours.
 */
async function createVerificationToken(
  userId: string,
  emailAddress: string,
  signingKey: string,
  emailId: string
): Promise<string> {
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    userId,
    email: emailAddress,
    emailId,
    purpose: "email_verification",
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 24 * 60 * 60, // 24h
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

/**
 * Verify a JWT email verification token.
 */
async function verifyVerificationToken(
  token: string,
  signingKey: string
): Promise<{ userId: string; email: string; emailId: string; exp: number }> {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("Malformed token");
  }

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
    (c) => c.charCodeAt(0)
  );

  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    signatureBytes,
    new TextEncoder().encode(signingInput)
  );

  if (!valid) {
    throw new Error("Invalid token signature");
  }

  const payload = JSON.parse(base64UrlDecode(encodedPayload));

  if (payload.purpose !== "email_verification") {
    throw new Error("Invalid token purpose");
  }

  return { userId: payload.userId, email: payload.email, emailId: payload.emailId ?? "", exp: payload.exp };
}

function base64UrlEncode(str: string): string {
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(str: string): string {
  const padded = str + "=".repeat((4 - (str.length % 4)) % 4);
  return atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
}

export { email };
