/**
 * Generic helper for calling other Workers via Cloudflare service bindings.
 *
 * Wraps Fetcher.fetch() with JSON serialization, error propagation,
 * trace context forwarding, and internal authentication so callers
 * get a clean async interface.
 */
import { AppError } from "./errors.js";

export interface CallWorkerOptions {
  /** HTTP method (defaults to GET). */
  method?: string;
  /** Query parameters — appended to the path. */
  params?: Record<string, string>;
  /** JSON-serializable body (sets Content-Type: application/json). */
  body?: unknown;
  /** Extra headers to send (trace context, auth, etc.). */
  headers?: Record<string, string>;
  /**
   * How to handle the response:
   *  - "json"     — parse body as JSON and return it (default)
   *  - "response" — return the raw Response object (for redirects, streams, etc.)
   */
  responseMode?: "json" | "response";
  /**
   * Shared secret for internal service-to-service authentication.
   * When provided, an HMAC-SHA256 signature of the request path is
   * added as X-Internal-Auth header.
   */
  internalAuthSecret?: string;
}

/**
 * Call a sibling Worker through its Fetcher service binding.
 *
 * @param fetcher  The service binding (e.g. `env.AUTH_CORE`).
 * @param path     The path on the target Worker (e.g. "/openid_connect/authorize").
 * @param options  Request options.
 * @returns        Parsed JSON body or the raw Response, depending on `responseMode`.
 */
export async function callWorker<T = unknown>(
  fetcher: Fetcher,
  path: string,
  options: CallWorkerOptions & { responseMode: "response" }
): Promise<Response>;
export async function callWorker<T = unknown>(
  fetcher: Fetcher,
  path: string,
  options?: CallWorkerOptions
): Promise<T>;
export async function callWorker<T = unknown>(
  fetcher: Fetcher,
  path: string,
  options: CallWorkerOptions = {}
): Promise<T | Response> {
  const {
    method = "GET",
    params,
    body,
    headers: extraHeaders = {},
    responseMode = "json",
    internalAuthSecret,
  } = options;

  // Build the URL — service bindings use a dummy origin
  const url = new URL(path, "https://service-binding.internal");
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }

  // Build headers
  const headers: Record<string, string> = {
    ...extraHeaders,
  };

  // Propagate a trace ID if the caller didn't supply one
  if (!headers["x-trace-id"]) {
    headers["x-trace-id"] = crypto.randomUUID();
  }

  // Add internal auth header for service-to-service authentication
  if (internalAuthSecret) {
    headers["X-Internal-Auth"] = await computeInternalAuth(internalAuthSecret, path);
  }

  let requestBody: string | undefined;
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    requestBody = JSON.stringify(body);
  }

  // Service binding calls never leave the Cloudflare network, but we still
  // want to follow the standard fetch semantics.  We set redirect: "manual"
  // so the caller can decide whether to follow redirects.
  const response = await fetcher.fetch(url.toString(), {
    method,
    headers,
    body: requestBody,
    redirect: "manual",
  });

  // If the caller wants the raw Response (e.g. to forward a redirect), return it.
  if (responseMode === "response") {
    return response;
  }

  // For JSON mode, propagate errors from the downstream Worker.
  if (!response.ok) {
    let errorPayload: { error?: string; message?: string } = {};
    try {
      errorPayload = (await response.json()) as typeof errorPayload;
    } catch {
      // Body may not be JSON — that's fine
    }

    throw new AppError(
      errorPayload.error ?? "service_binding_error",
      errorPayload.message ?? `Service binding call to ${path} failed with status ${response.status}`,
      response.status
    );
  }

  return (await response.json()) as T;
}

/**
 * Compute HMAC-SHA256 of the request path using a shared secret.
 * Used for internal service-to-service authentication.
 */
async function computeInternalAuth(secret: string, path: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(path)
  );
  const bytes = new Uint8Array(signature);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Verify an internal auth header from an incoming service binding request.
 * Returns true if the signature is valid.
 */
export async function verifyInternalAuth(
  secret: string,
  path: string,
  authHeader: string | null | undefined
): Promise<boolean> {
  if (!authHeader) return false;
  const expected = await computeInternalAuth(secret, path);
  // Constant-time comparison to prevent timing attacks
  if (expected.length !== authHeader.length) return false;
  const a = new TextEncoder().encode(expected);
  const b = new TextEncoder().encode(authHeader);
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a[i] ^ b[i];
  }
  return result === 0;
}
