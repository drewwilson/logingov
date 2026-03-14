/**
 * x509 / PIV / CAC Routes
 *
 * Feature 7: Read CF mTLS headers from request, store x509 metadata
 * in session DO. This is transient — not persisted to DB.
 */
import { Hono } from "hono";
import type { Env } from "@logingov/shared/env";

const x509 = new Hono<{ Bindings: Env }>();

// ── POST /x509/extract ──────────────────────────────────────
// Extract x509 / PIV / CAC metadata from Cloudflare mTLS headers
// and store in the session Durable Object.

x509.post("/extract", async (c) => {
  const sessionId = c.req.header("X-Session-Id");
  if (!sessionId) {
    return c.json({ error: "missing_session", message: "X-Session-Id header is required" }, 400);
  }

  // Read Cloudflare mTLS headers
  // See: https://developers.cloudflare.com/ssl/client-certificates/
  const certPresented = c.req.header("CF-Client-Cert-Verified");
  const certIssuer = c.req.header("CF-Client-Cert-Issuer-DN");
  const certSubject = c.req.header("CF-Client-Cert-Subject-DN");
  const certSerial = c.req.header("CF-Client-Cert-Serial-Number");
  const certFingerprint = c.req.header("CF-Client-Cert-Fingerprint-SHA256");

  const x509Presented = certPresented === "SUCCESS";

  if (!x509Presented) {
    return c.json({
      x509Presented: false,
      message: "No valid client certificate presented",
    });
  }

  // Store in session DO (transient — not persisted to DB)
  const doId = c.env.SESSION_DO.idFromString(sessionId);
  const stub = c.env.SESSION_DO.get(doId);

  const updateResp = await stub.fetch(
    new Request("http://do/update", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        x509Presented: true,
        x509Issuer: certIssuer ?? null,
        x509Subject: certSubject ?? null,
      }),
    })
  );

  if (!updateResp.ok) {
    return c.json({ error: "session_update_failed", message: "Failed to update session DO" }, 502);
  }

  return c.json({
    x509Presented: true,
    x509Issuer: certIssuer,
    x509Subject: certSubject,
    x509Serial: certSerial,
    x509Fingerprint: certFingerprint,
  });
});

// ── GET /x509/session/:sessionId ────────────────────────────
// Retrieve x509 metadata from session DO (for userinfo claims)

x509.get("/session/:sessionId", async (c) => {
  const sessionId = c.req.param("sessionId");

  const doId = c.env.SESSION_DO.idFromString(sessionId);
  const stub = c.env.SESSION_DO.get(doId);

  const sessionResp = await stub.fetch(new Request("http://do/get"));
  if (!sessionResp.ok) {
    return c.json({ error: "session_not_found" }, 404);
  }

  const session = (await sessionResp.json()) as {
    x509Presented?: boolean;
    x509Issuer?: string;
    x509Subject?: string;
  };

  return c.json({
    x509_presented: session.x509Presented ?? false,
    x509_issuer: session.x509Issuer ?? null,
    x509_subject: session.x509Subject ?? null,
  });
});

export { x509 };
