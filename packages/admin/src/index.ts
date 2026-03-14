/**
 * @logingov/admin Worker
 *
 * Routes:
 * - /service-providers/* — SP partner portal CRUD
 */
import { Hono } from "hono";
import type { Context, Next } from "hono";
import type { Env } from "@logingov/shared";
import { tracing } from "@logingov/infra";
import { sp } from "./routes/service-providers.js";
import { adminAudit } from "./middleware/audit.js";

const app = new Hono<{ Bindings: Env }>();

app.use("*", tracing({ serviceName: "admin" }));

app.get("/health", (c) => c.json({ ok: true, service: "admin" }));

// Admin authentication middleware — shared secret approach for internal service
async function requireAdminAuth(c: Context<{ Bindings: Env }>, next: Next) {
  const authHeader = c.req.header("Authorization");
  const token = authHeader?.replace("Bearer ", "");
  if (!token || token !== c.env.ADMIN_API_KEY) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  await next();
}

app.use("/service-providers", requireAdminAuth);
app.use("/service-providers/*", requireAdminAuth);
app.use("/service-providers", adminAudit);
app.use("/service-providers/*", adminAudit);

// Mount route groups
app.route("/service-providers", sp);

export default app;
