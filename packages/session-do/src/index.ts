/**
 * SessionDO — Durable Object for auth session state.
 *
 * Each active auth flow gets its own DO instance, co-located with the user.
 * Stores PKCE challenge, nonce, scopes, IAL/AAL target, MFA state, x509 metadata.
 * Alarm-based TTL automatically cleans up expired sessions.
 */

export interface SessionState {
  userId?: string;
  spId: string;
  // OIDC flow state
  responseType: string;
  redirectUri: string;
  scopes: string[];
  nonce?: string;
  state?: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
  // Assurance levels
  requestedIal: 1 | 2;
  requestedAal: 1 | 2;
  achievedIal?: 1 | 2;
  achievedAal?: 1 | 2;
  phishingResistant?: boolean;
  hspd12?: boolean;
  facialMatch?: "required" | "preferred";
  // MFA state
  mfaVerified: boolean;
  mfaMethod?: string; // totp | webauthn | sms | backup | piv
  // x509 / PIV/CAC (transient — from mTLS headers)
  x509Presented?: boolean;
  x509Issuer?: string;
  x509Subject?: string;
  // Locale
  locale: string;
  // Remembered device
  rememberedDevice?: boolean;
  // Timestamps
  createdAt: string;
  expiresAt: string;
}

const DEFAULT_TTL_MS = 15 * 60 * 1000; // 15 minutes
const REMEMBERED_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export class SessionDO implements DurableObject {
  private state: DurableObjectState;
  private session: SessionState | null = null;

  constructor(state: DurableObjectState, _env: unknown) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const method = request.method;

    switch (`${method} ${url.pathname}`) {
      case "POST /create":
        return this.handleCreate(request);
      case "GET /get":
        return this.handleGet();
      case "PATCH /update":
        return this.handleUpdate(request);
      case "DELETE /destroy":
        return this.handleDestroy();
      default:
        return new Response("Not Found", { status: 404 });
    }
  }

  /**
   * Create a new session. Sets an alarm for TTL expiry.
   */
  private async handleCreate(request: Request): Promise<Response> {
    const body = (await request.json()) as SessionState;
    this.session = body;

    await this.state.storage.put("session", body);

    // Set alarm for TTL
    const ttl = body.rememberedDevice ? REMEMBERED_TTL_MS : DEFAULT_TTL_MS;
    const expiresAt = Date.now() + ttl;
    this.session.expiresAt = new Date(expiresAt).toISOString();
    await this.state.storage.put("session", this.session);
    await this.state.storage.setAlarm(expiresAt);

    return new Response(JSON.stringify({ ok: true, expiresAt: this.session.expiresAt }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  }

  /**
   * Get current session state.
   */
  private async handleGet(): Promise<Response> {
    if (!this.session) {
      this.session = await this.state.storage.get<SessionState>("session") ?? null;
    }

    if (!this.session) {
      return new Response(JSON.stringify({ error: "session_not_found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Check if expired
    if (new Date(this.session.expiresAt) < new Date()) {
      await this.cleanup();
      return new Response(JSON.stringify({ error: "session_expired" }), {
        status: 410,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify(this.session), {
      headers: { "Content-Type": "application/json" },
    });
  }

  /**
   * Update session state (e.g., after MFA verification, proofing).
   */
  private async handleUpdate(request: Request): Promise<Response> {
    if (!this.session) {
      this.session = await this.state.storage.get<SessionState>("session") ?? null;
    }

    if (!this.session) {
      return new Response(JSON.stringify({ error: "session_not_found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    const wasRemembered = this.session.rememberedDevice;
    const rawUpdates = (await request.json()) as Partial<SessionState>;

    // Filter updates to only permitted fields — prevent overwriting OIDC flow
    // state (spId, redirectUri, scopes, codeChallenge, etc.) or timestamps.
    const ALLOWED_UPDATE_FIELDS = new Set([
      "userId", "mfaVerified", "mfaMethod", "achievedAal", "achievedIal",
      "x509Presented", "x509Issuer", "x509Subject", "locale",
      "rememberedDevice", "phishingResistant", "hspd12", "facialMatch",
    ]);

    const updates: Partial<SessionState> = {};
    for (const key of Object.keys(rawUpdates) as Array<keyof SessionState>) {
      if (ALLOWED_UPDATE_FIELDS.has(key)) {
        (updates as Record<string, unknown>)[key] = rawUpdates[key];
      }
    }

    this.session = { ...this.session, ...updates };
    await this.state.storage.put("session", this.session);

    // If rememberedDevice was just set, extend TTL to 30 days
    if (updates.rememberedDevice === true && !wasRemembered) {
      const expiresAt = Date.now() + REMEMBERED_TTL_MS;
      this.session.expiresAt = new Date(expiresAt).toISOString();
      await this.state.storage.put("session", this.session);
      await this.state.storage.setAlarm(expiresAt);
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  /**
   * Destroy session (logout, fraud action).
   */
  private async handleDestroy(): Promise<Response> {
    await this.cleanup();
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  /**
   * Alarm handler — automatic cleanup on TTL expiry.
   */
  async alarm(): Promise<void> {
    await this.cleanup();
  }

  private async cleanup(): Promise<void> {
    this.session = null;
    await this.state.storage.deleteAll();
  }
}
