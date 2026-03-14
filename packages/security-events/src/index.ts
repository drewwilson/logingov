/**
 * @logingov/security-events Worker
 *
 * RISC (Risk and Incident Sharing and Coordination) implementation
 * for Login.gov. Handles inbound SET validation, outbound SET delivery,
 * fraud action processing, and user lifecycle event emission.
 *
 * Features:
 *   6.  RISC SET submission (inbound)
 *   7.  authorization-fraud-detected handler
 *   8.  identity-fraud-detected handler
 *   9.  RISC SET delivery (outbound)
 *   10. account-disabled SET
 *   11. account-purged SET
 *   12. password-reset / recovery-activated SETs
 *   13. identifier-changed / recycled SETs
 *   14. RISC discovery endpoint
 */
import { Hono } from "hono";
import type { Env } from "@logingov/shared";
import { tracing } from "@logingov/infra";
import type { QueueMessage, FraudActionPayload, SETOutboundPayload } from "@logingov/shared/queue";
import { riscInboundRoutes } from "./routes/risc-inbound.js";
import { riscDiscoveryRoutes } from "./routes/risc-discovery.js";
import { handleFraudAction } from "./consumers/fraud-handler.js";
import { handleSETOutbound } from "./consumers/set-outbound.js";

const app = new Hono<{ Bindings: Env }>();

// ── Middleware ───────────────────────────────────────────────
app.use("*", tracing({ serviceName: "security-events" }));

// ── Health check ────────────────────────────────────────────
app.get("/health", (c) => c.json({ ok: true, service: "security-events" }));

// ── HTTP routes ─────────────────────────────────────────────
app.route("/", riscInboundRoutes);
app.route("/", riscDiscoveryRoutes);

export default {
  /**
   * HTTP request handler (Hono app).
   */
  fetch: app.fetch,

  /**
   * Queue consumer handler.
   * Routes messages to the appropriate handler based on queue name.
   */
  async queue(
    batch: MessageBatch<QueueMessage>,
    env: Env
  ): Promise<void> {
    const MAX_ATTEMPTS = 5;

    for (const msg of batch.messages) {
      try {
        const message = msg.body;

        switch (message.type) {
          case "set:fraud-action":
            await handleFraudAction(
              message as QueueMessage<FraudActionPayload>,
              env
            );
            break;

          case "set:outbound":
            await handleSETOutbound(
              message as QueueMessage<SETOutboundPayload>,
              env
            );
            break;

          default:
            console.warn(
              `[security-events] Unknown message type: ${message.type}`
            );
        }

        msg.ack();
      } catch (err) {
        console.error(
          `[security-events] Error processing message: ${err instanceof Error ? err.message : err}`
        );

        if (msg.attempts < MAX_ATTEMPTS) {
          msg.retry({ delaySeconds: Math.min(30 * Math.pow(2, msg.attempts - 1), 300) });
        } else {
          console.error(
            `[security-events] Dead letter: message exceeded ${MAX_ATTEMPTS} attempts`,
            JSON.stringify(msg.body)
          );
          msg.ack(); // Don't retry forever — ack to prevent infinite loop
        }
      }
    }
  },
};

// Re-export SET emitters for use by other packages
export {
  emitAccountDisabled,
  emitAccountPurged,
  emitPasswordReset,
  emitIdentifierChanged,
  emitIdentifierRecycled,
} from "./consumers/set-emitters.js";
