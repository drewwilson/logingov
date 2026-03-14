/**
 * Feature 14: RISC discovery endpoint — /.well-known/risc-configuration
 *
 * Returns static JSON per RFC 8935 / OpenID RISC Profile.
 * Cached in KV for performance.
 */
import { Hono } from "hono";
import type { Env } from "@logingov/shared";
import { kvGet, kvPut, KV_TTL } from "@logingov/shared/kv";
import { SET_EVENT_TYPES } from "@logingov/shared/types";

const CACHE_KEY = "risc:discovery";

const riscDiscoveryRoutes = new Hono<{ Bindings: Env }>();

const ISSUER = "https://secure.login.gov";

function buildDiscoveryDocument() {
  return {
    issuer: ISSUER,
    jwks_uri: `${ISSUER}/api/openid_connect/certs`,
    delivery: {
      delivery_methods_supported: [
        {
          method: "https://schemas.openid.net/secevent/risc/delivery-method/push",
          url: `${ISSUER}/api/risc/security_events`,
        },
      ],
    },
    events_supported: Object.values(SET_EVENT_TYPES),
    events_delivered: [
      SET_EVENT_TYPES.ACCOUNT_DISABLED,
      SET_EVENT_TYPES.ACCOUNT_PURGED,
      SET_EVENT_TYPES.PASSWORD_RESET,
      SET_EVENT_TYPES.IDENTIFIER_CHANGED,
      SET_EVENT_TYPES.IDENTIFIER_RECYCLED,
      SET_EVENT_TYPES.SESSION_REVOKED,
      SET_EVENT_TYPES.REPROOF_COMPLETED,
    ],
    events_requested: [
      SET_EVENT_TYPES.AUTHORIZATION_FRAUD,
      SET_EVENT_TYPES.IDENTITY_FRAUD,
      SET_EVENT_TYPES.CREDENTIAL_COMPROMISE,
    ],
  };
}

riscDiscoveryRoutes.get("/.well-known/risc-configuration", async (c) => {
  // Try KV cache first
  const cached = await kvGet<Record<string, unknown>>(c.env.KV_FLAGS, CACHE_KEY);
  if (cached) {
    return c.json(cached, 200, {
      "Cache-Control": "public, max-age=3600",
    });
  }

  const doc = buildDiscoveryDocument();

  // Cache in KV
  await kvPut(c.env.KV_FLAGS, CACHE_KEY, doc, KV_TTL.JWKS);

  return c.json(doc, 200, {
    "Cache-Control": "public, max-age=3600",
  });
});

export { riscDiscoveryRoutes };
