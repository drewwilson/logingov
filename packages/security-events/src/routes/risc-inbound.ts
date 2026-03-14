/**
 * Feature 6: RISC SET submission (inbound) — /api/risc/security_events
 *
 * Validates a signed JWT (Security Event Token) from an SP using jose.
 * Verifies the signature against the SP's registered public key.
 * Writes to identity_events table.
 * Publishes fraud action to QUEUE_FRAUD.
 */
import { Hono } from "hono";
import * as jose from "jose";
import { eq } from "drizzle-orm";
import type { Env } from "@logingov/shared";
import { serviceProviders, identityEvents } from "@logingov/shared/schema";
import { SET_EVENT_TYPES } from "@logingov/shared/types";
import { uuidV7 } from "@logingov/shared/crypto";
import { createQueueMessage, type FraudActionPayload } from "@logingov/shared/queue";
import { AppError, errorResponse, jsonResponse } from "@logingov/shared/errors";
import { getDb } from "@logingov/shared/db";

const riscInboundRoutes = new Hono<{ Bindings: Env }>();

/** SET event types that trigger fraud queue actions */
const FRAUD_EVENT_TYPES = new Set([
  SET_EVENT_TYPES.AUTHORIZATION_FRAUD,
  SET_EVENT_TYPES.IDENTITY_FRAUD,
  SET_EVENT_TYPES.CREDENTIAL_COMPROMISE,
]);

/** Map SET event type to fraud action */
function mapEventToFraudAction(
  eventType: string
): FraudActionPayload["action"] | null {
  switch (eventType) {
    case SET_EVENT_TYPES.AUTHORIZATION_FRAUD:
      return "force_password_reset";
    case SET_EVENT_TYPES.IDENTITY_FRAUD:
      return "reset_ial";
    case SET_EVENT_TYPES.CREDENTIAL_COMPROMISE:
      return "force_password_reset";
    default:
      return null;
  }
}

riscInboundRoutes.post("/api/risc/security_events", async (c) => {
  try {
    // The body is a JWT (application/secevent+jwt)
    const jwt = await c.req.text();

    if (!jwt || jwt.trim().length === 0) {
      return errorResponse(new AppError("invalid_request", "Empty request body"));
    }

    // Decode header to get issuer without verifying first
    const unverified = jose.decodeJwt(jwt) as jose.JWTPayload;
    const issuer = unverified.iss;

    if (!issuer) {
      return errorResponse(new AppError("invalid_token", "JWT missing iss claim"));
    }

    // Look up SP by issuer URI
    const db = getDb(c.env);
    const [sp] = await db
      .select()
      .from(serviceProviders)
      .where(eq(serviceProviders.id, issuer))
      .limit(1);

    if (!sp) {
      return errorResponse(
        new AppError("invalid_token", "Invalid token", 403)
      );
    }

    // Import SP's public key and verify the JWT
    const publicKey = await jose.importSPKI(sp.publicKey, "RS256");
    const { payload } = await jose.jwtVerify(jwt, publicKey, {
      issuer,
      audience: "https://secure.login.gov",
    });

    // Replay protection: reject SETs without a jti or with a previously-seen jti
    const jti = payload.jti;
    if (!jti) {
      return errorResponse(new AppError("invalid_token", "JWT missing jti claim", 400));
    }
    const jtiKey = `set:jti:${jti}`;
    const seen = await c.env.KV_FLAGS.get(jtiKey);
    if (seen) {
      return c.json({ status: "duplicate" }, 202);
    }
    await c.env.KV_FLAGS.put(jtiKey, "1", { expirationTtl: 86400 }); // 24hr TTL

    // Extract SET events from the payload
    const events = payload.events as Record<string, Record<string, unknown>> | undefined;
    if (!events || Object.keys(events).length === 0) {
      return errorResponse(new AppError("invalid_token", "JWT missing events claim"));
    }

    // Extract subject
    const sub = (payload.sub as string) ?? null;
    if (!sub) {
      return errorResponse(new AppError("invalid_token", "JWT missing sub claim"));
    }

    const ip = c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for") ?? "unknown";
    const eventId = uuidV7();

    // Process each event type in the SET
    for (const [eventType, eventData] of Object.entries(events)) {
      // Write to identity_events table
      await db.insert(identityEvents).values({
        id: eventId,
        userId: sub,
        spId: issuer,
        eventType,
        ip,
        metadata: { ...eventData, jti: payload.jti },
        createdAt: new Date().toISOString(),
      });

      // If this is a fraud-related event, publish to QUEUE_FRAUD
      if ((FRAUD_EVENT_TYPES as Set<string>).has(eventType)) {
        const action = mapEventToFraudAction(eventType);
        if (action) {
          const message = createQueueMessage<FraudActionPayload>(
            "set:fraud-action",
            sub,
            {
              action,
              reason: `Inbound SET: ${eventType}`,
              sourceEventId: eventId,
            },
            { spId: issuer, eventType }
          );
          await c.env.QUEUE_FRAUD.send(message);
        }
      }
    }

    // RFC 8935: return 202 Accepted with empty body
    return new Response(null, { status: 202 });
  } catch (err) {
    if (err instanceof jose.errors.JWSSignatureVerificationFailed) {
      return errorResponse(
        new AppError("invalid_signature", "JWT signature verification failed", 401)
      );
    }
    if (err instanceof jose.errors.JWTExpired) {
      return errorResponse(new AppError("token_expired", "JWT has expired", 401));
    }
    if (err instanceof AppError) {
      return errorResponse(err);
    }
    console.error("[RISC inbound] Error processing SET:", err instanceof Error ? err.message : err);
    return c.json({ error: "internal_error" }, 500);
  }
});

export { riscInboundRoutes };
