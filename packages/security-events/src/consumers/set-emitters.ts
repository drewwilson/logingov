/**
 * Features 10-13: SET event emitters
 *
 * Helper functions that publish Security Event Tokens to QUEUE_SET
 * when specific user lifecycle events occur.
 *
 * These are called by other workstreams (account, auth-core) when
 * relevant actions happen. They build the queue message and send it.
 *
 * Feature 10: account-disabled SET — when users.locked_at is set
 * Feature 11: account-purged SET — on account deletion
 * Feature 12: password-reset / recovery-activated SETs — on password change/reset
 * Feature 13: identifier-changed / recycled SETs — on email change/removal
 */
import { eq } from "drizzle-orm";
import type { Env } from "@logingov/shared";
import { serviceProviders } from "@logingov/shared/schema";
import { SET_EVENT_TYPES } from "@logingov/shared/types";
import { buildSETOutboundMessage } from "../lib/set-builder.js";
import { getDb } from "@logingov/shared/db";

interface EmitOptions {
  userId: string;
  subject: string; // pairwise sub
  spId: string;
  env: Env;
}

/**
 * Look up SP's push_notification_url from D1.
 * Returns null if the SP doesn't have one configured.
 */
async function getSpPushUrl(db: ReturnType<typeof getDb>, spId: string): Promise<string | null> {
  const [sp] = await db
    .select({ pushNotificationUrl: serviceProviders.pushNotificationUrl })
    .from(serviceProviders)
    .where(eq(serviceProviders.id, spId))
    .limit(1);
  return sp?.pushNotificationUrl ?? null;
}

// ── Feature 10: Account Disabled ────────────────────────────

/**
 * Emit account-disabled SET when a user's account is locked.
 */
export async function emitAccountDisabled(opts: EmitOptions): Promise<void> {
  const db = getDb(opts.env);
  const pushUrl = await getSpPushUrl(db, opts.spId);
  if (!pushUrl) return;

  const message = buildSETOutboundMessage({
    userId: opts.userId,
    spId: opts.spId,
    targetUrl: pushUrl,
    eventUri: SET_EVENT_TYPES.ACCOUNT_DISABLED,
    subject: opts.subject,
    claims: { reason: "administrative" },
  });

  await opts.env.QUEUE_SET.send(message);
}

// ── Feature 11: Account Purged ──────────────────────────────

/**
 * Emit account-purged SET when a user's account is deleted.
 */
export async function emitAccountPurged(opts: EmitOptions): Promise<void> {
  const db = getDb(opts.env);
  const pushUrl = await getSpPushUrl(db, opts.spId);
  if (!pushUrl) return;

  const message = buildSETOutboundMessage({
    userId: opts.userId,
    spId: opts.spId,
    targetUrl: pushUrl,
    eventUri: SET_EVENT_TYPES.ACCOUNT_PURGED,
    subject: opts.subject,
  });

  await opts.env.QUEUE_SET.send(message);
}

// ── Feature 12: Password Reset / Recovery Activated ─────────

/**
 * Emit recovery-activated SET when a user's password is reset or changed.
 */
export async function emitPasswordReset(opts: EmitOptions): Promise<void> {
  const db = getDb(opts.env);
  const pushUrl = await getSpPushUrl(db, opts.spId);
  if (!pushUrl) return;

  const message = buildSETOutboundMessage({
    userId: opts.userId,
    spId: opts.spId,
    targetUrl: pushUrl,
    eventUri: SET_EVENT_TYPES.PASSWORD_RESET,
    subject: opts.subject,
    claims: { event_type: "password-reset" },
  });

  await opts.env.QUEUE_SET.send(message);
}

// ── Feature 13: Identifier Changed / Recycled ───────────────

/**
 * Emit identifier-changed SET when a user's email address changes.
 */
export async function emitIdentifierChanged(
  opts: EmitOptions & { newEmail: string; oldEmail: string }
): Promise<void> {
  const db = getDb(opts.env);
  const pushUrl = await getSpPushUrl(db, opts.spId);
  if (!pushUrl) return;

  const message = buildSETOutboundMessage({
    userId: opts.userId,
    spId: opts.spId,
    targetUrl: pushUrl,
    eventUri: SET_EVENT_TYPES.IDENTIFIER_CHANGED,
    subject: opts.subject,
    claims: {
      "new-value": opts.newEmail,
    },
  });

  await opts.env.QUEUE_SET.send(message);
}

/**
 * Emit identifier-recycled SET when a user's email is removed/recycled.
 */
export async function emitIdentifierRecycled(
  opts: EmitOptions & { email: string }
): Promise<void> {
  const db = getDb(opts.env);
  const pushUrl = await getSpPushUrl(db, opts.spId);
  if (!pushUrl) return;

  const message = buildSETOutboundMessage({
    userId: opts.userId,
    spId: opts.spId,
    targetUrl: pushUrl,
    eventUri: SET_EVENT_TYPES.IDENTIFIER_RECYCLED,
    subject: opts.subject,
    claims: {
      email: opts.email,
    },
  });

  await opts.env.QUEUE_SET.send(message);
}
