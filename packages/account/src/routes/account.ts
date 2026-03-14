/**
 * Account Management Routes
 *
 * Feature 11: Account deletion — hard delete with SET event.
 */
import { Hono } from "hono";
import type { Context, Next } from "hono";
import { getDb } from "@logingov/shared/db";
import { eq } from "drizzle-orm";
import { users, credentials, userEmails } from "@logingov/shared/schema";
import { createQueueMessage } from "@logingov/shared/queue";
import type { SETOutboundPayload } from "@logingov/shared/queue";
import { SET_EVENT_TYPES } from "@logingov/shared/types";
import type { Env } from "@logingov/shared/env";
import { importKey, decrypt } from "@logingov/shared/crypto";

const account = new Hono<{ Bindings: Env }>();

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
account.use("/:userId", requireSameUser);
account.use("/:userId/*", requireSameUser);

// ── GET /account/:userId ────────────────────────────────────
// Get account overview (non-PII)

account.get("/:userId", async (c) => {
  const userId = c.req.param("userId");
  const db = getDb(c.env);

  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      emailVerifiedAt: users.emailVerifiedAt,
      ial: users.ial,
      locale: users.locale,
      verifiedAt: users.verifiedAt,
      lockedAt: users.lockedAt,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) {
    return c.json({ error: "not_found", message: "Account not found" }, 404);
  }

  // Decrypt email (stored as AES-256-GCM ciphertext)
  let decryptedEmail = user.email;
  try {
    const encKey = await importKey(c.env.ENCRYPTION_KEY);
    decryptedEmail = await decrypt(user.email, encKey);
  } catch {
    // fallback: email may not yet be encrypted (migration in progress)
  }

  const emails = await db
    .select({
      id: userEmails.id,
      address: userEmails.address,
      isPrimary: userEmails.isPrimary,
      verifiedAt: userEmails.verifiedAt,
    })
    .from(userEmails)
    .where(eq(userEmails.userId, userId));

  const creds = await db
    .select({
      id: credentials.id,
      type: credentials.type,
      lastUsedAt: credentials.lastUsedAt,
      createdAt: credentials.createdAt,
    })
    .from(credentials)
    .where(eq(credentials.userId, userId));

  return c.json({
    ...user,
    email: decryptedEmail,
    emails,
    credentials: creds.map((cr: { id: string; type: string; lastUsedAt: string | null; createdAt: string }) => ({
      id: cr.id,
      type: cr.type,
      lastUsedAt: cr.lastUsedAt,
      createdAt: cr.createdAt,
    })),
  });
});

// ── DELETE /account/:userId ─────────────────────────────────
// Hard delete: remove user, credentials, and emails.
// Emit account-purged SET via QUEUE_SET.

account.delete("/:userId", async (c) => {
  const userId = c.req.param("userId");
  const requestingUserId = c.req.header("X-User-Id");

  // Only the user themselves can delete their account
  if (requestingUserId !== userId) {
    return c.json(
      { error: "forbidden", message: "Can only delete your own account" },
      403
    );
  }

  const db = getDb(c.env);

  // Verify user exists
  const [user] = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) {
    return c.json({ error: "not_found", message: "Account not found" }, 404);
  }

  // Hard delete atomically: credentials -> user_emails -> users
  await db.transaction(async (tx) => {
    await tx.delete(credentials).where(eq(credentials.userId, userId));
    await tx.delete(userEmails).where(eq(userEmails.userId, userId));
    await tx.delete(users).where(eq(users.id, userId));
  });

  // Clean up R2 proofing documents
  try {
    const listed = await c.env.R2_PROOFING.list({ prefix: `${userId}/` });
    for (const obj of listed.objects) {
      await c.env.R2_PROOFING.delete(obj.key);
    }
  } catch {
    // Non-fatal: proofing docs may not exist
  }

  // Emit account-purged SET
  const setMessage = createQueueMessage<SETOutboundPayload>("set:outbound", userId, {
    targetUrl: "", // resolved by SET consumer per SP
    eventUri: SET_EVENT_TYPES.ACCOUNT_PURGED,
    subject: userId,
    claims: {
      purgedAt: new Date().toISOString(),
    },
  });
  await c.env.QUEUE_SET.send(setMessage);

  return c.json({ ok: true, purgedAt: new Date().toISOString() });
});

export { account };
