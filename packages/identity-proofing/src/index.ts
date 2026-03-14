/**
 * @logingov/identity-proofing Worker
 *
 * Routes:
 * - /proofing/* — IAL2 document verification, facial match, re-proofing
 * - /ssn/* — Scope-gated SSN attribute access
 * - /x509/* — PIV/CAC mTLS certificate metadata
 *
 * Middleware:
 * - ialEvaluator — reusable IAL level check
 */
import { Hono } from "hono";
import type { Env } from "@logingov/shared";
import { tracing } from "@logingov/infra";
import { proofing } from "./routes/proofing.js";
import { ssn } from "./routes/ssn.js";
import { x509 } from "./routes/x509.js";

const app = new Hono<{ Bindings: Env }>();

app.use("*", tracing({ serviceName: "identity-proofing" }));

app.get("/health", (c) => c.json({ ok: true, service: "identity-proofing" }));

// Mount route groups
app.route("/proofing", proofing);
app.route("/ssn", ssn);
app.route("/x509", x509);

export default app;

// Re-export middleware for use by other workers
export { ialEvaluator, ialEvaluatorPassthrough } from "./middleware/ial-evaluator.js";
export { PersonaClient } from "./lib/persona.js";
