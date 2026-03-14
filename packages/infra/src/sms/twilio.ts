/**
 * Twilio SMS helper — sends SMS via the Twilio Messages REST API.
 */

import type { Env } from "@logingov/shared";

type TwilioEnv = Pick<Env, "TWILIO_ACCOUNT_SID" | "TWILIO_AUTH_TOKEN" | "TWILIO_FROM_NUMBER">;

/**
 * Send an SMS message via the Twilio REST API.
 *
 * @param env  - Environment bindings containing Twilio credentials
 * @param to   - Recipient phone number in E.164 format
 * @param body - SMS message body
 * @returns    - Twilio message SID and status
 */
export async function sendSMS(
  env: TwilioEnv,
  to: string,
  body: string
): Promise<{ sid: string; status: string }> {
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER } = env;

  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;

  const credentials = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);

  const params = new URLSearchParams({
    To: to,
    From: TWILIO_FROM_NUMBER,
    Body: body,
  });

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  if (!response.ok) {
    // SEC-PII-07 / SEC-ERR-02: Do not include Twilio error body
    // (may contain phone numbers or account details)
    throw new Error(
      `Twilio API error (HTTP ${response.status})`
    );
  }

  const result = (await response.json()) as { sid: string; status: string };
  return { sid: result.sid, status: result.status };
}
