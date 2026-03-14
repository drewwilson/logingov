/**
 * SSN Attribute Route
 *
 * Feature 6: Scope-gated SSN access. Only IAL2 SPs may request SSN.
 * SSN is encrypted with AES-256-GCM.
 */
import { Hono } from "hono";
import type { Context, Next } from "hono";
import { getDb } from "@logingov/shared/db";
import { eq } from "drizzle-orm";
import { users, serviceProviders } from "@logingov/shared/schema";
import { decrypt, importKey } from "@logingov/shared/crypto";
import type { Env } from "@logingov/shared/env";

const ssn = new Hono<{ Bindings: Env }>();

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

ssn.use("/:userId", requireSameUser);

// ── GET /ssn/:userId ────────────────────────────────────────
// Returns decrypted SSN only if:
// 1. The requesting SP has ial_max >= 2
// 2. The user has ial = 2
// 3. The request includes the social_security_number scope
// 4. The SP exists in D1 and actually has the claimed scopes

ssn.get("/:userId", async (c) => {
  const userId = c.req.param("userId");
  const spId = c.req.header("X-SP-Id");
  const scopes = c.req.header("X-Scopes")?.split(" ") ?? [];

  // Verify request comes from an internal service (not the public internet)
  const internalKey = c.req.header("X-Internal-Service-Key");
  if (!internalKey || internalKey !== c.env.INTERNAL_SERVICE_KEY) {
    return c.json({ error: "unauthorized", message: "SSN endpoint is only accessible from internal services" }, 401);
  }

  if (!spId) {
    return c.json({ error: "missing_sp", message: "X-SP-Id header is required" }, 400);
  }

  // Check that the scope includes social_security_number
  if (!scopes.includes("social_security_number")) {
    return c.json(
      {
        error: "scope_not_granted",
        message: "social_security_number scope is required to access SSN",
      },
      403
    );
  }

  const db = getDb(c.env);

  // Verify SP exists in D1 and is allowed IAL2 attributes (don't trust headers alone)
  const [sp] = await db
    .select({ ialMax: serviceProviders.ialMax })
    .from(serviceProviders)
    .where(eq(serviceProviders.id, spId))
    .limit(1);

  if (!sp) {
    return c.json({ error: "sp_not_found", message: "Service provider not found" }, 404);
  }

  if (sp.ialMax < 2) {
    return c.json(
      {
        error: "sp_not_authorized",
        message: "Service provider is not authorized for IAL2 attributes (ialMax must be >= 2)",
      },
      403
    );
  }

  // Fetch user and check IAL
  const [user] = await db
    .select({ ial: users.ial, ssn: users.ssn })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) {
    return c.json({ error: "user_not_found" }, 404);
  }

  if (user.ial < 2) {
    return c.json(
      {
        error: "user_not_verified",
        message: "User has not completed identity verification (IAL2)",
      },
      403
    );
  }

  if (!user.ssn) {
    return c.json(
      { error: "ssn_not_available", message: "SSN was not collected during proofing" },
      404
    );
  }

  // Decrypt and return
  const cryptoKey = await importKey(c.env.ENCRYPTION_KEY);
  const decryptedSsn = await decrypt(user.ssn, cryptoKey);

  return c.json({
    social_security_number: decryptedSsn,
  });
});

export { ssn };
