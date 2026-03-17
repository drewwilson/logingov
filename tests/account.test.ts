/**
 * Tests for Account Management Routes (GET/DELETE /account/:userId).
 *
 * Focuses on authentication/authorization middleware (requireSameUser)
 * which can be tested without a database. DB-dependent tests are marked .todo.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { account } from "../packages/account/src/routes/account.js";
import { createMockEnv, MockQueue } from "./helpers.js";

// ── Test app factory ─────────────────────────────────────────

function createTestApp() {
  const app = new Hono<{ Bindings: any }>();
  app.onError((err, c) => {
    return c.json({ error: "server_error", message: err.message }, 500);
  });
  app.route("/account", account);
  return app;
}

const TEST_USER_ID = "01234567-89ab-7def-0123-456789abcdef";
const OTHER_USER_ID = "aaaaaaaa-bbbb-7ccc-dddd-eeeeeeeeeeee";

// ── Tests ────────────────────────────────────────────────────

describe("Account routes", () => {
  let env: ReturnType<typeof createMockEnv>;
  let app: ReturnType<typeof createTestApp>;

  beforeEach(() => {
    env = createMockEnv();
    app = createTestApp();
  });

  // ── GET /account/:userId ──────────────────────────────────

  describe("GET /account/:userId", () => {
    it("returns 401 without X-User-Id header", async () => {
      const res = await app.request(
        `/account/${TEST_USER_ID}`,
        { method: "GET" },
        env
      );

      expect(res.status).toBe(401);
      const body = await res.json() as { error: string };
      expect(body.error).toBe("Unauthorized");
    });

    it("returns 403 when X-User-Id does not match :userId", async () => {
      const res = await app.request(
        `/account/${TEST_USER_ID}`,
        {
          method: "GET",
          headers: { "X-User-Id": OTHER_USER_ID },
        },
        env
      );

      expect(res.status).toBe(403);
      const body = await res.json() as { error: string };
      expect(body.error).toBe("Forbidden");
    });

    it.todo(
      "returns account overview with matching X-User-Id — needs DB"
    );
  });

  // ── DELETE /account/:userId ───────────────────────────────

  describe("DELETE /account/:userId", () => {
    it("returns 401 without X-User-Id header", async () => {
      const res = await app.request(
        `/account/${TEST_USER_ID}`,
        { method: "DELETE" },
        env
      );

      expect(res.status).toBe(401);
      const body = await res.json() as { error: string };
      expect(body.error).toBe("Unauthorized");
    });

    it("returns 403 when X-User-Id does not match :userId", async () => {
      const res = await app.request(
        `/account/${TEST_USER_ID}`,
        {
          method: "DELETE",
          headers: { "X-User-Id": OTHER_USER_ID },
        },
        env
      );

      expect(res.status).toBe(403);
      const body = await res.json() as { error: string };
      expect(body.error).toBe("Forbidden");
    });

    it.todo(
      "deletes own account with matching X-User-Id — needs DB"
    );

    it.todo(
      "emits account-purged SET event via QUEUE_SET — needs DB"
    );

    it.todo(
      "cleans up R2 proofing documents — needs DB and R2"
    );
  });
});
