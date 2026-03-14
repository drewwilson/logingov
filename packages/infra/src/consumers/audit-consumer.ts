/**
 * Audit log queue consumer.
 *
 * Receives AuditWritePayload messages from QUEUE_AUDIT.
 * - Writes each event to identity_events table via Drizzle.
 * - Streams events to R2_AUDIT as JSON Lines, partitioned by date.
 */

import { getDb } from "@logingov/shared/db";
import type { Env } from "@logingov/shared";
import { identityEvents, uuidV7 } from "@logingov/shared";
import type { QueueMessage, AuditWritePayload } from "@logingov/shared";
import { BaseConsumer, type ConsumerContext } from "../queue/base-consumer.js";

export class AuditConsumer extends BaseConsumer<AuditWritePayload> {
  readonly queueName = "QUEUE_AUDIT";

  async processBatch(
    messages: MessageBatch<QueueMessage<AuditWritePayload>>,
    env: Env,
    ctx: ConsumerContext
  ): Promise<void> {
    const db = getDb(env);
    const now = new Date();

    // Group messages for batch insert and R2 append
    const rows: (typeof identityEvents.$inferInsert)[] = [];
    const jsonlLines: string[] = [];

    for (const msg of messages.messages) {
      const data = msg.body;
      const eventId = uuidV7();
      const createdAt = data.timestamp || now.toISOString();

      rows.push({
        id: eventId,
        userId: data.userId,
        spId: data.spId ?? null,
        eventType: data.payload.eventType,
        ial: data.payload.ial ?? null,
        aal: data.payload.aal ?? null,
        ip: data.payload.ip,
        metadata: data.payload.metadata,
        createdAt,
      });

      jsonlLines.push(
        JSON.stringify({
          id: eventId,
          userId: data.userId,
          spId: data.spId,
          eventType: data.payload.eventType,
          ial: data.payload.ial,
          aal: data.payload.aal,
          ip: data.payload.ip,
          metadata: data.payload.metadata,
          traceId: data.traceId,
          createdAt,
        })
      );
    }

    // Write to D1 in a batch
    if (rows.length > 0) {
      await db.insert(identityEvents).values(rows);
    }

    // Append to R2 JSON Lines file, partitioned by date
    if (jsonlLines.length > 0) {
      await appendToR2Audit(env.R2_AUDIT, now, jsonlLines);
    }

    // Ack all messages
    for (const msg of messages.messages) {
      msg.ack();
    }

    this.log("info", `Processed ${messages.messages.length} audit events`, {
      date: formatDatePath(now),
    });
  }
}

// ── R2 append helper ────────────────────────────────────────

/**
 * Write audit lines to R2 as a unique file per batch.
 * Each batch gets its own file keyed by a random UUID, eliminating the
 * read-modify-write race condition of the previous append approach.
 *
 * R2 key pattern: audit/YYYY/MM/DD/<batchId>.jsonl
 */
async function appendToR2Audit(bucket: R2Bucket, date: Date, lines: string[]): Promise<void> {
  const batchId = crypto.randomUUID();
  const key = `audit/${formatDatePath(date)}/${batchId}.jsonl`;
  const newContent = lines.join("\n") + "\n";

  await bucket.put(key, newContent, {
    httpMetadata: { contentType: "application/x-ndjson" },
    customMetadata: { lastUpdated: new Date().toISOString() },
  });
}

function formatDatePath(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}/${m}/${d}`;
}

// Singleton export
export const auditConsumer = new AuditConsumer();
