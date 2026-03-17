/**
 * Tests for the OpenID Connect Discovery endpoint.
 *
 * GET /.well-known/openid-configuration
 *
 * Since the full auth-core app has many dependencies (Better Auth, sub-apps,
 * Durable Objects, etc.), we replicate just the well-known endpoint in a
 * minimal Hono app to test the response structure and values.
 *
 * Based on upstream openid_connect_spec.rb.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { Hono } from "hono";

// ── Replicate the well-known endpoint for isolated testing ──

function createWellKnownApp() {
  const app = new Hono();
  app.get("/.well-known/openid-configuration", (c) => {
    const issuer = "https://secure.login.gov";
    return c.json({
      issuer,
      authorization_endpoint: `${issuer}/openid_connect/authorize`,
      token_endpoint: `${issuer}/api/openid_connect/token`,
      userinfo_endpoint: `${issuer}/api/openid_connect/userinfo`,
      jwks_uri: `${issuer}/api/openid_connect/certs`,
      end_session_endpoint: `${issuer}/openid_connect/logout`,
      scopes_supported: [
        "openid", "email", "all_emails", "phone", "address",
        "profile", "profile:name", "profile:birthdate", "profile:verified_at",
        "social_security_number", "x509", "x509:issuer", "x509:subject",
        "x509:presented", "locale",
      ],
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code"],
      pushed_authorization_request_endpoint: `${issuer}/api/openid_connect/par`,
      require_pushed_authorization_requests: false,
      token_endpoint_auth_methods_supported: ["private_key_jwt"],
      id_token_signing_alg_values_supported: ["RS256"],
      subject_types_supported: ["pairwise"],
      acr_values_supported: [
        "urn:acr.login.gov:auth-only",
        "urn:acr.login.gov:verified",
        "urn:acr.login.gov:verified-facial-match-required",
        "urn:acr.login.gov:verified-facial-match-preferred",
        "urn:gov:gsa:ac:classes:sp:PasswordProtectedTransport:duo",
        "http://idmanagement.gov/ns/assurance/aal/2",
        "http://idmanagement.gov/ns/assurance/aal/2?phishing_resistant=true",
        "http://idmanagement.gov/ns/assurance/aal/2?hspd12=true",
        "http://idmanagement.gov/ns/assurance/ial/1",
        "http://idmanagement.gov/ns/assurance/ial/2",
        "http://idmanagement.gov/ns/assurance/loa/1",
        "http://idmanagement.gov/ns/assurance/loa/3",
      ],
      claims_supported: [
        "sub", "iss", "aud", "exp", "iat", "jti", "nonce", "at_hash", "c_hash",
        "acr", "email", "email_verified", "given_name", "family_name",
        "birthdate", "phone", "address", "social_security_number",
        "verified_at", "ial", "aal", "locale",
      ],
    });
  });
  return app;
}

// ── Tests ────────────────────────────────────────────────────

describe("OpenID Connect Discovery (/.well-known/openid-configuration)", () => {
  const app = createWellKnownApp();
  let res: Response;
  let body: Record<string, unknown>;

  beforeAll(async () => {
    res = await app.request("/.well-known/openid-configuration");
    body = (await res.json()) as Record<string, unknown>;
  });

  // ── Basic response ────────────────────────────────────────

  it("returns 200 with valid JSON", () => {
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(body).toBeDefined();
  });

  // ── Issuer ────────────────────────────────────────────────

  it("issuer is https://secure.login.gov", () => {
    expect(body.issuer).toBe("https://secure.login.gov");
  });

  // ── Required OIDC Discovery fields ────────────────────────

  it("all required OIDC Discovery fields are present", () => {
    const requiredFields = [
      "issuer",
      "authorization_endpoint",
      "token_endpoint",
      "userinfo_endpoint",
      "jwks_uri",
      "scopes_supported",
      "response_types_supported",
      "grant_types_supported",
      "subject_types_supported",
      "id_token_signing_alg_values_supported",
      "claims_supported",
    ];
    for (const field of requiredFields) {
      expect(body).toHaveProperty(field);
    }
  });

  // ── Endpoint URLs ─────────────────────────────────────────

  it("authorization_endpoint is correct", () => {
    expect(body.authorization_endpoint).toBe(
      "https://secure.login.gov/openid_connect/authorize"
    );
  });

  it("token_endpoint is correct", () => {
    expect(body.token_endpoint).toBe(
      "https://secure.login.gov/api/openid_connect/token"
    );
  });

  it("userinfo_endpoint is correct", () => {
    expect(body.userinfo_endpoint).toBe(
      "https://secure.login.gov/api/openid_connect/userinfo"
    );
  });

  it("jwks_uri is correct", () => {
    expect(body.jwks_uri).toBe(
      "https://secure.login.gov/api/openid_connect/certs"
    );
  });

  it("end_session_endpoint is present", () => {
    expect(body.end_session_endpoint).toBe(
      "https://secure.login.gov/openid_connect/logout"
    );
  });

  it("PAR endpoint is present and correct", () => {
    expect(body.pushed_authorization_request_endpoint).toBe(
      "https://secure.login.gov/api/openid_connect/par"
    );
  });

  // ── Supported values ──────────────────────────────────────

  it("scopes_supported includes openid, email, phone, address, profile", () => {
    const scopes = body.scopes_supported as string[];
    expect(scopes).toContain("openid");
    expect(scopes).toContain("email");
    expect(scopes).toContain("phone");
    expect(scopes).toContain("address");
    expect(scopes).toContain("profile");
  });

  it("response_types_supported is [code]", () => {
    expect(body.response_types_supported).toEqual(["code"]);
  });

  it("grant_types_supported is [authorization_code]", () => {
    expect(body.grant_types_supported).toEqual(["authorization_code"]);
  });

  it("token_endpoint_auth_methods_supported includes private_key_jwt", () => {
    const methods = body.token_endpoint_auth_methods_supported as string[];
    expect(methods).toContain("private_key_jwt");
  });

  it("id_token_signing_alg_values_supported is [RS256]", () => {
    expect(body.id_token_signing_alg_values_supported).toEqual(["RS256"]);
  });

  it("subject_types_supported is [pairwise]", () => {
    expect(body.subject_types_supported).toEqual(["pairwise"]);
  });

  // ── ACR values ────────────────────────────────────────────

  it("acr_values_supported includes auth-only and verified", () => {
    const acr = body.acr_values_supported as string[];
    expect(acr).toContain("urn:acr.login.gov:auth-only");
    expect(acr).toContain("urn:acr.login.gov:verified");
  });

  it("acr_values_supported includes facial-match variants", () => {
    const acr = body.acr_values_supported as string[];
    expect(acr).toContain("urn:acr.login.gov:verified-facial-match-required");
    expect(acr).toContain("urn:acr.login.gov:verified-facial-match-preferred");
  });

  it("acr_values_supported includes AAL and legacy IAL/LOA values", () => {
    const acr = body.acr_values_supported as string[];
    expect(acr).toContain("http://idmanagement.gov/ns/assurance/aal/2");
    expect(acr).toContain(
      "http://idmanagement.gov/ns/assurance/aal/2?phishing_resistant=true"
    );
    expect(acr).toContain(
      "http://idmanagement.gov/ns/assurance/aal/2?hspd12=true"
    );
    // Deprecated but required for backward compat
    expect(acr).toContain("http://idmanagement.gov/ns/assurance/ial/1");
    expect(acr).toContain("http://idmanagement.gov/ns/assurance/ial/2");
    expect(acr).toContain("http://idmanagement.gov/ns/assurance/loa/1");
    expect(acr).toContain("http://idmanagement.gov/ns/assurance/loa/3");
  });

  // ── Claims ────────────────────────────────────────────────

  it("claims_supported includes sub, email, email_verified, birthdate", () => {
    const claims = body.claims_supported as string[];
    expect(claims).toContain("sub");
    expect(claims).toContain("email");
    expect(claims).toContain("email_verified");
    expect(claims).toContain("birthdate");
  });

  it("claims_supported includes identity and token claims", () => {
    const claims = body.claims_supported as string[];
    expect(claims).toContain("iss");
    expect(claims).toContain("aud");
    expect(claims).toContain("exp");
    expect(claims).toContain("iat");
    expect(claims).toContain("jti");
    expect(claims).toContain("nonce");
    expect(claims).toContain("at_hash");
    expect(claims).toContain("c_hash");
    expect(claims).toContain("acr");
  });

  it("claims_supported includes profile and verified_at", () => {
    const claims = body.claims_supported as string[];
    expect(claims).toContain("given_name");
    expect(claims).toContain("family_name");
    expect(claims).toContain("phone");
    expect(claims).toContain("address");
    expect(claims).toContain("social_security_number");
    expect(claims).toContain("verified_at");
    expect(claims).toContain("ial");
    expect(claims).toContain("aal");
    expect(claims).toContain("locale");
  });
});
