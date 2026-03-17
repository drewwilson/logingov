// ── Core entity types ──────────────────────────────────────

export interface User {
  id: string; // UUID v7
  email: string;
  emailVerifiedAt: string | null; // ISO 8601
  ial: 1 | 2;
  lockedAt: string | null;
  locale: string; // ISO 639-1
  // PII — AES-256-GCM encrypted at rest
  ssn: string | null; // encrypted blob
  birthdate: string | null; // encrypted blob
  address: string | null; // encrypted JSON blob
  phone: string | null; // encrypted blob
  verifiedAt: string | null;
  legacyUuid: string | null; // Old Rails UUID for pairwise sub backward compat
  createdAt: string;
  updatedAt: string;
}

export type CredentialType = "password" | "webauthn" | "totp" | "backup";

export interface Credential {
  id: string;
  userId: string;
  type: CredentialType;
  data: string; // encrypted JSON blob
  lastUsedAt: string | null;
  createdAt: string;
}

export interface ServiceProvider {
  id: string; // issuer URI
  name: string;
  ialMax: 1 | 2;
  aalMax: 1 | 2;
  redirectUris: string[]; // parsed from JSON
  publicKey: string; // PEM
  samlMetadataUrl: string | null;
  pushNotificationUrl: string | null;
  postLogoutRedirectUris: string[] | null;
  theme: Record<string, unknown> | null;
  createdAt: string;
}

export interface IdentityEvent {
  id: string;
  userId: string;
  spId: string | null;
  eventType: string;
  ial: 1 | 2 | null;
  aal: 1 | 2 | null;
  ip: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

// ── IAL / AAL levels ────────────────────────────────────────

export type IALLevel = 1 | 2;
export type AALLevel = 1 | 2;

export interface AssuranceLevels {
  ial: IALLevel;
  aal: AALLevel;
}

// ── ACR value mappings ──────────────────────────────────────

export const ACR_VALUES = {
  // Current URNs (IAL + default AAL)
  "urn:acr.login.gov:auth-only": { ial: 1, aal: 1 },
  "urn:acr.login.gov:verified": { ial: 2, aal: 2 },
  "urn:acr.login.gov:verified-facial-match-required": { ial: 2, aal: 2, facialMatch: "required" as const },
  "urn:acr.login.gov:verified-facial-match-preferred": { ial: 2, aal: 2, facialMatch: "preferred" as const },
  // Deprecated URNs (backward compat)
  "http://idmanagement.gov/ns/assurance/ial/1": { ial: 1, aal: 1 },
  "http://idmanagement.gov/ns/assurance/ial/2": { ial: 2, aal: 2 },
  "http://idmanagement.gov/ns/assurance/loa/1": { ial: 1, aal: 1 },
  "http://idmanagement.gov/ns/assurance/loa/3": { ial: 2, aal: 2 },
} as const;

export type ACRValue = keyof typeof ACR_VALUES;

// ── AAL ACR value mappings ────────────────────────────────────
// These are separate AAL-level URNs that agencies send alongside IAL ACR values.
// They modify the AAL requirement without changing the IAL.

export interface AALConfig {
  aal: AALLevel;
  phishingResistant?: boolean;
  hspd12?: boolean;
}

export const AAL_ACR_VALUES: Record<string, AALConfig> = {
  // Default: second factor required (most agencies use this)
  "urn:gov:gsa:ac:classes:sp:PasswordProtectedTransport:duo": { aal: 2 },
  // Strict AAL2: no remembered devices
  "http://idmanagement.gov/ns/assurance/aal/2": { aal: 2 },
  // Phishing-resistant: WebAuthn/PIV required
  "http://idmanagement.gov/ns/assurance/aal/2?phishing_resistant=true": { aal: 2, phishingResistant: true },
  // HSPD-12: PIV/CAC only
  "http://idmanagement.gov/ns/assurance/aal/2?hspd12=true": { aal: 2, hspd12: true },
};

/**
 * Parse acr_values string to extract IAL config and optional AAL override.
 * Login.gov allows space-separated ACR values where one is the IAL level
 * and another (optional) is an AAL modifier.
 */
export function parseAcrValues(acrValues: string): {
  acrConfig: (typeof ACR_VALUES)[ACRValue];
  primaryAcr: string;
  aalOverride?: AALConfig;
} | null {
  const parts = acrValues.split(" ").filter(Boolean);

  let primaryAcr: string | undefined;
  let acrConfig: (typeof ACR_VALUES)[ACRValue] | undefined;
  let aalOverride: AALConfig | undefined;

  for (const part of parts) {
    // Check if it's an IAL-level ACR value
    if (part in ACR_VALUES) {
      if (!primaryAcr) {
        primaryAcr = part;
        acrConfig = ACR_VALUES[part as ACRValue];
      }
    }
    // Check if it's an AAL modifier
    if (part in AAL_ACR_VALUES) {
      aalOverride = AAL_ACR_VALUES[part];
    }
  }

  if (!primaryAcr || !acrConfig) {
    return null;
  }

  return { acrConfig, primaryAcr, aalOverride };
}

// ── OIDC scopes → user attributes ──────────────────────────

export const SCOPE_ATTRIBUTES = {
  openid: ["sub", "ial", "aal"],
  email: ["email", "email_verified"],
  all_emails: ["all_emails"],
  phone: ["phone"],
  address: ["address"],
  profile: ["given_name", "family_name", "birthdate", "verified_at"],
  "profile:name": ["given_name", "family_name"],
  "profile:birthdate": ["birthdate"],
  "profile:verified_at": ["verified_at"],
  social_security_number: ["social_security_number"],
  x509: ["x509_issuer", "x509_subject", "x509_presented"],
  locale: ["locale"],
} as const;

export type OIDCScope = keyof typeof SCOPE_ATTRIBUTES;

// ── RISC / SET event types ──────────────────────────────────

export const SET_EVENT_TYPES = {
  // Standard RISC event types
  ACCOUNT_DISABLED: "https://schemas.openid.net/secevent/risc/event-type/account-disabled",
  ACCOUNT_ENABLED: "https://schemas.openid.net/secevent/risc/event-type/account-enabled",
  ACCOUNT_PURGED: "https://schemas.openid.net/secevent/risc/event-type/account-purged",
  CREDENTIAL_COMPROMISE: "https://schemas.openid.net/secevent/risc/event-type/credential-compromise",
  IDENTIFIER_CHANGED: "https://schemas.openid.net/secevent/risc/event-type/identifier-changed",
  IDENTIFIER_RECYCLED: "https://schemas.openid.net/secevent/risc/event-type/identifier-recycled",
  RECOVERY_ACTIVATED: "https://schemas.openid.net/secevent/risc/event-type/recovery-activated",
  RECOVERY_INFORMATION_CHANGED: "https://schemas.openid.net/secevent/risc/event-type/recovery-information-changed",
  SESSION_REVOKED: "https://schemas.openid.net/secevent/risc/event-type/session-revoked",
  // Login.gov custom event types
  MFA_LIMIT_ACCOUNT_LOCKED: "https://schemas.login.gov/secevent/risc/event-type/mfa-limit-account-locked",
  PASSWORD_RESET: "https://schemas.login.gov/secevent/risc/event-type/password-reset",
  REPROOF_COMPLETED: "https://schemas.login.gov/secevent/risc/event-type/reproof-completed",
  // Login.gov fraud event types (inbound from RPs)
  AUTHORIZATION_FRAUD: "https://schemas.login.gov/secevent/risc/event-type/authorization-fraud-detected",
  IDENTITY_FRAUD: "https://schemas.login.gov/secevent/risc/event-type/identity-fraud-detected",
} as const;

export type SETEventType = (typeof SET_EVENT_TYPES)[keyof typeof SET_EVENT_TYPES];
