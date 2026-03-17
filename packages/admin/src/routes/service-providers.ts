/**
 * Service Provider Partner Portal Routes
 *
 * Feature 12: CRUD for service_providers table.
 * Upload SP public key cert to R2. Manage redirect_uris, ial_max,
 * aal_max, push_notification_url.
 */
import { Hono } from "hono";
import { getDb } from "@logingov/shared/db";
import { eq } from "drizzle-orm";
import { serviceProviders } from "@logingov/shared/schema";
import type { Env } from "@logingov/shared/env";

const sp = new Hono<{ Bindings: Env }>();

// ── GET /service-providers ──────────────────────────────────
// List all service providers

sp.get("/", async (c) => {
  const db = getDb(c.env);
  const providers = await db.select().from(serviceProviders);

  return c.json({
    serviceProviders: providers.map((p: { id: string; name: string; ialMax: number; aalMax: number; redirectUris: string; publicKey: string; samlMetadataUrl: string | null; pushNotificationUrl: string | null; postLogoutRedirectUris: string | null; createdAt: string }) => ({
      ...p,
      redirectUris: JSON.parse(p.redirectUris),
      postLogoutRedirectUris: p.postLogoutRedirectUris ? JSON.parse(p.postLogoutRedirectUris) : null,
    })),
  });
});

// ── GET /service-providers/:spId ────────────────────────────
// Get a single service provider

sp.get("/:spId", async (c) => {
  const spId = c.req.param("spId");
  const db = getDb(c.env);

  const [provider] = await db
    .select()
    .from(serviceProviders)
    .where(eq(serviceProviders.id, spId))
    .limit(1);

  if (!provider) {
    return c.json({ error: "not_found", message: "Service provider not found" }, 404);
  }

  return c.json({
    ...provider,
    redirectUris: JSON.parse(provider.redirectUris),
    postLogoutRedirectUris: provider.postLogoutRedirectUris ? JSON.parse(provider.postLogoutRedirectUris) : null,
  });
});

// ── POST /service-providers ─────────────────────────────────
// Create a new service provider

sp.post("/", async (c) => {
  const body = await c.req.json<{
    id: string; // issuer URI
    name: string;
    agencyId?: string; // FK to agencies.id
    ialMax?: 1 | 2;
    aalMax?: 1 | 2;
    redirectUris: string[];
    publicKey: string; // PEM
    samlMetadataUrl?: string;
    pushNotificationUrl?: string;
    postLogoutRedirectUris?: string[];
  }>();

  // Validation
  if (!body.id || !body.name || !body.redirectUris || !body.publicKey) {
    return c.json(
      { error: "missing_fields", message: "id, name, redirectUris, and publicKey are required" },
      400
    );
  }

  if (!Array.isArray(body.redirectUris) || body.redirectUris.length === 0) {
    return c.json(
      { error: "invalid_redirect_uris", message: "redirectUris must be a non-empty array" },
      400
    );
  }

  // Validate redirect URIs format
  for (const uri of body.redirectUris) {
    try {
      new URL(uri);
    } catch {
      return c.json(
        { error: "invalid_redirect_uri", message: `Invalid redirect URI: ${uri}` },
        400
      );
    }
  }

  // Validate IAL/AAL values
  const ialMax = body.ialMax ?? 1;
  const aalMax = body.aalMax ?? 1;
  if (![1, 2].includes(ialMax) || ![1, 2].includes(aalMax)) {
    return c.json(
      { error: "invalid_assurance_levels", message: "ialMax and aalMax must be 1 or 2" },
      400
    );
  }

  const db = getDb(c.env);

  // Check for duplicate ID
  const existing = await db
    .select({ id: serviceProviders.id })
    .from(serviceProviders)
    .where(eq(serviceProviders.id, body.id))
    .limit(1);

  if (existing.length > 0) {
    return c.json(
      { error: "sp_exists", message: "A service provider with this ID already exists" },
      409
    );
  }

  const now = new Date().toISOString();

  await db.insert(serviceProviders).values({
    id: body.id,
    name: body.name,
    agencyId: body.agencyId ?? null,
    ialMax: ialMax as 1 | 2,
    aalMax: aalMax as 1 | 2,
    redirectUris: JSON.stringify(body.redirectUris),
    publicKey: body.publicKey,
    samlMetadataUrl: body.samlMetadataUrl ?? null,
    pushNotificationUrl: body.pushNotificationUrl ?? null,
    postLogoutRedirectUris: body.postLogoutRedirectUris ? JSON.stringify(body.postLogoutRedirectUris) : null,
    createdAt: now,
  });

  // Also store the public key cert in R2 for archival
  await c.env.R2_KEYS.put(`sp-certs/${body.id}.pem`, body.publicKey, {
    httpMetadata: { contentType: "application/x-pem-file" },
    customMetadata: { spId: body.id, uploadedAt: now },
  });

  return c.json(
    {
      id: body.id,
      name: body.name,
      ialMax,
      aalMax,
      redirectUris: body.redirectUris,
      createdAt: now,
    },
    201
  );
});

// ── PUT /service-providers/:spId ────────────────────────────
// Update a service provider

sp.put("/:spId", async (c) => {
  const spId = c.req.param("spId");
  const body = await c.req.json<{
    name?: string;
    ialMax?: 1 | 2;
    aalMax?: 1 | 2;
    redirectUris?: string[];
    publicKey?: string;
    samlMetadataUrl?: string | null;
    pushNotificationUrl?: string | null;
    postLogoutRedirectUris?: string[] | null;
  }>();

  const db = getDb(c.env);

  // Verify SP exists
  const [existing] = await db
    .select()
    .from(serviceProviders)
    .where(eq(serviceProviders.id, spId))
    .limit(1);

  if (!existing) {
    return c.json({ error: "not_found", message: "Service provider not found" }, 404);
  }

  // Validate redirect URIs if provided
  if (body.redirectUris) {
    if (!Array.isArray(body.redirectUris) || body.redirectUris.length === 0) {
      return c.json(
        { error: "invalid_redirect_uris", message: "redirectUris must be a non-empty array" },
        400
      );
    }
    for (const uri of body.redirectUris) {
      try {
        new URL(uri);
      } catch {
        return c.json(
          { error: "invalid_redirect_uri", message: `Invalid redirect URI: ${uri}` },
          400
        );
      }
    }
  }

  // Validate IAL/AAL
  if (body.ialMax !== undefined && ![1, 2].includes(body.ialMax)) {
    return c.json({ error: "invalid_ial_max", message: "ialMax must be 1 or 2" }, 400);
  }
  if (body.aalMax !== undefined && ![1, 2].includes(body.aalMax)) {
    return c.json({ error: "invalid_aal_max", message: "aalMax must be 1 or 2" }, 400);
  }

  const updates: Record<string, unknown> = {};
  if (body.name !== undefined) updates.name = body.name;
  if (body.ialMax !== undefined) updates.ialMax = body.ialMax;
  if (body.aalMax !== undefined) updates.aalMax = body.aalMax;
  if (body.redirectUris !== undefined) updates.redirectUris = JSON.stringify(body.redirectUris);
  if (body.publicKey !== undefined) updates.publicKey = body.publicKey;
  if (body.samlMetadataUrl !== undefined) updates.samlMetadataUrl = body.samlMetadataUrl;
  if (body.pushNotificationUrl !== undefined) updates.pushNotificationUrl = body.pushNotificationUrl;
  if (body.postLogoutRedirectUris !== undefined) updates.postLogoutRedirectUris = body.postLogoutRedirectUris ? JSON.stringify(body.postLogoutRedirectUris) : null;

  if (Object.keys(updates).length === 0) {
    return c.json({ error: "no_changes", message: "No fields to update" }, 400);
  }

  await db
    .update(serviceProviders)
    .set(updates)
    .where(eq(serviceProviders.id, spId));

  // If public key was updated, also update R2
  if (body.publicKey) {
    await c.env.R2_KEYS.put(`sp-certs/${spId}.pem`, body.publicKey, {
      httpMetadata: { contentType: "application/x-pem-file" },
      customMetadata: { spId, uploadedAt: new Date().toISOString() },
    });
  }

  // Invalidate KV cache for this SP
  try {
    await c.env.KV_SP_CONFIG.delete(`sp:${spId}`);
  } catch {
    // Non-fatal
  }

  return c.json({ ok: true, updated: spId });
});

// ── DELETE /service-providers/:spId ─────────────────────────
// Delete a service provider

sp.delete("/:spId", async (c) => {
  const spId = c.req.param("spId");
  const db = getDb(c.env);

  const [existing] = await db
    .select({ id: serviceProviders.id })
    .from(serviceProviders)
    .where(eq(serviceProviders.id, spId))
    .limit(1);

  if (!existing) {
    return c.json({ error: "not_found", message: "Service provider not found" }, 404);
  }

  await db.delete(serviceProviders).where(eq(serviceProviders.id, spId));

  // Clean up R2 cert
  try {
    await c.env.R2_KEYS.delete(`sp-certs/${spId}.pem`);
  } catch {
    // Non-fatal
  }

  // Invalidate KV cache
  try {
    await c.env.KV_SP_CONFIG.delete(`sp:${spId}`);
  } catch {
    // Non-fatal
  }

  return c.json({ ok: true, deleted: spId });
});

// ── POST /service-providers/:spId/upload-cert ───────────────
// Upload or replace SP public key certificate

sp.post("/:spId/upload-cert", async (c) => {
  const spId = c.req.param("spId");
  const db = getDb(c.env);

  const [existing] = await db
    .select({ id: serviceProviders.id })
    .from(serviceProviders)
    .where(eq(serviceProviders.id, spId))
    .limit(1);

  if (!existing) {
    return c.json({ error: "not_found", message: "Service provider not found" }, 404);
  }

  const contentType = c.req.header("Content-Type") ?? "";
  let certPem: string;

  if (contentType.includes("application/json")) {
    const body = await c.req.json<{ publicKey: string }>();
    if (!body.publicKey) {
      return c.json({ error: "missing_public_key", message: "publicKey is required" }, 400);
    }
    certPem = body.publicKey;
  } else {
    // Accept raw PEM text
    certPem = await c.req.text();
  }

  if (!certPem.includes("-----BEGIN")) {
    return c.json(
      { error: "invalid_cert", message: "Certificate must be in PEM format" },
      400
    );
  }

  const now = new Date().toISOString();

  // Update DB
  await db
    .update(serviceProviders)
    .set({ publicKey: certPem })
    .where(eq(serviceProviders.id, spId));

  // Store in R2
  await c.env.R2_KEYS.put(`sp-certs/${spId}.pem`, certPem, {
    httpMetadata: { contentType: "application/x-pem-file" },
    customMetadata: { spId, uploadedAt: now },
  });

  // Invalidate KV cache
  try {
    await c.env.KV_SP_CONFIG.delete(`sp:${spId}`);
  } catch {
    // Non-fatal
  }

  return c.json({ ok: true, certUploadedAt: now });
});

export { sp };
