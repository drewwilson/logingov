/**
 * Shared SET (Security Event Token) builder helpers.
 *
 * Used by features 10-13 to construct queue messages for outbound SETs.
 */
import type { SETOutboundPayload } from "@logingov/shared/queue";
import { createQueueMessage, type QueueMessage } from "@logingov/shared/queue";

export interface SETMessageOptions {
  userId: string;
  spId: string;
  targetUrl: string;
  eventUri: string;
  subject: string; // pairwise sub
  claims?: Record<string, unknown>;
}

/**
 * Build a typed queue message for outbound SET delivery.
 */
export function buildSETOutboundMessage(
  opts: SETMessageOptions
): QueueMessage<SETOutboundPayload> {
  return createQueueMessage<SETOutboundPayload>(
    "set:outbound",
    opts.userId,
    {
      targetUrl: opts.targetUrl,
      eventUri: opts.eventUri,
      subject: opts.subject,
      claims: opts.claims ?? {},
    },
    { spId: opts.spId, eventType: opts.eventUri }
  );
}
