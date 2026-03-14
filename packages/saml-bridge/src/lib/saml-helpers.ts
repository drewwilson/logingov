/**
 * SAML protocol helpers — AuthnRequest parsing, metadata generation,
 * LogoutRequest/Response handling via samlify.
 */
import * as samlify from "samlify";

// ── SAML Binding constants ──────────────────────────────────

export const SAML_BINDINGS = {
  REDIRECT: "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect",
  POST: "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST",
} as const;

export const SAML_NAMEID_FORMAT = {
  PERSISTENT: "urn:oasis:names:tc:SAML:2.0:nameid-format:persistent",
  EMAIL: "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
} as const;

// ── AuthnRequest parsing ────────────────────────────────────

export interface ParsedAuthnRequest {
  issuer: string; // SP entity ID
  acsUrl: string; // Assertion Consumer Service URL
  requestId: string; // AuthnRequest ID
  relayState?: string;
  nameIdPolicy?: string;
  requestedAuthnContext?: string[];
  forceAuthn?: boolean;
  isPassive?: boolean;
  rawXml: string; // Raw XML for signature verification
}

/**
 * Decode and parse a SAML AuthnRequest from base64 (HTTP-Redirect or HTTP-POST).
 * For HTTP-Redirect binding (GET), the payload is DEFLATE-compressed then base64-encoded.
 * For HTTP-POST binding, the payload is plain base64.
 */
export async function parseAuthnRequest(
  samlRequest: string,
  relayState?: string
): Promise<ParsedAuthnRequest> {
  // Decode from base64
  const decoded = atob(samlRequest);
  const bytes = Uint8Array.from(decoded, c => c.charCodeAt(0));

  // Fix 6: Try DEFLATE decompression (HTTP-Redirect binding), fall back to plain base64
  let xml: string;
  try {
    const ds = new DecompressionStream("deflate-raw");
    const writer = ds.writable.getWriter();
    writer.write(bytes);
    writer.close();
    const reader = ds.readable.getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
    xml = new TextDecoder().decode(concatUint8Arrays(chunks));
  } catch {
    // Fallback: assume plain base64 (HTTP-POST binding)
    xml = decoded;
  }

  // Fix 5: Use DOMParser-style validation — ensure critical elements are not duplicated
  // (protects against XML signature wrapping attacks)
  validateXmlStructure(xml);

  const issuer = extractXmlElement(xml, "saml:Issuer") ?? extractXmlElement(xml, "Issuer");
  const acsUrl = extractXmlAttribute(xml, "AssertionConsumerServiceURL");
  const requestId = extractXmlAttribute(xml, "ID");
  const forceAuthn = extractXmlAttribute(xml, "ForceAuthn") === "true";
  const isPassive = extractXmlAttribute(xml, "IsPassive") === "true";

  // Extract requested AuthnContext class refs
  const authnContextRefs = extractAllXmlElements(
    xml,
    "saml:AuthnContextClassRef"
  ) ?? extractAllXmlElements(xml, "AuthnContextClassRef");

  if (!issuer) {
    throw new Error("AuthnRequest missing Issuer");
  }
  if (!acsUrl) {
    throw new Error("AuthnRequest missing AssertionConsumerServiceURL");
  }
  if (!requestId) {
    throw new Error("AuthnRequest missing ID attribute");
  }

  return {
    issuer,
    acsUrl,
    requestId,
    relayState,
    requestedAuthnContext: authnContextRefs.length > 0 ? authnContextRefs : undefined,
    forceAuthn,
    isPassive,
    rawXml: xml,
  };
}

// ── Signature verification ─────────────────────────────────

/**
 * Verify the XML digital signature on a SAML AuthnRequest using the SP's public key.
 * Throws if the signature is missing or invalid.
 */
export async function verifyAuthnRequestSignature(
  xml: string,
  spPublicKey: string
): Promise<void> {
  await verifyXmlSignature(xml, spPublicKey, "AuthnRequest");
}

/**
 * Verify the XML digital signature on a SAML LogoutRequest using the SP's public key.
 * Throws if the signature is missing or invalid.
 */
export async function verifyLogoutRequestSignature(
  xml: string,
  spPublicKey: string
): Promise<void> {
  await verifyXmlSignature(xml, spPublicKey, "LogoutRequest");
}

/**
 * Generic XML signature verification using samlify's SamlLib.
 * Uses the SP's public key certificate to verify the embedded XML signature.
 */
async function verifyXmlSignature(
  xml: string,
  spPublicKey: string,
  messageType: string
): Promise<void> {
  // Check that the XML contains a Signature element
  if (!/<(ds:)?Signature[\s>]/s.test(xml)) {
    throw new Error(`${messageType} missing XML signature`);
  }

  try {
    // Normalize the certificate: strip PEM headers and whitespace
    const certBody = spPublicKey
      .replace(/-----BEGIN CERTIFICATE-----/g, "")
      .replace(/-----END CERTIFICATE-----/g, "")
      .replace(/\s+/g, "");

    // Use samlify's SamlLib to verify the XML digital signature
    const [valid] = samlify.SamlLib.verifySignature(xml, {
      metadata: {
        getX509Certificate: () => certBody,
      } as any,
      signatureAlgorithm: "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256",
    });

    if (!valid) {
      throw new Error(`${messageType} signature verification failed`);
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes("signature")) {
      throw err;
    }
    throw new Error(`${messageType} signature verification failed: ${err instanceof Error ? err.message : "unknown error"}`);
  }
}

// ── SAML → OIDC translation ────────────────────────────────

/** SAML AuthnContext → Login.gov ACR value mapping */
const AUTHN_CONTEXT_TO_ACR: Record<string, string> = {
  "urn:oasis:names:tc:SAML:2.0:ac:classes:Password": "urn:acr.login.gov:auth-only",
  "urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport":
    "urn:acr.login.gov:auth-only",
  // NIST 800-63 mappings (used by government SPs)
  "http://idmanagement.gov/ns/assurance/ial/1": "urn:acr.login.gov:auth-only",
  "http://idmanagement.gov/ns/assurance/ial/2": "urn:acr.login.gov:verified",
  "http://idmanagement.gov/ns/assurance/loa/1": "urn:acr.login.gov:auth-only",
  "http://idmanagement.gov/ns/assurance/loa/3": "urn:acr.login.gov:verified",
  // Direct ACR URN passthrough
  "urn:acr.login.gov:auth-only": "urn:acr.login.gov:auth-only",
  "urn:acr.login.gov:verified": "urn:acr.login.gov:verified",
  "urn:acr.login.gov:verified-facial-match-required":
    "urn:acr.login.gov:verified-facial-match-required",
  "urn:acr.login.gov:verified-facial-match-preferred":
    "urn:acr.login.gov:verified-facial-match-preferred",
};

export interface OIDCAuthorizeParams {
  client_id: string;
  redirect_uri: string;
  response_type: "code";
  scope: string;
  acr_values: string;
  nonce: string;
  state: string;
  prompt?: "login" | "select_account";
}

/**
 * Translate a parsed SAML AuthnRequest into OIDC authorize parameters.
 */
export function translateToOIDC(
  parsed: ParsedAuthnRequest,
  authorizeEndpoint: string
): { url: string; params: OIDCAuthorizeParams } {
  // Map AuthnContext to ACR value
  let acr = "urn:acr.login.gov:auth-only"; // default
  if (parsed.requestedAuthnContext && parsed.requestedAuthnContext.length > 0) {
    const mapped = AUTHN_CONTEXT_TO_ACR[parsed.requestedAuthnContext[0]];
    if (mapped) {
      acr = mapped;
    }
  }

  // Fix 7: Generate a random nonce instead of reusing the AuthnRequest ID
  const nonce = crypto.randomUUID();
  const state = parsed.relayState ?? crypto.randomUUID();

  const params: OIDCAuthorizeParams = {
    client_id: parsed.issuer,
    redirect_uri: parsed.acsUrl,
    response_type: "code",
    scope: "openid email",
    acr_values: acr,
    nonce,
    state,
    ...(parsed.forceAuthn ? { prompt: "login" as const } : {}),
  };

  const searchParams = new URLSearchParams(params as unknown as Record<string, string>);
  const url = `${authorizeEndpoint}?${searchParams.toString()}`;

  return { url, params };
}

// ── IdP metadata generation ─────────────────────────────────

export interface IdPMetadataConfig {
  entityId: string;
  ssoUrl: string;
  sloUrl: string;
  signingCertPem: string; // PEM-encoded X.509 cert (without headers/footers)
}

/**
 * Generate SAML IdP metadata XML.
 */
export function generateIdPMetadata(config: IdPMetadataConfig): string {
  // Strip PEM headers if present
  const certBody = config.signingCertPem
    .replace(/-----BEGIN CERTIFICATE-----/g, "")
    .replace(/-----END CERTIFICATE-----/g, "")
    .replace(/\s+/g, "");

  return `<?xml version="1.0" encoding="UTF-8"?>
<EntityDescriptor
  xmlns="urn:oasis:names:tc:SAML:2.0:metadata"
  entityID="${escapeXml(config.entityId)}">
  <IDPSSODescriptor
    WantAuthnRequestsSigned="true"
    protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <KeyDescriptor use="signing">
      <ds:KeyInfo xmlns:ds="http://www.w3.org/2000/09/xmldsig#">
        <ds:X509Data>
          <ds:X509Certificate>${certBody}</ds:X509Certificate>
        </ds:X509Data>
      </ds:KeyInfo>
    </KeyDescriptor>
    <NameIDFormat>${SAML_NAMEID_FORMAT.PERSISTENT}</NameIDFormat>
    <SingleSignOnService
      Binding="${SAML_BINDINGS.REDIRECT}"
      Location="${escapeXml(config.ssoUrl)}" />
    <SingleSignOnService
      Binding="${SAML_BINDINGS.POST}"
      Location="${escapeXml(config.ssoUrl)}" />
    <SingleLogoutService
      Binding="${SAML_BINDINGS.REDIRECT}"
      Location="${escapeXml(config.sloUrl)}" />
    <SingleLogoutService
      Binding="${SAML_BINDINGS.POST}"
      Location="${escapeXml(config.sloUrl)}" />
  </IDPSSODescriptor>
</EntityDescriptor>`;
}

// ── LogoutRequest parsing ───────────────────────────────────

export interface ParsedLogoutRequest {
  issuer: string;
  nameId: string;
  sessionIndex?: string;
  requestId: string;
  relayState?: string;
  rawXml: string; // Raw XML for signature verification
}

/**
 * Parse a SAML LogoutRequest from base64.
 */
export async function parseLogoutRequest(
  samlRequest: string,
  relayState?: string
): Promise<ParsedLogoutRequest> {
  // Handle DEFLATE decompression (same as AuthnRequest)
  const decoded = atob(samlRequest);
  const bytes = Uint8Array.from(decoded, c => c.charCodeAt(0));

  let xml: string;
  try {
    const ds = new DecompressionStream("deflate-raw");
    const writer = ds.writable.getWriter();
    writer.write(bytes);
    writer.close();
    const reader = ds.readable.getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
    xml = new TextDecoder().decode(concatUint8Arrays(chunks));
  } catch {
    xml = decoded;
  }

  // Validate XML structure against wrapping attacks
  validateXmlStructure(xml);

  const issuer = extractXmlElement(xml, "saml:Issuer") ?? extractXmlElement(xml, "Issuer");
  const nameId = extractXmlElement(xml, "saml:NameID") ?? extractXmlElement(xml, "NameID");
  const sessionIndex = extractXmlElement(xml, "samlp:SessionIndex") ?? extractXmlElement(xml, "SessionIndex");
  const requestId = extractXmlAttribute(xml, "ID");

  if (!issuer) throw new Error("LogoutRequest missing Issuer");
  if (!nameId) throw new Error("LogoutRequest missing NameID");
  if (!requestId) throw new Error("LogoutRequest missing ID");

  return {
    issuer,
    nameId,
    sessionIndex: sessionIndex ?? undefined,
    requestId,
    relayState,
    rawXml: xml,
  };
}

/**
 * Generate a SAML LogoutResponse XML (base64-encoded).
 */
export function generateLogoutResponse(
  inResponseTo: string,
  issuer: string,
  destination: string,
  success: boolean
): string {
  const responseId = `_${crypto.randomUUID()}`;
  const issueInstant = new Date().toISOString();
  const statusCode = success
    ? "urn:oasis:names:tc:SAML:2.0:status:Success"
    : "urn:oasis:names:tc:SAML:2.0:status:Responder";

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<samlp:LogoutResponse
  xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"
  xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion"
  ID="${responseId}"
  Version="2.0"
  IssueInstant="${issueInstant}"
  Destination="${escapeXml(destination)}"
  InResponseTo="${escapeXml(inResponseTo)}">
  <saml:Issuer>${escapeXml(issuer)}</saml:Issuer>
  <samlp:Status>
    <samlp:StatusCode Value="${statusCode}" />
  </samlp:Status>
</samlp:LogoutResponse>`;

  return btoa(xml);
}

// ── XML helpers ─────────────────────────────────────────────

/**
 * Fix 5: Validate XML structure to defend against signature wrapping attacks.
 * Ensures critical elements (Issuer, NameID, etc.) appear at most once,
 * preventing attackers from injecting duplicate elements.
 */
function validateXmlStructure(xml: string): void {
  const criticalElements = [
    "saml:Issuer", "Issuer",
    "saml:NameID", "NameID",
    "samlp:SessionIndex", "SessionIndex",
  ];

  for (const tagName of criticalElements) {
    const regex = new RegExp(`<${tagName}[\\s>]`, "g");
    const matches = xml.match(regex);
    if (matches && matches.length > 1) {
      throw new Error(`XML structure validation failed: duplicate ${tagName} element detected`);
    }
  }

  // Ensure only one Signature element exists (prevents signature wrapping)
  const sigMatches = xml.match(/<(ds:)?Signature[\s>]/g);
  if (sigMatches && sigMatches.length > 1) {
    throw new Error("XML structure validation failed: multiple Signature elements detected");
  }
}

function extractXmlElement(xml: string, tagName: string): string | null {
  const regex = new RegExp(`<${tagName}[^>]*>([^<]*)</${tagName}>`, "s");
  const match = xml.match(regex);
  return match ? match[1].trim() : null;
}

function extractAllXmlElements(xml: string, tagName: string): string[] {
  const regex = new RegExp(`<${tagName}[^>]*>([^<]*)</${tagName}>`, "gs");
  const results: string[] = [];
  let match;
  while ((match = regex.exec(xml)) !== null) {
    results.push(match[1].trim());
  }
  return results;
}

function extractXmlAttribute(xml: string, attrName: string): string | null {
  const regex = new RegExp(`${attrName}="([^"]*)"`, "s");
  const match = xml.match(regex);
  return match ? match[1] : null;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Concatenate multiple Uint8Arrays into one.
 */
function concatUint8Arrays(arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, a) => sum + a.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}
