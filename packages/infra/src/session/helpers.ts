/**
 * Session management helper utilities.
 *
 * Other Workers import these to interact with SessionDO instances
 * via a typed interface rather than raw fetch calls.
 */

import type { Env } from "@logingov/shared";
import type { SessionState } from "@logingov/session-do";

// ── Types ───────────────────────────────────────────────────

export interface CreateSessionParams {
  responseType: string;
  redirectUri: string;
  scopes: string[];
  requestedIal: 1 | 2;
  requestedAal: 1 | 2;
  nonce?: string;
  state?: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
  locale?: string;
  rememberedDevice?: boolean;
  facialMatch?: "required" | "preferred";
}

export interface SessionResponse {
  ok: boolean;
  expiresAt?: string;
  error?: string;
}

// ── Helpers ─────────────────────────────────────────────────

/**
 * Derive a deterministic DO ID from the session ID string.
 */
function getStub(env: Env, sessionId: string): DurableObjectStub {
  const id = env.SESSION_DO.idFromName(sessionId);
  return env.SESSION_DO.get(id);
}

/**
 * Create a new session in a Durable Object.
 *
 * @param env - Worker env bindings
 * @param spId - Service provider issuer
 * @param params - Session creation parameters
 * @returns Session ID (UUID) and creation response
 */
export async function createSession(
  env: Env,
  spId: string,
  params: CreateSessionParams
): Promise<{ sessionId: string; response: SessionResponse }> {
  const sessionId = crypto.randomUUID();
  const stub = getStub(env, sessionId);

  const sessionState: SessionState = {
    spId,
    responseType: params.responseType,
    redirectUri: params.redirectUri,
    scopes: params.scopes,
    requestedIal: params.requestedIal,
    requestedAal: params.requestedAal,
    nonce: params.nonce,
    state: params.state,
    codeChallenge: params.codeChallenge,
    codeChallengeMethod: params.codeChallengeMethod,
    locale: params.locale ?? "en",
    rememberedDevice: params.rememberedDevice,
    facialMatch: params.facialMatch,
    mfaVerified: false,
    createdAt: new Date().toISOString(),
    expiresAt: "", // Set by the DO
  };

  const res = await stub.fetch("http://session-do/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(sessionState),
  });

  const response = (await res.json()) as SessionResponse;
  return { sessionId, response };
}

/**
 * Fetch current session state from a Durable Object.
 *
 * @returns Session state or null if not found / expired
 */
export async function getSession(
  env: Env,
  sessionId: string
): Promise<SessionState | null> {
  const stub = getStub(env, sessionId);

  const res = await stub.fetch("http://session-do/get", {
    method: "GET",
  });

  if (!res.ok) {
    return null;
  }

  return (await res.json()) as SessionState;
}

/**
 * Patch session state (e.g., after MFA verification, user identification).
 */
export async function updateSession(
  env: Env,
  sessionId: string,
  updates: Partial<SessionState>
): Promise<SessionResponse> {
  const stub = getStub(env, sessionId);

  const res = await stub.fetch("http://session-do/update", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });

  return (await res.json()) as SessionResponse;
}

/**
 * Destroy a session (logout, fraud action).
 * Clears both the DO storage and any KV session reference.
 */
export async function destroySession(
  env: Env,
  sessionId: string
): Promise<SessionResponse> {
  const stub = getStub(env, sessionId);

  const res = await stub.fetch("http://session-do/destroy", {
    method: "DELETE",
  });

  // Also clean up the KV session lookup entry if one exists
  const kvKey = `session:${sessionId}`;
  await env.KV_SESSIONS.delete(kvKey);

  return (await res.json()) as SessionResponse;
}
