/**
 * Email/SMS queue consumer.
 *
 * Receives EmailSendPayload messages from QUEUE_EMAIL.
 * - Routes "sms_otp" templates to Twilio SMS delivery.
 * - Stubs all other templates for future email integration.
 */

import type { Env } from "@logingov/shared";
import type { QueueMessage, EmailSendPayload } from "@logingov/shared";
import { BaseConsumer, type ConsumerContext } from "../queue/base-consumer.js";
import { sendSMS } from "../sms/twilio.js";

export class EmailConsumer extends BaseConsumer<EmailSendPayload> {
  readonly queueName = "QUEUE_EMAIL";

  async processBatch(
    messages: MessageBatch<QueueMessage<EmailSendPayload>>,
    env: Env,
    ctx: ConsumerContext
  ): Promise<void> {
    for (const msg of messages.messages) {
      try {
        const { payload, userId, traceId } = msg.body;
        const { template, to, locale, variables } = payload;

        if (template === "sms_otp") {
          const smsBody =
            `Your login.gov verification code is: ${variables.code}. ` +
            `It expires in ${variables.expiry_minutes} minutes.`;

          const result = await sendSMS(env, to, smsBody);

          this.log("info", `SMS sent via Twilio`, {
            sid: result.sid,
            status: result.status,
            userId,
            traceId,
          });
        } else {
          // SEC-PII-07: Do not log PII (email, phone, OTP codes)
          this.log("info", `[EMAIL STUB] template=${template} locale=${locale}`, {
            userId,
            traceId,
          });
        }

        msg.ack();
      } catch (error) {
        this.log("error", `Failed to process email/SMS message`, {
          messageId: msg.id,
          attempt: msg.attempts,
          error: error instanceof Error ? error.message : String(error),
          traceId: msg.body.traceId,
        });

        if (msg.attempts >= 3) {
          this.log("error", `Dead-lettering email message after ${msg.attempts} attempts`, {
            messageId: msg.id,
            userId: msg.body.userId,
            template: msg.body.payload.template,
          });
          msg.ack();
        } else {
          msg.retry();
        }
      }
    }
  }
}

// Singleton export
export const emailConsumer = new EmailConsumer();
