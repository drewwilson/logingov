/**
 * @logingov/account Worker
 *
 * Routes:
 * - /emails/* — Email CRUD and verification
 * - /password/* — Set, change, forgot, reset password
 * - /account/* — Account overview and deletion
 */
import { Hono } from "hono";
import type { Env } from "@logingov/shared";
import { tracing } from "@logingov/infra";
import { email } from "./routes/email.js";
import { password } from "./routes/password.js";
import { account } from "./routes/account.js";

const app = new Hono<{ Bindings: Env }>();

app.use("*", tracing({ serviceName: "account" }));

app.get("/health", (c) => c.json({ ok: true, service: "account" }));

// Mount route groups
app.route("/emails", email);
app.route("/password", password);
app.route("/account", account);

export default app;
