/**
 * Feature 9: RISC SET delivery (outbound)
 *
 * Queue consumer for QUEUE_SET:
 *   - Signs JWT with jose using Login.gov's private key (with kid from JWKS rotation)
 *   - POSTs to SP push_notification_url
 *   - Single delivery attempt per queue message; retries handled by the queue
 */
import * as jose from "jose";
import { eq } from "drizzle-orm";
import type { Env } from "@logingov/shared";
import { serviceProviders } from "@logingov/shared/schema";
import type { QueueMessage, SETOutboundPayload } from "@logingov/shared/queue";
import { getDb } from "@logingov/shared/db";

const ISSUER = "https://secure.login.gov";

/**
 * Process a single outbound SET message from QUEUE_SET.
 */
export async function handleSETOutbound(
  message: QueueMessage<SETOutboundPayload>,
  env: Env
): Promise<void> {
  const { userId, payload, spId } = message;

  // Resolve the push_notification_url if not set in the payload
  let targetUrl = payload.targetUrl;
  if (!targetUrl && spId) {
    const db = getDb(env);
    const [sp] = await db
      .select()
      .from(serviceProviders)
      .where(eq(serviceProviders.id, spId))
      .limit(1);

    if (!sp?.pushNotificationUrl) {
      console.error(`[SET Outbound] SP ${spId} has no push_notification_url, skipping`);
      return;
    }
    targetUrl = sp.pushNotificationUrl;
  }

  if (!targetUrl) {
    console.error(`[SET Outbound] No target URL for message ${message.traceId}, skipping`);
    return;
  }

  // Import the signing key and resolve the current kid from the key rotation system
  const privateKey = await jose.importPKCS8(env.JWT_SIGNING_KEY, "RS256");

  // Resolve the current kid from JWKS state for key identification
  let kid = "default";
  try {
    const jwksState = await env.KV_JWKS.get("jwks:current", "json") as { meta?: { kid: string }[] } | null;
    if (jwksState?.meta?.[0]?.kid) {
      kid = jwksState.meta[0].kid;
    }
  } catch {
    // Fall back to "default" kid if JWKS state is unavailable
  }

  // Build the SET JWT
  const setPayload: jose.JWTPayload = {
    iss: ISSUER,
    iat: Math.floor(Date.now() / 1000),
    jti: crypto.randomUUID(),
    aud: spId ?? targetUrl,
    sub: payload.subject,
    events: {
      [payload.eventUri]: payload.claims,
    },
  };

  const jwt = await new jose.SignJWT(setPayload)
    .setProtectedHeader({ alg: "RS256", typ: "secevent+jwt", kid })
    .sign(privateKey);

  // Deliver (single attempt — retries are handled by the queue via msg.retry())
  await deliverSET(targetUrl, jwt);
}

/**
 * POST the signed SET JWT to the SP's push notification URL.
 * Single delivery attempt — queue-based retries with backoff replace
 * the previous in-process retry loop to avoid blocking the consumer.
 *
 * Throws on transient failures so the queue message is retried.
 * Does NOT throw on permanent failures (400) to avoid retrying bad requests.
 */
async function deliverSET(url: string, jwt: string): Promise<void> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/secevent+jwt",
      Accept: "application/json",
    },
    body: jwt,
  });

  // 2xx = success (RFC 8935 specifies 202 but accept any 2xx)
  if (response.ok) {
    return;
  }

  // 400 = bad request from our side — permanent failure, don't retry
  if (response.status === 400) {
    const body = await response.text().catch(() => "");
    console.error(`[SET Outbound] SP returned 400 for ${url}: ${body}`);
    return;
  }

  // Transient failure — throw so the queue can retry with backoff
  throw new Error(`SP returned ${response.status} for ${url}`);
}
