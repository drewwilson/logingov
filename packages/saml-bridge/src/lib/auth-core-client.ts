/**
 * Service-binding client for calling auth-core from the SAML bridge.
 *
 * Uses the AUTH_CORE Fetcher (Cloudflare service binding) so requests
 * stay within the Cloudflare network — no public internet round-trip.
 */
import type { Env } from "@logingov/shared";
import { callWorker } from "@logingov/shared";
import type { OIDCAuthorizeParams } from "./saml-helpers.js";

/**
 * Call auth-core's /openid_connect/authorize endpoint via service binding.
 *
 * auth-core validates the OIDC parameters, creates a SessionDO, and returns
 * a 302 redirect to the login UI. We return the raw Response so the SAML
 * bridge can forward the redirect back to the user-agent.
 */
export async function initiateOIDCAuthorize(
  env: Env,
  params: OIDCAuthorizeParams
): Promise<Response> {
  // Convert the typed params into a string record for query parameters
  const queryParams: Record<string, string> = {
    client_id: params.client_id,
    redirect_uri: params.redirect_uri,
    response_type: params.response_type,
    scope: params.scope,
    acr_values: params.acr_values,
    nonce: params.nonce,
    state: params.state,
  };

  if (params.prompt) {
    queryParams.prompt = params.prompt;
  }

  return callWorker(env.AUTH_CORE, "/openid_connect/authorize", {
    method: "GET",
    params: queryParams,
    responseMode: "response",
  });
}

/**
 * Parameters for the OIDC logout call.
 */
export interface OIDCLogoutParams {
  /** The id_token_hint for the session being logged out. */
  id_token_hint: string;
  /** Where to redirect after logout (optional). */
  post_logout_redirect_uri?: string;
  /** Opaque state value to round-trip (optional). */
  state?: string;
}

/**
 * Call auth-core's /openid_connect/logout endpoint via service binding.
 *
 * auth-core validates the id_token_hint, destroys the SessionDO and KV data,
 * and returns a 302 redirect. We return the raw Response so the caller can
 * inspect the redirect location or forward it.
 */
export async function completeOIDCLogout(
  env: Env,
  params: OIDCLogoutParams
): Promise<Response> {
  const queryParams: Record<string, string> = {
    id_token_hint: params.id_token_hint,
  };

  if (params.post_logout_redirect_uri) {
    queryParams.post_logout_redirect_uri = params.post_logout_redirect_uri;
  }

  if (params.state) {
    queryParams.state = params.state;
  }

  return callWorker(env.AUTH_CORE, "/openid_connect/logout", {
    method: "GET",
    params: queryParams,
    responseMode: "response",
  });
}
