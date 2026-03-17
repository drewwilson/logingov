/**
 * Demo Agency Worker
 *
 * A standalone Cloudflare Worker that acts as an OIDC Relying Party,
 * performing the full authorization code flow (PKCE + private_key_jwt)
 * against the Login.gov auth-core worker.
 */
import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import * as jose from "jose";

type Env = {
  AUTH_CORE_URL: string;
  AUTH_CORE?: Fetcher; // Service binding for Worker-to-Worker calls (deployed only)
  CLIENT_ID: string;
  AGENCY_ID: string;
  TOKEN_ENDPOINT_AUD: string;
  DEMO_SP_PRIVATE_KEY: string;
  ADMIN_API_KEY: string;
};

const app = new Hono<{ Bindings: Env }>();

// ── Helpers ─────────────────────────────────────────────────────

function base64url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function generateCodeVerifier(): string {
  const charset = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const bytes = crypto.getRandomValues(new Uint8Array(64));
  return Array.from(bytes, (b) => charset[b % charset.length]).join("");
}

async function computeS256Challenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64url(digest);
}

function randomHex(len: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function selfOrigin(req: Request): string {
  return new URL(req.url).origin;
}

/** Use service binding when available (deployed), fall back to global fetch (local dev). */
function authCoreFetch(env: Env, req: Request): Promise<Response> {
  return env.AUTH_CORE ? env.AUTH_CORE.fetch(req) : fetch(req);
}

function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const parts = jwt.split(".");
  if (parts.length !== 3) return {};
  const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
  return JSON.parse(atob(padded));
}

async function derivePublicKeyPem(privatePem: string): Promise<string> {
  const privateKey = await jose.importPKCS8(privatePem, "RS256");
  const jwk = await crypto.subtle.exportKey("jwk", privateKey as CryptoKey) as JsonWebKey;
  // Strip private fields to get public JWK
  const publicJwk: jose.JWK = { kty: jwk.kty!, n: jwk.n!, e: jwk.e!, alg: "RS256" };
  const publicKey = await jose.importJWK(publicJwk, "RS256");
  return jose.exportSPKI(publicKey as CryptoKey);
}

// ── GET / — Landing page ────────────────────────────────────────

app.get("/", async (c) => {
  const sessionCookie = getCookie(c, "demo_agency_session");
  let session: { userinfo: Record<string, unknown>; id_token: string; access_token: string } | null = null;

  if (sessionCookie) {
    try {
      session = JSON.parse(atob(sessionCookie));
    } catch {
      session = null;
    }
  }

  const page = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Demo Agency Portal</title>
  <style>
    :root {
      --primary: #1a4480;
      --primary-dark: #0f2d52;
      --accent: #005ea2;
      --success: #2e8540;
      --bg: #f0f4f8;
      --white: #fff;
      --gray: #71767a;
      --gray-light: #dfe1e2;
      --font: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      --mono: 'SF Mono', 'Fira Code', 'Fira Mono', monospace;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: var(--font); background: var(--bg); color: #1b1b1b; }

    .banner {
      background: var(--primary-dark); color: #fff;
      padding: 0.4rem 2rem; font-size: 0.7rem;
    }
    header {
      background: var(--primary); color: #fff;
      padding: 1rem 2rem; display: flex; align-items: center; gap: 1rem;
    }
    header h1 { font-size: 1.3rem; font-weight: 700; }
    .badge {
      background: #fdb81e; color: var(--primary-dark);
      padding: 0.15rem 0.5rem; border-radius: 3px;
      font-size: 0.65rem; font-weight: 700; text-transform: uppercase;
    }

    .container { max-width: 800px; margin: 0 auto; padding: 2rem 1.5rem; }

    .card {
      background: var(--white); border-radius: 8px;
      box-shadow: 0 1px 4px rgba(0,0,0,0.08);
      margin-bottom: 1.5rem; overflow: hidden;
    }
    .card-header {
      background: var(--primary); color: #fff;
      padding: 0.7rem 1rem; font-size: 0.85rem; font-weight: 600;
    }
    .card-body { padding: 1.25rem; }

    .btn {
      display: inline-block; font-family: var(--font); font-size: 0.9rem; font-weight: 600;
      padding: 0.7rem 1.5rem; border: none; border-radius: 4px;
      cursor: pointer; text-decoration: none; transition: opacity 0.15s;
    }
    .btn:hover { opacity: 0.85; }
    .btn-primary { background: var(--accent); color: #fff; }
    .btn-red { background: #e31c3d; color: #fff; }
    .btn-block { display: block; width: 100%; text-align: center; }

    .field { margin-bottom: 0.6rem; font-size: 0.85rem; }
    .field .label { color: var(--gray); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.03em; }
    .field .value { font-weight: 500; word-break: break-all; }

    .json-block {
      background: #1e1e1e; color: #d4d4d4; font-family: var(--mono);
      font-size: 0.72rem; padding: 1rem; border-radius: 4px;
      max-height: 400px; overflow: auto; white-space: pre-wrap;
      word-break: break-all; line-height: 1.5;
    }

    .welcome { text-align: center; padding: 3rem 1rem; }
    .welcome h2 { font-size: 1.4rem; margin-bottom: 0.5rem; }
    .welcome p { color: var(--gray); margin-bottom: 2rem; max-width: 500px; margin-left: auto; margin-right: auto; }

    .actions { display: flex; gap: 0.75rem; margin-top: 1rem; }
    .text-sm { font-size: 0.75rem; color: var(--gray); }
    .mt { margin-top: 1rem; }
    .mb { margin-bottom: 1rem; }
  </style>
</head>
<body>
  <div class="banner">An official demo of a federal agency integrating with Login.gov</div>
  <header>
    <h1>Demo Agency Portal</h1>
    <span class="badge">Demo</span>
  </header>

  <div class="container">
    ${session ? authenticatedView(session) : unauthenticatedView()}
  </div>
</body>
</html>`;

  return c.html(page);
});

function unauthenticatedView(): string {
  return `
    <div class="welcome">
      <h2>Welcome to the Demo Agency</h2>
      <p>This is a simulated federal agency portal. Click below to authenticate with Login.gov using the full OIDC authorization code flow.</p>
      <a href="/auth/start" class="btn btn-primary">Sign in with Login.gov</a>
      <p class="text-sm mt">Uses PKCE (S256) + private_key_jwt client authentication</p>
    </div>`;
}

function authenticatedView(session: { userinfo: Record<string, unknown>; id_token: string; access_token: string }): string {
  const u = session.userinfo;
  const idClaims = decodeJwtPayload(session.id_token);

  return `
    <div class="card">
      <div class="card-header">Authenticated User</div>
      <div class="card-body">
        ${field("Subject (pairwise)", u.sub)}
        ${field("Email", u.email)}
        ${field("Email Verified", u.email_verified)}
        ${field("Given Name", u.given_name)}
        ${field("Family Name", u.family_name)}
        ${field("IAL", u.ial)}
        ${field("AAL", u.aal)}
        <div class="actions">
          <a href="/logout" class="btn btn-red">Sign Out</a>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-header">ID Token Claims</div>
      <div class="card-body">
        <div class="json-block">${escapeHtml(JSON.stringify(idClaims, null, 2))}</div>
      </div>
    </div>

    <div class="card">
      <div class="card-header">UserInfo Response</div>
      <div class="card-body">
        <div class="json-block">${escapeHtml(JSON.stringify(u, null, 2))}</div>
      </div>
    </div>

    <div class="card">
      <div class="card-header">Raw Tokens</div>
      <div class="card-body">
        ${field("Access Token", session.access_token)}
        <p class="text-sm mt">ID Token (JWT)</p>
        <div class="json-block mt">${escapeHtml(session.id_token)}</div>
      </div>
    </div>`;
}

function field(label: string, value: unknown): string {
  return `<div class="field"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(String(value ?? "—"))}</div></div>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ── GET /auth/start — Initiate OIDC flow ────────────────────────

app.get("/auth/start", async (c) => {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await computeS256Challenge(codeVerifier);
  const state = randomHex(16);
  const nonce = randomHex(16);

  // Store PKCE + state + nonce in cookie
  const pkceData = btoa(JSON.stringify({ code_verifier: codeVerifier, state, nonce }));
  setCookie(c, "demo_agency_pkce", pkceData, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === "https:",
    sameSite: "Lax",
    maxAge: 600,
    path: "/",
  });

  const origin = selfOrigin(c.req.raw);
  const params = new URLSearchParams({
    client_id: c.env.CLIENT_ID,
    redirect_uri: `${origin}/callback`,
    response_type: "code",
    scope: "openid email profile",
    state,
    nonce,
    acr_values: "urn:acr.login.gov:auth-only",
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  const authorizeUrl = `${c.env.AUTH_CORE_URL}/openid_connect/authorize?${params.toString()}`;
  return c.redirect(authorizeUrl, 302);
});

// ── GET /callback — Handle authorization response ───────────────

app.get("/callback", async (c) => {
  // Check for errors
  const error = c.req.query("error");
  if (error) {
    const desc = c.req.query("error_description") || "Unknown error";
    return c.html(errorPage("Authorization Error", `${error}: ${desc}`));
  }

  const code = c.req.query("code");
  const returnedState = c.req.query("state");
  if (!code || !returnedState) {
    return c.html(errorPage("Missing Parameters", "code and state are required"), 400);
  }

  // Retrieve PKCE data from cookie
  const pkceCookie = getCookie(c, "demo_agency_pkce");
  if (!pkceCookie) {
    return c.html(errorPage("Session Expired", "PKCE cookie not found — try signing in again"), 400);
  }

  let pkceData: { code_verifier: string; state: string; nonce: string };
  try {
    pkceData = JSON.parse(atob(pkceCookie));
  } catch {
    return c.html(errorPage("Invalid Session", "Could not decode PKCE cookie"), 400);
  }

  // Verify state
  if (returnedState !== pkceData.state) {
    return c.html(errorPage("State Mismatch", "CSRF protection: state parameter does not match"), 400);
  }

  // ── Token exchange ──────────────────────────────────────────
  const privateKey = await jose.importPKCS8(c.env.DEMO_SP_PRIVATE_KEY, "RS256");

  const clientAssertion = await new jose.SignJWT({
    iss: c.env.CLIENT_ID,
    sub: c.env.CLIENT_ID,
    aud: c.env.TOKEN_ENDPOINT_AUD,
    jti: crypto.randomUUID(),
  })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);

  const origin = selfOrigin(c.req.raw);
  const tokenBody = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: `${origin}/callback`,
    code_verifier: pkceData.code_verifier,
    client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
    client_assertion: clientAssertion,
  });

  const tokenRes = await authCoreFetch(c.env,
    new Request(`${c.env.AUTH_CORE_URL}/api/openid_connect/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenBody.toString(),
    })
  );

  if (!tokenRes.ok) {
    const errBody = await tokenRes.text();
    return c.html(errorPage("Token Exchange Failed", `${tokenRes.status}: ${errBody}`), 502);
  }

  const tokenData = (await tokenRes.json()) as {
    access_token: string;
    token_type: string;
    expires_in: number;
    id_token: string;
  };

  // ── Fetch userinfo ──────────────────────────────────────────
  const userinfoRes = await authCoreFetch(c.env,
    new Request(`${c.env.AUTH_CORE_URL}/api/openid_connect/userinfo`, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    })
  );

  if (!userinfoRes.ok) {
    const errBody = await userinfoRes.text();
    return c.html(errorPage("UserInfo Failed", `${userinfoRes.status}: ${errBody}`), 502);
  }

  const userinfo = (await userinfoRes.json()) as Record<string, unknown>;

  // ── Set session cookie and redirect ─────────────────────────
  const sessionPayload = btoa(
    JSON.stringify({
      userinfo,
      id_token: tokenData.id_token,
      access_token: tokenData.access_token,
    })
  );

  setCookie(c, "demo_agency_session", sessionPayload, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === "https:",
    sameSite: "Lax",
    maxAge: 900, // 15 min, matching access token TTL
    path: "/",
  });

  // Clear PKCE cookie
  deleteCookie(c, "demo_agency_pkce", { path: "/" });

  return c.redirect("/", 302);
});

// ── GET /logout — Clear session ─────────────────────────────────

app.get("/logout", (c) => {
  deleteCookie(c, "demo_agency_session", { path: "/" });
  return c.redirect("/", 302);
});

// ── GET /setup — One-time SP registration ───────────────────────

app.get("/setup", async (c) => {
  try {
    const publicKeyPem = await derivePublicKeyPem(c.env.DEMO_SP_PRIVATE_KEY);
    const origin = selfOrigin(c.req.raw);

    const spPayload: Record<string, unknown> = {
      id: c.env.CLIENT_ID,
      name: "Demo Agency",
      agencyId: c.env.AGENCY_ID || undefined,
      ialMax: 1,
      aalMax: 1,
      redirectUris: [`${origin}/callback`, "http://localhost:8788/callback"],
      publicKey: publicKeyPem,
      postLogoutRedirectUris: [origin, "http://localhost:8788"],
    };

    const res = await authCoreFetch(c.env,
      new Request(`${c.env.AUTH_CORE_URL}/admin/service-providers`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${c.env.ADMIN_API_KEY}`,
        },
        body: JSON.stringify(spPayload),
      })
    );

    const data = await res.json();

    const statusMsg =
      res.status === 201
        ? "Service provider registered successfully!"
        : res.status === 409
          ? "Service provider already exists (this is fine)."
          : `Unexpected response: ${res.status}`;

    return c.html(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Demo Agency — Setup</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f0f4f8; color: #1b1b1b; padding: 2rem; }
    .card { max-width: 700px; margin: 0 auto; background: #fff; border-radius: 8px; box-shadow: 0 1px 4px rgba(0,0,0,0.08); overflow: hidden; }
    .card-header { background: #1a4480; color: #fff; padding: 0.7rem 1rem; font-weight: 600; }
    .card-body { padding: 1.25rem; }
    .status { padding: 0.75rem; border-radius: 4px; margin-bottom: 1rem; font-weight: 600; }
    .status.ok { background: #d4edda; color: #155724; }
    .status.warn { background: #fff3cd; color: #856404; }
    .status.err { background: #f8d7da; color: #721c24; }
    pre { background: #1e1e1e; color: #d4d4d4; font-size: 0.72rem; padding: 1rem; border-radius: 4px; overflow: auto; white-space: pre-wrap; word-break: break-all; }
    a { color: #005ea2; }
    .mt { margin-top: 1rem; }
  </style>
</head>
<body>
  <div class="card">
    <div class="card-header">Demo Agency — Setup</div>
    <div class="card-body">
      <div class="status ${res.status === 201 ? "ok" : res.status === 409 ? "warn" : "err"}">${escapeHtml(statusMsg)}</div>
      <p><strong>Client ID:</strong> ${escapeHtml(c.env.CLIENT_ID)}</p>
      ${c.env.AGENCY_ID ? `<p><strong>Agency ID:</strong> ${escapeHtml(c.env.AGENCY_ID)}</p>` : ""}
      <p><strong>Redirect URIs:</strong> ${origin}/callback, http://localhost:8788/callback</p>
      <div class="mt">
        <p><strong>Response:</strong></p>
        <pre>${escapeHtml(JSON.stringify(data, null, 2))}</pre>
      </div>
      <p class="mt"><a href="/">Go to Demo Agency Portal</a></p>
    </div>
  </div>
</body>
</html>`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.html(errorPage("Setup Failed", msg), 500);
  }
});

// ── GET /health ─────────────────────────────────────────────────

app.get("/health", (c) => c.json({ ok: true, service: "demo-agency" }));

// ── Error page helper ───────────────────────────────────────────

function errorPage(title: string, detail: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Demo Agency — Error</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f0f4f8; color: #1b1b1b; padding: 2rem; }
    .card { max-width: 600px; margin: 0 auto; background: #fff; border-radius: 8px; box-shadow: 0 1px 4px rgba(0,0,0,0.08); overflow: hidden; }
    .card-header { background: #e31c3d; color: #fff; padding: 0.7rem 1rem; font-weight: 600; }
    .card-body { padding: 1.25rem; }
    pre { background: #1e1e1e; color: #d4d4d4; font-size: 0.75rem; padding: 1rem; border-radius: 4px; overflow: auto; white-space: pre-wrap; word-break: break-all; margin-top: 0.75rem; }
    a { color: #005ea2; }
    .mt { margin-top: 1rem; }
  </style>
</head>
<body>
  <div class="card">
    <div class="card-header">${escapeHtml(title)}</div>
    <div class="card-body">
      <pre>${escapeHtml(detail)}</pre>
      <p class="mt"><a href="/">Back to Demo Agency</a> | <a href="/auth/start">Try again</a></p>
    </div>
  </div>
</body>
</html>`;
}

export default app;
