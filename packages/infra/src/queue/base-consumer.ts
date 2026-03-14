/**
 * Base queue consumer class — generic Cloudflare Queues infrastructure.
 *
 * Provides:
 *  - Batch processing with per-message error handling
 *  - Retry logic with exponential backoff
 *  - Dead-letter handling (log + ack to prevent infinite retry)
 *  - Structured logging with trace context
 */

import type { Env } from "@logingov/shared";
import type { QueueMessage } from "@logingov/shared";

// ── Types ───────────────────────────────────────────────────

export interface ConsumerContext {
  /** For waitUntil() background work */
  waitUntil(promise: Promise<unknown>): void;
}

export interface ConsumerOptions {
  /** Max retries before dead-lettering (default: 3) */
  maxRetries?: number;
  /** Whether to process messages individually or in batch (default: "batch") */
  mode?: "batch" | "individual";
}

// ── Base consumer ───────────────────────────────────────────

export abstract class BaseConsumer<TPayload extends Record<string, unknown> = Record<string, unknown>> {
  abstract readonly queueName: string;
  protected options: Required<ConsumerOptions>;

  constructor(options?: ConsumerOptions) {
    this.options = {
      maxRetries: options?.maxRetries ?? 3,
      mode: options?.mode ?? "batch",
    };
  }

  /**
   * Override this in subclasses to handle a batch of messages.
   */
  abstract processBatch(
    messages: MessageBatch<QueueMessage<TPayload>>,
    env: Env,
    ctx: ConsumerContext
  ): Promise<void>;

  /**
   * Main entry point — called by the Worker's queue handler.
   * Wraps processBatch with error handling, retry logic, and dead-letter.
   */
  async handle(
    batch: MessageBatch<QueueMessage<TPayload>>,
    env: Env,
    ctx: ConsumerContext
  ): Promise<void> {
    if (this.options.mode === "individual") {
      await this.handleIndividual(batch, env, ctx);
    } else {
      await this.handleBatch(batch, env, ctx);
    }
  }

  /**
   * Process the entire batch at once. If it fails, retry all messages.
   */
  private async handleBatch(
    batch: MessageBatch<QueueMessage<TPayload>>,
    env: Env,
    ctx: ConsumerContext
  ): Promise<void> {
    try {
      await this.processBatch(batch, env, ctx);
    } catch (error) {
      this.log("error", `Batch processing failed for ${this.queueName}`, {
        error: error instanceof Error ? error.message : String(error),
        batchSize: batch.messages.length,
      });

      // Retry or dead-letter each message
      for (const msg of batch.messages) {
        if (msg.attempts >= this.options.maxRetries) {
          this.log("error", `Dead-lettering message after ${msg.attempts} attempts`, {
            queue: this.queueName,
            messageId: msg.id,
            type: msg.body.type,
            userId: msg.body.userId,
            traceId: msg.body.traceId,
          });
          // Ack to prevent infinite retry — the error log serves as the dead-letter record
          msg.ack();
        } else {
          msg.retry({ delaySeconds: this.backoffSeconds(msg.attempts) });
        }
      }
    }
  }

  /**
   * Process messages one at a time. Each message succeeds or fails independently.
   */
  private async handleIndividual(
    batch: MessageBatch<QueueMessage<TPayload>>,
    env: Env,
    ctx: ConsumerContext
  ): Promise<void> {
    for (const msg of batch.messages) {
      try {
        // Create a synthetic single-message batch
        const singleBatch = {
          messages: [msg],
          queue: batch.queue,
          retryAll: () => batch.retryAll(),
          ackAll: () => batch.ackAll(),
        } as MessageBatch<QueueMessage<TPayload>>;

        await this.processBatch(singleBatch, env, ctx);
      } catch (error) {
        this.log("error", `Message processing failed`, {
          queue: this.queueName,
          messageId: msg.id,
          attempt: msg.attempts,
          error: error instanceof Error ? error.message : String(error),
          type: msg.body.type,
          traceId: msg.body.traceId,
        });

        if (msg.attempts >= this.options.maxRetries) {
          this.log("error", `Dead-lettering message after ${msg.attempts} attempts`, {
            queue: this.queueName,
            messageId: msg.id,
            type: msg.body.type,
            userId: msg.body.userId,
          });
          msg.ack();
        } else {
          msg.retry({ delaySeconds: this.backoffSeconds(msg.attempts) });
        }
      }
    }
  }

  /**
   * Exponential backoff: 2^attempt seconds (2, 4, 8, 16, ...)
   */
  private backoffSeconds(attempt: number): number {
    return Math.min(2 ** attempt, 300); // Cap at 5 minutes
  }

  /**
   * Structured JSON logging helper.
   */
  protected log(
    level: "info" | "warn" | "error",
    message: string,
    data?: Record<string, unknown>
  ): void {
    console.log(
      JSON.stringify({
        level,
        service: "infra",
        queue: this.queueName,
        message,
        timestamp: new Date().toISOString(),
        ...data,
      })
    );
  }
}
