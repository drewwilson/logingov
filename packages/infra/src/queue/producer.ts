/**
 * Type-safe queue producer helper.
 *
 * Usage:
 *   import { enqueue } from "@logingov/infra";
 *
 *   await enqueue(env.QUEUE_AUDIT, "audit:write", userId, payload, { spId, traceId });
 */

import type {
  QueueMessage,
  QueueMessageType,
  AuditWritePayload,
  EmailSendPayload,
  EmailVerifyPayload,
  SETOutboundPayload,
  FraudActionPayload,
} from "@logingov/shared";
import { createQueueMessage } from "@logingov/shared";

// ── Type map: message type → payload type ───────────────────

interface PayloadTypeMap {
  "audit:write": AuditWritePayload;
  "email:send": EmailSendPayload;
  "email:verify": EmailVerifyPayload;
  "set:outbound": SETOutboundPayload;
  "set:fraud-action": FraudActionPayload;
  "cleanup:expired": Record<string, unknown>;
}

// ── Producer helper ─────────────────────────────────────────

/**
 * Enqueue a typed message to a Cloudflare Queue.
 *
 * @param queue - The Queue binding (e.g., env.QUEUE_AUDIT)
 * @param type - Message type discriminator
 * @param userId - User ID associated with this event
 * @param payload - Typed payload for the message type
 * @param options - Optional spId, eventType, traceId
 *
 * @example
 *   await enqueue(env.QUEUE_AUDIT, "audit:write", userId, {
 *     eventType: "authentication",
 *     ip: "1.2.3.4",
 *     aal: 2,
 *     metadata: { method: "webauthn" },
 *   });
 */
export async function enqueue<T extends QueueMessageType>(
  queue: Queue,
  type: T,
  userId: string,
  payload: T extends keyof PayloadTypeMap ? PayloadTypeMap[T] : Record<string, unknown>,
  options?: { spId?: string; eventType?: string; traceId?: string }
): Promise<void> {
  const message = createQueueMessage(type, userId, payload, options);
  await queue.send(message);
}

/**
 * Enqueue multiple messages in a single batch.
 * More efficient for bulk operations (max 100 messages per batch).
 */
export async function enqueueBatch<T extends QueueMessageType>(
  queue: Queue,
  messages: Array<{
    type: T;
    userId: string;
    payload: T extends keyof PayloadTypeMap ? PayloadTypeMap[T] : Record<string, unknown>;
    options?: { spId?: string; eventType?: string; traceId?: string };
  }>
): Promise<void> {
  const batch = messages.map((m) => ({
    body: createQueueMessage(m.type, m.userId, m.payload, m.options),
  }));

  await queue.sendBatch(batch as Array<{ body: QueueMessage }>);
}
