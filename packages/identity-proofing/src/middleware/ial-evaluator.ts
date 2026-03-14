/**
 * IAL Evaluator Middleware
 *
 * Checks user.ial against the requestedIal from the session DO.
 * Passes through if user meets or exceeds the required level.
 * Returns 403 if the user needs to proof up to a higher IAL.
 */
import { createMiddleware } from "hono/factory";
import { getDb } from "@logingov/shared/db";
import { eq } from "drizzle-orm";
import { users } from "@logingov/shared/schema";
import type { Env } from "@logingov/shared/env";
import type { IALLevel } from "@logingov/shared/types";
import { evaluateIAL } from "@logingov/shared";
import type { SessionState } from "@logingov/session-do";

interface IALEvaluatorEnv {
  Bindings: Env;
  Variables: {
    userId: string;
    sessionId: string;
    userIal: IALLevel;
    requestedIal: IALLevel;
    needsProofing: boolean;
  };
}

/**
 * Reusable middleware that evaluates whether a user's current IAL
 * meets the requested IAL for the current auth session.
 *
 * Requires `userId` and `sessionId` to be set in context variables
 * by an upstream auth middleware.
 */
export const ialEvaluator = createMiddleware<IALEvaluatorEnv>(async (c, next) => {
  const userId = c.get("userId");
  const sessionId = c.get("sessionId");

  if (!userId || !sessionId) {
    return c.json({ error: "missing_context", message: "userId and sessionId are required" }, 400);
  }

  // Fetch user's current IAL from D1
  const db = getDb(c.env);
  const [user] = await db.select({ ial: users.ial }).from(users).where(eq(users.id, userId)).limit(1);

  if (!user) {
    return c.json({ error: "user_not_found", message: "User does not exist" }, 404);
  }

  // Fetch requested IAL from session DO
  const doId = c.env.SESSION_DO.idFromString(sessionId);
  const stub = c.env.SESSION_DO.get(doId);
  const sessionResp = await stub.fetch(new Request("http://do/get"));

  if (!sessionResp.ok) {
    return c.json({ error: "session_error", message: "Could not retrieve session state" }, 502);
  }

  const session = (await sessionResp.json()) as SessionState;
  const requestedIal = session.requestedIal;
  const userIal = user.ial as IALLevel;

  const { allowed, needsProofing } = evaluateIAL(userIal, requestedIal);

  // Set context variables for downstream handlers
  c.set("userIal", userIal);
  c.set("requestedIal", requestedIal);
  c.set("needsProofing", needsProofing);

  // If user meets or exceeds required IAL, pass through
  if (allowed) {
    await next();
    return;
  }

  // User does not meet IAL requirement — return 403 with upgrade hint
  return c.json(
    {
      error: "ial_insufficient",
      message: `User IAL ${userIal} does not meet requested IAL ${requestedIal}`,
      currentIal: userIal,
      requestedIal,
      proofingRequired: true,
    },
    403
  );
});

/**
 * Variant that does NOT block — just sets needsProofing in context.
 * Useful when you want the route handler to decide what to do.
 */
export const ialEvaluatorPassthrough = createMiddleware<IALEvaluatorEnv>(async (c, next) => {
  const userId = c.get("userId");
  const sessionId = c.get("sessionId");

  if (!userId || !sessionId) {
    c.set("needsProofing", false);
    c.set("userIal", 1 as IALLevel);
    c.set("requestedIal", 1 as IALLevel);
    await next();
    return;
  }

  const db = getDb(c.env);
  const [user] = await db.select({ ial: users.ial }).from(users).where(eq(users.id, userId)).limit(1);

  if (!user) {
    c.set("needsProofing", false);
    c.set("userIal", 1 as IALLevel);
    c.set("requestedIal", 1 as IALLevel);
    await next();
    return;
  }

  const doId = c.env.SESSION_DO.idFromString(sessionId);
  const stub = c.env.SESSION_DO.get(doId);
  const sessionResp = await stub.fetch(new Request("http://do/get"));

  let requestedIal: IALLevel = 1;
  if (sessionResp.ok) {
    const session = (await sessionResp.json()) as SessionState;
    requestedIal = session.requestedIal;
  }

  const userIal = user.ial as IALLevel;
  const { needsProofing } = evaluateIAL(userIal, requestedIal);

  c.set("userIal", userIal);
  c.set("requestedIal", requestedIal);
  c.set("needsProofing", needsProofing);

  await next();
});
