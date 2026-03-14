/**
 * Persona API Client
 *
 * Typed client for Persona's document verification and facial match APIs.
 * Uses fetch() — no Node.js dependencies. Suitable for Cloudflare Workers.
 */

const PERSONA_BASE_URL = "https://withpersona.com/api/v1";

// ── Types ────────────────────────────────────────────────────

export interface PersonaDocumentVerification {
  inquiryId: string;
  status: "completed" | "failed" | "pending" | "expired" | "needs_review";
  fields: {
    firstName: string;
    lastName: string;
    birthdate: string; // YYYY-MM-DD
    addressStreet: string;
    addressCity: string;
    addressState: string;
    addressPostalCode: string;
    addressCountryCode: string;
    ssn?: string;
  };
  documentType: string;
  issuingCountry: string;
  completedAt: string | null;
}

export interface PersonaFacialMatchResult {
  inquiryId: string;
  status: "passed" | "failed" | "not_applicable";
  confidenceScore: number; // 0–100
  completedAt: string | null;
}

export interface PersonaInquiryResponse {
  data: {
    id: string;
    type: string;
    attributes: {
      status: string;
      "reference-id": string | null;
      "created-at": string;
      "completed-at": string | null;
      fields: Record<string, { type: string; value: string | null }>;
    };
    relationships: Record<string, unknown>;
  };
}

export interface PersonaVerificationResponse {
  data: {
    id: string;
    type: string;
    attributes: {
      status: string;
      "created-at": string;
      "completed-at": string | null;
      checks: Array<{
        name: string;
        status: string;
        reasons: string[];
      }>;
    };
  };
}

export interface PersonaError {
  errors: Array<{
    title: string;
    detail: string;
    status: string;
  }>;
}

export class PersonaApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly errors: PersonaError["errors"],
    message?: string
  ) {
    super(message ?? `Persona API error: ${errors.map((e) => e.detail).join(", ")}`);
    this.name = "PersonaApiError";
  }
}

// ── Client ───────────────────────────────────────────────────

export class PersonaClient {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private headers(): HeadersInit {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "Persona-Version": "2023-01-05",
    };
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${PERSONA_BASE_URL}${path}`;
    const resp = await fetch(url, {
      method,
      headers: this.headers(),
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!resp.ok) {
      let errors: PersonaError["errors"] = [];
      try {
        const errorBody = (await resp.json()) as PersonaError;
        errors = errorBody.errors ?? [];
      } catch {
        // If the response isn't JSON, use a generic error
      }
      throw new PersonaApiError(resp.status, errors);
    }

    return (await resp.json()) as T;
  }

  /**
   * Create a new inquiry for document verification.
   */
  async createInquiry(
    templateId: string,
    referenceId: string
  ): Promise<{ inquiryId: string; sessionToken: string }> {
    const resp = await this.request<{
      data: { id: string; attributes: { "session-token": string } };
    }>("POST", "/inquiries", {
      data: {
        attributes: {
          "inquiry-template-id": templateId,
          "reference-id": referenceId,
        },
      },
    });

    return {
      inquiryId: resp.data.id,
      sessionToken: resp.data.attributes["session-token"],
    };
  }

  /**
   * Get inquiry status and extracted fields after document submission.
   */
  async getInquiry(inquiryId: string): Promise<PersonaDocumentVerification> {
    const resp = await this.request<PersonaInquiryResponse>("GET", `/inquiries/${inquiryId}`);
    const attrs = resp.data.attributes;
    const fields = attrs.fields;

    const getValue = (key: string): string => fields[key]?.value ?? "";

    return {
      inquiryId: resp.data.id,
      status: attrs.status as PersonaDocumentVerification["status"],
      fields: {
        firstName: getValue("name-first"),
        lastName: getValue("name-last"),
        birthdate: getValue("birthdate"),
        addressStreet: getValue("address-street-1"),
        addressCity: getValue("address-city"),
        addressState: getValue("address-subdivision"),
        addressPostalCode: getValue("address-postal-code"),
        addressCountryCode: getValue("address-country-code"),
        ssn: getValue("identification-number") || undefined,
      },
      documentType: getValue("identification-class"),
      issuingCountry: getValue("country-code"),
      completedAt: attrs["completed-at"],
    };
  }

  /**
   * Retrieve facial match / biometric verification results.
   */
  async getFacialMatchResult(verificationId: string): Promise<PersonaFacialMatchResult> {
    const resp = await this.request<PersonaVerificationResponse>(
      "GET",
      `/verifications/${verificationId}`
    );
    const attrs = resp.data.attributes;

    const selfieCheck = attrs.checks.find(
      (c) => c.name === "selfie_comparison" || c.name === "selfie_id_comparison"
    );

    return {
      inquiryId: resp.data.id,
      status: selfieCheck?.status === "passed" ? "passed" : "failed",
      confidenceScore: selfieCheck?.status === "passed" ? 100 : 0,
      completedAt: attrs["completed-at"],
    };
  }

  /**
   * List verifications for an inquiry (to find the facial match verification).
   */
  async listVerifications(
    inquiryId: string
  ): Promise<Array<{ id: string; type: string; status: string }>> {
    const resp = await this.request<{
      data: Array<{ id: string; type: string; attributes: { status: string } }>;
    }>("GET", `/inquiries/${inquiryId}/verifications`);

    return resp.data.map((v) => ({
      id: v.id,
      type: v.type,
      status: v.attributes.status,
    }));
  }

  /**
   * Resume an existing inquiry (e.g., for re-proofing).
   */
  async resumeInquiry(inquiryId: string): Promise<{ sessionToken: string }> {
    const resp = await this.request<{
      data: { attributes: { "session-token": string } };
    }>("POST", `/inquiries/${inquiryId}/resume`);

    return {
      sessionToken: resp.data.attributes["session-token"],
    };
  }
}
