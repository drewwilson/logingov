/**
 * Tests for GET /openid_connect/logout
 *
 * The logout endpoint accepts client_id + post_logout_redirect_uri,
 * validates the redirect URI against the SP config, destroys the
 * SessionDO, emits a session-revoked SET, audits the logout, and
 * redirects the user.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { AppError, errorResponse } from "@logingov/shared";
import { logoutRoute } from "@logingov/auth-core/routes/logout";
import { createMockEnv, seedSP, TEST_SP, MockQueue } from "./helpers.js";

function createTestApp(route: any) {
  const app = new Hono<{ Bindings: any }>();
  app.onError((err, c) => {
    if (err instanceof AppError) return errorResponse(err);
    return c.json({ error: "server_error", message: err.message }, 500);
  });
  app.route("/", route);
  return app;
}

function buildLogoutUrl(params: Record<string, string>): string {
  const url = new URL("https://secure.login.gov/openid_connect/logout");
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

describe("GET /openid_connect/logout", () => {
  let env: ReturnType<typeof createMockEnv>;
  let app: ReturnType<typeof createTestApp>;

  beforeEach(async () => {
    env = createMockEnv();
    app = createTestApp(logoutRoute);
    await seedSP(env);
  });

  it("redirects to post_logout_redirect_uri when valid", async () => {
    const logoutUri = TEST_SP.postLogoutRedirectUris[0];

    const res = await app.request(
      buildLogoutUrl({
        client_id: TEST_SP.id,
        post_logout_redirect_uri: logoutUri,
      }),
      { redirect: "manual" },
      env
    );

    expect(res.status).toBe(302);
    const location = res.headers.get("Location");
    expect(location).toBe(logoutUri);
  });

  it("redirects to default when post_logout_redirect_uri is not registered", async () => {
    const res = await app.request(
      buildLogoutUrl({
        client_id: TEST_SP.id,
        post_logout_redirect_uri: "https://evil.example.com/callback",
      }),
      { redirect: "manual" },
      env
    );

    expect(res.status).toBe(302);
    const location = res.headers.get("Location");
    expect(location).toBe("https://secure.login.gov/");
  });

  it("returns 400 when client_id is missing", async () => {
    const res = await app.request(
      buildLogoutUrl({
        post_logout_redirect_uri: TEST_SP.postLogoutRedirectUris[0],
      }),
      {},
      env
    );

    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toBe("invalid_request");
    expect(body.message).toContain("client_id");
  });

  it("passes state parameter through to redirect", async () => {
    const logoutUri = TEST_SP.postLogoutRedirectUris[0];

    const res = await app.request(
      buildLogoutUrl({
        client_id: TEST_SP.id,
        post_logout_redirect_uri: logoutUri,
        state: "my-state-abc",
      }),
      { redirect: "manual" },
      env
    );

    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("Location")!);
    expect(location.searchParams.get("state")).toBe("my-state-abc");
  });

  it("emits session-revoked SET event to QUEUE_SET", async () => {
    const queueSet = env.QUEUE_SET as MockQueue;

    await app.request(
      buildLogoutUrl({
        client_id: TEST_SP.id,
        post_logout_redirect_uri: TEST_SP.postLogoutRedirectUris[0],
      }),
      { redirect: "manual" },
      env
    );

    expect(queueSet.messages).toHaveLength(1);
    const msg = queueSet.messages[0];
    expect(msg.type).toBe("set:outbound");
    expect(msg.payload.eventUri).toContain("session-revoked");
    expect(msg.payload.claims.clientId).toBe(TEST_SP.id);
  });

  it("emits audit event to QUEUE_AUDIT", async () => {
    const queueAudit = env.QUEUE_AUDIT as MockQueue;

    await app.request(
      buildLogoutUrl({
        client_id: TEST_SP.id,
        post_logout_redirect_uri: TEST_SP.postLogoutRedirectUris[0],
      }),
      { redirect: "manual" },
      env
    );

    expect(queueAudit.messages).toHaveLength(1);
    const msg = queueAudit.messages[0];
    expect(msg.type).toBe("audit:write");
    expect(msg.payload.eventType).toBe("logout");
    expect(msg.payload.metadata.spId).toBe(TEST_SP.id);
  });

  it("redirects to default URL when no post_logout_redirect_uri provided", async () => {
    const res = await app.request(
      buildLogoutUrl({
        client_id: TEST_SP.id,
      }),
      { redirect: "manual" },
      env
    );

    expect(res.status).toBe(302);
    const location = res.headers.get("Location");
    expect(location).toBe("https://secure.login.gov/");
  });

  it("falls back to redirectUris when postLogoutRedirectUris is null", async () => {
    // Seed an SP with no postLogoutRedirectUris
    const spNoPostLogout = {
      ...TEST_SP,
      id: "urn:gov:gsa:openidconnect.profiles:sp:sso:agency:no-postlogout",
      postLogoutRedirectUris: null,
    };
    await seedSP(env, spNoPostLogout as any);

    // The SP's redirectUris include this one
    const redirectUri = TEST_SP.redirectUris[0];

    const res = await app.request(
      buildLogoutUrl({
        client_id: spNoPostLogout.id,
        post_logout_redirect_uri: redirectUri,
      }),
      { redirect: "manual" },
      env
    );

    expect(res.status).toBe(302);
    const location = res.headers.get("Location");
    expect(location).toBe(redirectUri);
  });
});
