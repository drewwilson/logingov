/**
 * Feature 7: authorization-fraud-detected SET handler
 * Feature 8: identity-fraud-detected SET handler
 *
 * Queue consumer for QUEUE_FRAUD:
 *   - authorization-fraud: force password reset flag, invalidate all sessions
 *   - identity-fraud: reset user IAL to 1, clear verified PII, emit account-disabled SET
 */
import { eq } from "drizzle-orm";
import type { Env } from "@logingov/shared";
import { users } from "@logingov/shared/schema";
import { kvGet } from "@logingov/shared";
import { SET_EVENT_TYPES } from "@logingov/shared/types";
import type { QueueMessage, FraudActionPayload, SETOutboundPayload } from "@logingov/shared/queue";
import { createQueueMessage } from "@logingov/shared/queue";
import { getDb } from "@logingov/shared/db";

/**
 * Process a single fraud action message from QUEUE_FRAUD.
 */
export async function handleFraudAction(
  message: QueueMessage<FraudActionPayload>,
  env: Env
): Promise<void> {
  const db = getDb(env);
  const { userId, payload } = message;

  switch (payload.action) {
    case "force_password_reset": {
      // Feature 7: Authorization fraud — force password reset + invalidate sessions
      await db
        .update(users)
        .set({
          lockedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(users.id, userId));

      // Invalidate all sessions for this user.
      // Sessions are keyed by sessionId in the DO, so we look up active
      // session IDs from KV (user:<userId>:sessions) and destroy each one.
      await destroyUserSessions(env, userId);

      break;
    }

    case "reset_ial": {
      // Feature 8: Identity fraud — reset IAL to 1, clear PII, emit account-disabled
      await db
        .update(users)
        .set({
          ial: 1,
          ssn: null,
          birthdate: null,
          address: null,
          phone: null,
          verifiedAt: null,
          lockedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(users.id, userId));

      // Invalidate all sessions for this user
      await destroyUserSessions(env, userId);

      // Emit account-disabled SET to all subscribed SPs via QUEUE_SET
      // Note: In a full implementation, we'd look up all SPs subscribed to this user.
      // For now, emit to the SP that reported the fraud if available.
      if (message.spId) {
        const setMessage = createQueueMessage<SETOutboundPayload>(
          "set:outbound",
          userId,
          {
            targetUrl: "", // Will be resolved from SP config during delivery
            eventUri: SET_EVENT_TYPES.ACCOUNT_DISABLED,
            subject: userId,
            claims: {
              reason: "identity-fraud-detected",
              sourceEventId: payload.sourceEventId,
            },
          },
          { spId: message.spId, eventType: SET_EVENT_TYPES.ACCOUNT_DISABLED }
        );
        await env.QUEUE_SET.send(setMessage);
      }

      break;
    }

    case "disable_account": {
      // Lock the account
      await db
        .update(users)
        .set({
          lockedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(users.id, userId));

      // Invalidate all sessions for this user
      await destroyUserSessions(env, userId);

      break;
    }
  }
}

/**
 * Destroy all active sessions for a given user.
 *
 * Sessions are created with SESSION_DO.idFromName(sessionId), not userId.
 * We maintain a KV set of active session IDs per user (user:<userId>:sessions)
 * and destroy each session DO individually.
 */
async function destroyUserSessions(env: Env, userId: string): Promise<void> {
  const sessionListKey = `user:${userId}:sessions`;
  const sessionIds = await kvGet<string[]>(env.KV_SESSIONS, sessionListKey);

  if (sessionIds && sessionIds.length > 0) {
    await Promise.all(
      sessionIds.map(async (sessionId) => {
        try {
          const doId = env.SESSION_DO.idFromName(sessionId);
          const doStub = env.SESSION_DO.get(doId);
          await doStub.fetch(new Request("https://internal/destroy", { method: "DELETE" }));
          // Clean up KV session entry
          await env.KV_SESSIONS.delete(`session:${sessionId}`);
        } catch {
          // Session may already be expired/destroyed — continue with others
        }
      })
    );
    // Clean up the user's session list
    await env.KV_SESSIONS.delete(sessionListKey);
  } else {
    // Fallback: if no session list exists, try destroying by userId directly
    // (backward compatibility with sessions that may have been created with userId)
    try {
      const doId = env.SESSION_DO.idFromName(userId);
      const doStub = env.SESSION_DO.get(doId);
      await doStub.fetch(new Request("https://internal/destroy", { method: "DELETE" }));
    } catch {
      // Best-effort
    }
  }
}
