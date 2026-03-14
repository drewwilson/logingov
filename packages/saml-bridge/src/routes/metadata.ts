/**
 * Feature 2: SAML metadata endpoint — /api/saml/metadata
 *
 * Generates SAML IdP metadata XML.
 * Signing cert from KV_JWKS, SP config from D1 service_providers table.
 */
import { Hono } from "hono";
import type { Env } from "@logingov/shared";
import { kvGet, KV_KEYS } from "@logingov/shared/kv";
import { AppError, errorResponse } from "@logingov/shared/errors";
import { generateIdPMetadata } from "../lib/saml-helpers.js";

const ENTITY_ID = "https://secure.login.gov";
const BASE_URL = "https://secure.login.gov";

const metadataRoutes = new Hono<{ Bindings: Env }>();

interface StoredSigningCert {
  cert: string; // PEM-encoded X.509
  kid: string;
}

metadataRoutes.get("/api/saml/metadata", async (c) => {
  try {
    // Fetch signing cert from KV_JWKS
    const signingCert = await kvGet<StoredSigningCert>(
      c.env.KV_JWKS,
      KV_KEYS.signingKey("saml-current")
    );

    if (!signingCert) {
      return errorResponse(
        new AppError("config_error", "SAML signing certificate not found in KV", 500)
      );
    }

    const metadata = generateIdPMetadata({
      entityId: ENTITY_ID,
      ssoUrl: `${BASE_URL}/api/saml/auth`,
      sloUrl: `${BASE_URL}/api/saml/logout`,
      signingCertPem: signingCert.cert,
    });

    return new Response(metadata, {
      status: 200,
      headers: {
        "Content-Type": "application/samlmetadata+xml",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to generate metadata";
    return errorResponse(new AppError("metadata_error", message, 500));
  }
});

export { metadataRoutes };
