/**
 * Shared Queue message envelope.
 * All workstreams produce and consume this format.
 */

export type QueueMessageType =
  | "set:outbound"
  | "set:fraud-action"
  | "email:send"
  | "email:verify"
  | "audit:write"
  | "cleanup:expired";

export interface QueueMessage<T extends Record<string, unknown> = Record<string, unknown>> {
  type: QueueMessageType;
  userId: string;
  spId?: string;
  eventType?: string; // SET event URI for security events
  payload: T;
  timestamp: string; // ISO 8601
  traceId: string; // OpenTelemetry trace propagation
}

// ── Typed payloads per message type ─────────────────────────

export interface EmailSendPayload {
  [key: string]: unknown;
  to: string;
  template: string;
  locale: string;
  variables: Record<string, string>;
}

export interface EmailVerifyPayload {
  [key: string]: unknown;
  to: string;
  token: string;
  locale: string;
}

export interface SETOutboundPayload {
  [key: string]: unknown;
  targetUrl: string; // SP push_notification_url
  eventUri: string; // SET event type URI
  subject: string; // user sub (pairwise)
  claims: Record<string, unknown>;
}

export interface FraudActionPayload {
  [key: string]: unknown;
  action: "force_password_reset" | "reset_ial" | "disable_account";
  reason: string;
  sourceEventId: string;
}

export interface AuditWritePayload {
  [key: string]: unknown;
  eventType: string;
  ip: string;
  ial?: number;
  aal?: number;
  metadata: Record<string, unknown>;
}

// ── Helper to create typed messages ─────────────────────────

export function createQueueMessage<T extends Record<string, unknown>>(
  type: QueueMessageType,
  userId: string,
  payload: T,
  options?: { spId?: string; eventType?: string; traceId?: string }
): QueueMessage<T> {
  return {
    type,
    userId,
    spId: options?.spId,
    eventType: options?.eventType,
    payload,
    timestamp: new Date().toISOString(),
    traceId: options?.traceId ?? crypto.randomUUID(),
  };
}
