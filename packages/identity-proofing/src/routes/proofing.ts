/**
 * Identity Proofing Routes
 *
 * Features:
 * - IAL2 document verification (Persona API)
 * - IAL2 with facial match
 * - verified_at timestamp management
 * - Re-proofing flow
 */
import { Hono } from "hono";
import type { Context, Next } from "hono";
import { getDb } from "@logingov/shared/db";
import { eq } from "drizzle-orm";
import { users } from "@logingov/shared/schema";
import { encrypt, importKey, uuidV7 } from "@logingov/shared/crypto";
import { createQueueMessage } from "@logingov/shared/queue";
import type { SETOutboundPayload } from "@logingov/shared/queue";
import { SET_EVENT_TYPES } from "@logingov/shared/types";
import type { Env } from "@logingov/shared/env";
import { PersonaClient, PersonaApiError } from "../lib/persona.js";

const proofing = new Hono<{ Bindings: Env }>();

// Middleware: verify the authenticated user matches the :userId URL param
async function requireSameUser(c: Context<{ Bindings: Env }>, next: Next) {
  const requestedUserId = c.req.param("userId");
  const authenticatedUserId = c.req.header("X-User-Id");
  if (!authenticatedUserId) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  if (requestedUserId && requestedUserId !== authenticatedUserId) {
    return c.json({ error: "Forbidden" }, 403);
  }
  await next();
}

// Apply requireSameUser to routes with :userId param
proofing.use("/verified-at/:userId", requireSameUser);

// ── POST /proofing/document/upload ──────────────────────────
// Accept document image upload, store in R2_PROOFING

proofing.post("/document/upload", async (c) => {
  const userId = c.req.header("X-User-Id");
  if (!userId) {
    return c.json({ error: "unauthorized", message: "Missing user context" }, 401);
  }

  const contentType = c.req.header("Content-Type") ?? "";
  if (!contentType.startsWith("image/") && !contentType.startsWith("application/pdf")) {
    return c.json(
      { error: "invalid_content_type", message: "Document must be an image or PDF" },
      400
    );
  }

  const body = await c.req.arrayBuffer();
  if (body.byteLength === 0) {
    return c.json({ error: "empty_body", message: "No document data provided" }, 400);
  }

  // Max 10MB
  if (body.byteLength > 10 * 1024 * 1024) {
    return c.json({ error: "too_large", message: "Document exceeds 10MB limit" }, 413);
  }

  const docId = uuidV7();
  const extension = contentType.includes("pdf") ? "pdf" : "img";
  const key = `${userId}/${docId}.${extension}`;

  await c.env.R2_PROOFING.put(key, body, {
    httpMetadata: { contentType },
    customMetadata: { userId, uploadedAt: new Date().toISOString() },
  });

  return c.json({ documentId: docId, key, uploadedAt: new Date().toISOString() }, 201);
});

// ── POST /proofing/start ────────────────────────────────────
// Create a Persona inquiry and bind it to the requesting user

proofing.post("/start", async (c) => {
  const userId = c.req.header("X-User-Id");
  if (!userId) {
    return c.json({ error: "unauthorized", message: "Missing user context" }, 401);
  }

  const body = await c.req.json<{ templateId: string }>();
  if (!body.templateId) {
    return c.json({ error: "missing_template_id", message: "templateId is required" }, 400);
  }

  const persona = new PersonaClient(c.env.PERSONA_API_KEY);
  const inquiry = await persona.createInquiry(body.templateId, userId);

  // Store the mapping inquiryId -> userId in KV (TTL: 24h)
  await c.env.KV_SESSIONS.put(`persona_inquiry:${inquiry.inquiryId}`, userId, {
    expirationTtl: 86400,
  });

  return c.json({
    inquiryId: inquiry.inquiryId,
    sessionToken: inquiry.sessionToken,
  }, 201);
});

// ── POST /proofing/verify ───────────────────────────────────
// Feature 2: IAL2 document verification via Persona API

proofing.post("/verify", async (c) => {
  const userId = c.req.header("X-User-Id");
  if (!userId) {
    return c.json({ error: "unauthorized", message: "Missing user context" }, 401);
  }

  const body = await c.req.json<{ inquiryId: string }>();
  if (!body.inquiryId) {
    return c.json({ error: "missing_inquiry_id", message: "inquiryId is required" }, 400);
  }

  // Verify the inquiry was created for this user
  const boundUserId = await c.env.KV_SESSIONS.get(`persona_inquiry:${body.inquiryId}`);
  if (!boundUserId || boundUserId !== userId) {
    return c.json(
      { error: "inquiry_mismatch", message: "This inquiry was not created for the requesting user" },
      403
    );
  }

  const persona = new PersonaClient(c.env.PERSONA_API_KEY);

  let verification;
  try {
    verification = await persona.getInquiry(body.inquiryId);
  } catch (err) {
    if (err instanceof PersonaApiError) {
      return c.json(
        {
          error: "persona_error",
          message: `Persona API returned status ${err.status}`,
          details: err.errors,
        },
        502
      );
    }
    throw err;
  }

  if (verification.status !== "completed") {
    return c.json(
      {
        error: "verification_incomplete",
        message: `Inquiry status: ${verification.status}`,
        status: verification.status,
      },
      422
    );
  }

  // Encrypt PII with AES-256-GCM and write to D1
  const cryptoKey = await importKey(c.env.ENCRYPTION_KEY);
  const now = new Date().toISOString();

  const encryptedSsn = verification.fields.ssn
    ? await encrypt(verification.fields.ssn, cryptoKey)
    : null;
  const encryptedBirthdate = await encrypt(verification.fields.birthdate, cryptoKey);
  const encryptedAddress = await encrypt(
    JSON.stringify({
      street: verification.fields.addressStreet,
      city: verification.fields.addressCity,
      state: verification.fields.addressState,
      postalCode: verification.fields.addressPostalCode,
      countryCode: verification.fields.addressCountryCode,
    }),
    cryptoKey
  );

  const db = getDb(c.env);
  await db
    .update(users)
    .set({
      ial: 2,
      ssn: encryptedSsn,
      birthdate: encryptedBirthdate,
      address: encryptedAddress,
      verifiedAt: now,
      updatedAt: now,
    })
    .where(eq(users.id, userId));

  return c.json({
    ok: true,
    ial: 2,
    verifiedAt: now,
    verifiedAtEpoch: Math.floor(new Date(now).getTime() / 1000),
  });
});

// ── POST /proofing/verify-with-facial-match ─────────────────
// Feature 3: IAL2 with facial match via Persona biometric API

proofing.post("/verify-with-facial-match", async (c) => {
  const userId = c.req.header("X-User-Id");
  if (!userId) {
    return c.json({ error: "unauthorized", message: "Missing user context" }, 401);
  }

  const body = await c.req.json<{ inquiryId: string }>();
  if (!body.inquiryId) {
    return c.json({ error: "missing_inquiry_id", message: "inquiryId is required" }, 400);
  }

  // Verify the inquiry was created for this user
  const boundUserId = await c.env.KV_SESSIONS.get(`persona_inquiry:${body.inquiryId}`);
  if (!boundUserId || boundUserId !== userId) {
    return c.json(
      { error: "inquiry_mismatch", message: "This inquiry was not created for the requesting user" },
      403
    );
  }

  const persona = new PersonaClient(c.env.PERSONA_API_KEY);

  // Step 1: Get document verification result
  let verification;
  try {
    verification = await persona.getInquiry(body.inquiryId);
  } catch (err) {
    if (err instanceof PersonaApiError) {
      return c.json(
        { error: "persona_error", message: `Document verification failed: ${err.message}` },
        502
      );
    }
    throw err;
  }

  if (verification.status !== "completed") {
    return c.json(
      {
        error: "verification_incomplete",
        message: `Document inquiry status: ${verification.status}`,
        status: verification.status,
      },
      422
    );
  }

  // Step 2: Get facial match verification
  let facialMatchResult;
  try {
    const verifications = await persona.listVerifications(body.inquiryId);
    const selfieVerification = verifications.find(
      (v) =>
        v.type === "verification/selfie" ||
        v.type === "verification/selfie-id-comparison"
    );

    if (!selfieVerification) {
      return c.json(
        { error: "no_facial_match", message: "No facial match verification found for this inquiry" },
        422
      );
    }

    facialMatchResult = await persona.getFacialMatchResult(selfieVerification.id);
  } catch (err) {
    if (err instanceof PersonaApiError) {
      return c.json(
        { error: "persona_error", message: `Facial match verification failed: ${err.message}` },
        502
      );
    }
    throw err;
  }

  if (facialMatchResult.status !== "passed") {
    return c.json(
      {
        error: "facial_match_failed",
        message: "Facial match verification did not pass",
        facialMatchStatus: facialMatchResult.status,
      },
      422
    );
  }

  // Step 3: Encrypt PII and write to D1
  const cryptoKey = await importKey(c.env.ENCRYPTION_KEY);
  const now = new Date().toISOString();

  const encryptedSsn = verification.fields.ssn
    ? await encrypt(verification.fields.ssn, cryptoKey)
    : null;
  const encryptedBirthdate = await encrypt(verification.fields.birthdate, cryptoKey);
  const encryptedAddress = await encrypt(
    JSON.stringify({
      street: verification.fields.addressStreet,
      city: verification.fields.addressCity,
      state: verification.fields.addressState,
      postalCode: verification.fields.addressPostalCode,
      countryCode: verification.fields.addressCountryCode,
    }),
    cryptoKey
  );

  const db = getDb(c.env);
  await db
    .update(users)
    .set({
      ial: 2,
      ssn: encryptedSsn,
      birthdate: encryptedBirthdate,
      address: encryptedAddress,
      verifiedAt: now,
      updatedAt: now,
    })
    .where(eq(users.id, userId));

  return c.json({
    ok: true,
    ial: 2,
    verifiedAt: now,
    verifiedAtEpoch: Math.floor(new Date(now).getTime() / 1000),
    facialMatch: {
      status: facialMatchResult.status,
      completedAt: facialMatchResult.completedAt,
    },
  });
});

// ── GET /proofing/verified-at/:userId ───────────────────────
// Feature 4: Return verified_at as Unix epoch (OIDC) or ISO 8601 (SAML)

proofing.get("/verified-at/:userId", async (c) => {
  const userId = c.req.param("userId");
  const format = c.req.query("format") ?? "oidc"; // oidc | saml

  const db = getDb(c.env);
  const [user] = await db
    .select({ verifiedAt: users.verifiedAt, ial: users.ial })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) {
    return c.json({ error: "user_not_found" }, 404);
  }

  if (!user.verifiedAt) {
    return c.json({ verified: false, verifiedAt: null });
  }

  if (format === "saml") {
    return c.json({
      verified: true,
      verifiedAt: user.verifiedAt, // ISO 8601
      ial: user.ial,
    });
  }

  // Default: OIDC format — Unix epoch
  return c.json({
    verified: true,
    verified_at: Math.floor(new Date(user.verifiedAt).getTime() / 1000),
    ial: user.ial,
  });
});

// ── POST /proofing/reproof ──────────────────────────────────
// Feature 5: Re-proofing flow for users who already have IAL2

proofing.post("/reproof", async (c) => {
  const userId = c.req.header("X-User-Id");
  if (!userId) {
    return c.json({ error: "unauthorized", message: "Missing user context" }, 401);
  }

  const body = await c.req.json<{ inquiryId: string; facialMatch?: boolean }>();
  if (!body.inquiryId) {
    return c.json({ error: "missing_inquiry_id", message: "inquiryId is required" }, 400);
  }

  // Verify the inquiry was created for this user
  const boundUserId = await c.env.KV_SESSIONS.get(`persona_inquiry:${body.inquiryId}`);
  if (!boundUserId || boundUserId !== userId) {
    return c.json(
      { error: "inquiry_mismatch", message: "This inquiry was not created for the requesting user" },
      403
    );
  }

  const db = getDb(c.env);

  // Check if user already has IAL2
  const [user] = await db
    .select({ ial: users.ial, verifiedAt: users.verifiedAt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) {
    return c.json({ error: "user_not_found" }, 404);
  }

  if (user.ial !== 2) {
    return c.json(
      {
        error: "not_previously_proofed",
        message: "User has not been previously proofed. Use /proofing/verify instead.",
      },
      400
    );
  }

  const persona = new PersonaClient(c.env.PERSONA_API_KEY);

  // Run full proofing again
  let verification;
  try {
    verification = await persona.getInquiry(body.inquiryId);
  } catch (err) {
    if (err instanceof PersonaApiError) {
      return c.json(
        { error: "persona_error", message: `Re-proofing verification failed: ${err.message}` },
        502
      );
    }
    throw err;
  }

  if (verification.status !== "completed") {
    return c.json(
      {
        error: "verification_incomplete",
        message: `Inquiry status: ${verification.status}`,
      },
      422
    );
  }

  // If facial match requested, verify it
  if (body.facialMatch) {
    try {
      const verifications = await persona.listVerifications(body.inquiryId);
      const selfieVerification = verifications.find(
        (v) =>
          v.type === "verification/selfie" ||
          v.type === "verification/selfie-id-comparison"
      );
      if (selfieVerification) {
        const facialResult = await persona.getFacialMatchResult(selfieVerification.id);
        if (facialResult.status !== "passed") {
          return c.json(
            { error: "facial_match_failed", message: "Facial match did not pass during re-proofing" },
            422
          );
        }
      }
    } catch (err) {
      if (err instanceof PersonaApiError) {
        return c.json({ error: "persona_error", message: `Facial match failed: ${err.message}` }, 502);
      }
      throw err;
    }
  }

  // Update PII with new proofing data
  const cryptoKey = await importKey(c.env.ENCRYPTION_KEY);
  const now = new Date().toISOString();

  const encryptedSsn = verification.fields.ssn
    ? await encrypt(verification.fields.ssn, cryptoKey)
    : null;
  const encryptedBirthdate = await encrypt(verification.fields.birthdate, cryptoKey);
  const encryptedAddress = await encrypt(
    JSON.stringify({
      street: verification.fields.addressStreet,
      city: verification.fields.addressCity,
      state: verification.fields.addressState,
      postalCode: verification.fields.addressPostalCode,
      countryCode: verification.fields.addressCountryCode,
    }),
    cryptoKey
  );

  await db
    .update(users)
    .set({
      ssn: encryptedSsn,
      birthdate: encryptedBirthdate,
      address: encryptedAddress,
      verifiedAt: now,
      updatedAt: now,
    })
    .where(eq(users.id, userId));

  // Emit reproof-completed SET via QUEUE_SET
  const setMessage = createQueueMessage<SETOutboundPayload>("set:outbound", userId, {
    targetUrl: "", // will be resolved by SET consumer per SP
    eventUri: SET_EVENT_TYPES.REPROOF_COMPLETED,
    subject: userId,
    claims: {
      previousVerifiedAt: user.verifiedAt,
      newVerifiedAt: now,
    },
  });

  await c.env.QUEUE_SET.send(setMessage);

  return c.json({
    ok: true,
    ial: 2,
    verifiedAt: now,
    verifiedAtEpoch: Math.floor(new Date(now).getTime() / 1000),
    reproofed: true,
    previousVerifiedAt: user.verifiedAt,
  });
});

export { proofing };
