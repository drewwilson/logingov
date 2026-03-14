/**
 * Demo Page — GET /demo
 *
 * Functional demo that lets you create an account, log in, enable 2FA,
 * and exercise the OIDC endpoints — all powered by Better Auth.
 */
import { Hono } from "hono";
import { html } from "hono/html";
import type { Env } from "@logingov/shared";

const demoRoute = new Hono<{ Bindings: Env }>();

// Gate all demo routes — block in production
demoRoute.use("/demo/*", async (c, next) => {
  if (c.env.ENVIRONMENT === "production") {
    return c.json({ error: "Not available" }, 404);
  }
  await next();
});
demoRoute.use("/demo", async (c, next) => {
  if (c.env.ENVIRONMENT === "production") {
    return c.json({ error: "Not available" }, 404);
  }
  await next();
  // Relax CSP for the demo page (inline styles + scripts)
  c.header(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "base-uri 'none'",
    ].join("; ")
  );
});

demoRoute.get("/demo", async (c) => {
  const page = html`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Login.gov — Demo</title>
  <style>
    :root {
      --navy: #112e51;
      --blue: #0071bc;
      --red: #e31c3d;
      --green: #2e8540;
      --gold: #fdb81e;
      --gray-lightest: #f1f1f1;
      --gray-light: #d6d7d9;
      --gray: #5b616b;
      --white: #fff;
      --font: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      --mono: 'SF Mono', 'Fira Code', 'Fira Mono', monospace;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: var(--font); background: var(--gray-lightest); color: #212121; }
    header {
      background: var(--navy); color: var(--white);
      padding: 1rem 2rem; display: flex; align-items: center; gap: 1rem;
    }
    header h1 { font-size: 1.4rem; font-weight: 600; }
    .badge {
      padding: 0.2rem 0.6rem; border-radius: 4px;
      font-size: 0.7rem; font-weight: 700; text-transform: uppercase;
    }
    .badge-gold { background: var(--gold); color: var(--navy); }
    .badge-green { background: var(--green); color: var(--white); }
    .badge-red { background: var(--red); color: var(--white); }

    .container { max-width: 960px; margin: 0 auto; padding: 1.5rem; }

    .card {
      background: var(--white); border-radius: 8px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.08);
      margin-bottom: 1rem; overflow: hidden;
    }
    .card-header {
      background: var(--navy); color: var(--white);
      padding: 0.6rem 1rem; font-size: 0.85rem; font-weight: 600;
      display: flex; justify-content: space-between; align-items: center;
    }
    .card-body { padding: 1rem; }

    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
    @media (max-width: 700px) { .grid { grid-template-columns: 1fr; } }

    label { display: block; font-size: 0.75rem; color: var(--gray); margin-bottom: 0.25rem; text-transform: uppercase; letter-spacing: 0.03em; }
    input, select {
      width: 100%; font-family: var(--mono); font-size: 0.8rem;
      padding: 0.5rem; border: 1px solid var(--gray-light); border-radius: 4px;
      margin-bottom: 0.75rem;
    }
    input:focus, select:focus { outline: 2px solid var(--blue); border-color: var(--blue); }

    button {
      font-family: var(--font); font-size: 0.8rem; font-weight: 600;
      padding: 0.5rem 1rem; border: none; border-radius: 4px;
      cursor: pointer; transition: opacity 0.15s;
    }
    button:hover { opacity: 0.85; }
    button:disabled { opacity: 0.4; cursor: not-allowed; }
    .btn-blue { background: var(--blue); color: var(--white); }
    .btn-green { background: var(--green); color: var(--white); }
    .btn-red { background: var(--red); color: var(--white); }
    .btn-navy { background: var(--navy); color: var(--white); }
    .btn-block { width: 100%; }

    .log {
      background: #1e1e1e; color: #d4d4d4; font-family: var(--mono);
      font-size: 0.72rem; padding: 0.75rem; border-radius: 4px;
      max-height: 300px; overflow-y: auto; white-space: pre-wrap;
      word-break: break-all; line-height: 1.5;
    }
    .log .ok { color: #4ec9b0; }
    .log .err { color: #f44747; }
    .log .info { color: #569cd6; }
    .log .dim { color: #808080; }

    .session-box {
      border: 2px solid var(--green); border-radius: 8px;
      padding: 1rem; margin-bottom: 1rem;
    }
    .session-box.none { border-color: var(--gray-light); }
    .session-box h3 { font-size: 0.85rem; margin-bottom: 0.5rem; }
    .session-box .field { font-size: 0.8rem; margin-bottom: 0.3rem; }
    .session-box .field span { color: var(--gray); }

    .hidden { display: none; }
    .mb { margin-bottom: 0.75rem; }
    .mt { margin-top: 0.75rem; }
    .text-center { text-align: center; }
    .text-sm { font-size: 0.75rem; color: var(--gray); }

    .totp-uri {
      background: #f5f5f5; padding: 0.5rem; border-radius: 4px;
      font-family: var(--mono); font-size: 0.65rem;
      word-break: break-all; margin: 0.5rem 0;
    }

    .step-indicator {
      display: flex; gap: 0.5rem; margin-bottom: 1rem; flex-wrap: wrap;
    }
    .step {
      padding: 0.3rem 0.7rem; border-radius: 20px;
      font-size: 0.7rem; font-weight: 600;
      background: var(--gray-light); color: var(--gray);
    }
    .step.active { background: var(--blue); color: var(--white); }
    .step.done { background: var(--green); color: var(--white); }
  </style>
  <script src="https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js" integrity="sha384-lQXOAyZwHXE55JFyrOMB7nY2Wv+m5ZWNtJcHrd1rceRQXAYNLak8ukN5TjBTcIwz" crossorigin="anonymous"></script>
</head>
<body>
  <header>
    <h1>Login.gov</h1>
    <span class="badge badge-gold">Demo</span>
    <span id="auth-badge" class="badge badge-red">Not signed in</span>
  </header>

  <div class="container">

    <!-- Progress -->
    <div class="step-indicator">
      <span class="step active" id="step-1">1. Create Account</span>
      <span class="step" id="step-2">2. Sign In</span>
      <span class="step" id="step-3">3. Session</span>
      <span class="step" id="step-4">4. Enable 2FA</span>
      <span class="step" id="step-5">5. OIDC</span>
    </div>

    <!-- Current Session -->
    <div class="session-box none" id="session-box">
      <h3>Session</h3>
      <div id="session-info" class="text-sm">No active session</div>
    </div>

    <div class="grid">
      <!-- Left Column: Auth Actions -->
      <div>
        <!-- Sign Up -->
        <div class="card" id="card-signup">
          <div class="card-header">Create Account</div>
          <div class="card-body">
            <label>Name</label>
            <input id="signup-name" value="Demo User" placeholder="Full name" />
            <label>Email</label>
            <input id="signup-email" type="email" value="demo@login.gov" placeholder="you@example.com" />
            <label>Password</label>
            <input id="signup-password" type="password" value="SuperSecure123!" placeholder="Min 8 characters" />
            <button class="btn-blue btn-block" onclick="signUp()">Create Account</button>
          </div>
        </div>

        <!-- Sign In -->
        <div class="card" id="card-signin">
          <div class="card-header">Sign In</div>
          <div class="card-body">
            <label>Email</label>
            <input id="signin-email" type="email" value="demo@login.gov" />
            <label>Password</label>
            <input id="signin-password" type="password" value="SuperSecure123!" />
            <button class="btn-green btn-block" onclick="signIn()">Sign In</button>
            <div class="mt text-sm" style="background:#f0f7ff;padding:0.5rem;border-radius:4px;border-left:3px solid var(--blue);">
              <strong>Migrated test account:</strong><br/>
              testmigration@example.gov / Password123!
              <br/><button style="margin-top:0.4rem;font-size:0.7rem;background:var(--blue);color:#fff;padding:0.2rem 0.5rem;border-radius:3px;border:none;cursor:pointer;" onclick="document.getElementById('signin-email').value='testmigration@example.gov';document.getElementById('signin-password').value='Password123!'">Use migrated account</button>
            </div>
          </div>
        </div>

        <!-- Social Login -->
        <div class="card" id="card-social">
          <div class="card-header">Social Login</div>
          <div class="card-body">
            <p class="text-sm mb">Sign in with an external identity provider.</p>
            <button class="btn-block mb" onclick="socialSignIn('google')" style="background:#4285f4;color:#fff;display:flex;align-items:center;justify-content:center;gap:0.5rem;">
              <svg width="16" height="16" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.9 33.1 29.4 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 8 3l5.7-5.7C34 6 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.2-2.7-.4-3.9z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.3 15.7 18.8 13 24 13c3.1 0 5.8 1.2 8 3l5.7-5.7C34 6 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.4 0-9.9-3.5-11.5-8.3l-6.5 5C9.5 39.4 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C36.7 39.5 44 34 44 24c0-1.3-.2-2.7-.4-3.9z"/></svg>
              Sign in with Google
            </button>
            <button class="btn-block" onclick="socialSignIn('github')" style="background:#24292f;color:#fff;display:flex;align-items:center;justify-content:center;gap:0.5rem;">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
              Sign in with GitHub
            </button>
          </div>
        </div>

        <!-- 2FA -->
        <div class="card" id="card-2fa">
          <div class="card-header">
            Two-Factor Authentication
            <span id="2fa-status" class="badge badge-red" style="font-size:0.6rem">Off</span>
          </div>
          <div class="card-body">
            <div id="2fa-setup">
              <p class="text-sm mb">Enable TOTP-based 2FA to protect your account.</p>
              <button class="btn-blue btn-block" onclick="enableTwoFactor()">Enable 2FA</button>
            </div>
            <div id="2fa-totp" class="hidden">
              <p class="text-sm mb">Scan this QR code with your authenticator app:</p>
              <div id="totp-qr" class="text-center mb"></div>
              <details class="mb"><summary class="text-sm" style="cursor:pointer">Show TOTP URI</summary><div class="totp-uri" id="totp-uri"></div></details>
              <label>Enter TOTP Code</label>
              <input id="totp-code" placeholder="123456" maxlength="6" />
              <button class="btn-green btn-block" onclick="verifyTOTP()">Verify TOTP</button>
            </div>
            <div id="2fa-done" class="hidden">
              <p class="text-sm">2FA is enabled. You can generate backup codes or disable 2FA.</p>
              <div class="mt">
                <button class="btn-navy" onclick="generateBackupCodes()">Generate Backup Codes</button>
                <button class="btn-red" onclick="disableTwoFactor()">Disable 2FA</button>
              </div>
              <div id="backup-codes" class="hidden mt">
                <label>Backup Codes</label>
                <div class="log" id="backup-codes-list"></div>
              </div>
            </div>
          </div>
        </div>

        <!-- Sign Out -->
        <div class="card">
          <div class="card-body">
            <button class="btn-red btn-block" onclick="signOut()">Sign Out</button>
          </div>
        </div>

        <!-- OIDC Endpoints -->
        <div class="card">
          <div class="card-header">OIDC Endpoints</div>
          <div class="card-body">
            <button class="btn-navy btn-block mb" onclick="fetchDiscovery()">Fetch Discovery Document</button>
            <button class="btn-navy btn-block mb" onclick="fetchCerts()">Fetch JWKS</button>
            <button class="btn-navy btn-block mb" onclick="testAuthorize()">Test /authorize</button>
            <button class="btn-navy btn-block" onclick="fetchHealth()">Health Check (all workers)</button>
          </div>
        </div>
      </div>

      <!-- Right Column: Log -->
      <div>
        <div class="card">
          <div class="card-header">
            Activity Log
            <button style="background:transparent;color:var(--white);font-size:0.7rem;border:1px solid rgba(255,255,255,0.3);padding:0.2rem 0.5rem;border-radius:3px;" onclick="clearLog()">Clear</button>
          </div>
          <div class="card-body">
            <div class="log" id="log"><span class="info">Ready. Create an account to get started.</span></div>
          </div>
        </div>
      </div>
    </div>

  </div>

  <script>
    const API = '/api/auth';

    // ── Logging ──────────────────────────────────────────────────
    const logEl = document.getElementById('log');
    function log(msg, cls = '') {
      const ts = new Date().toLocaleTimeString();
      const line = document.createElement('div');
      line.innerHTML = '<span class="dim">' + ts + '</span> ' + (cls ? '<span class="' + cls + '">' + msg + '</span>' : msg);
      logEl.appendChild(line);
      logEl.scrollTop = logEl.scrollHeight;
    }
    function logJSON(label, data) {
      log(label + ':\\n' + JSON.stringify(data, null, 2), 'info');
    }
    function clearLog() { logEl.innerHTML = ''; }

    // ── API helper ───────────────────────────────────────────────
    async function api(path, opts = {}) {
      const url = API + path;
      const method = opts.method || 'GET';
      log(method + ' ' + url);

      const hasBody = method !== 'GET' && method !== 'HEAD';
      const fetchOpts = {
        method,
        credentials: 'include',
        headers: { ...(hasBody ? { 'Content-Type': 'application/json' } : {}), ...opts.headers },
        ...(hasBody ? { body: JSON.stringify(opts.body || {}) } : {}),
      };

      const t0 = performance.now();
      const res = await fetch(url, fetchOpts);
      const ms = Math.round(performance.now() - t0);

      let data;
      const text = await res.text();
      try { data = JSON.parse(text); } catch { data = text; }

      if (res.ok) {
        log('\\u2713 ' + res.status + ' (' + ms + 'ms)', 'ok');
      } else {
        log('\\u2717 ' + res.status + ' (' + ms + 'ms)', 'err');
      }
      if (typeof data === 'object') {
        logJSON('Response', data);
      } else if (data) {
        log(data);
      }
      return { ok: res.ok, status: res.status, data, headers: res.headers };
    }

    // ── Session state ────────────────────────────────────────────
    let currentSession = null;
    let currentPassword = '';

    async function refreshSession() {
      try {
        const { ok, data } = await api('/get-session', {
          method: 'GET',
          headers: { Accept: 'application/json' },
        });
        const box = document.getElementById('session-box');
        const info = document.getElementById('session-info');
        const badge = document.getElementById('auth-badge');

        if (ok && data && data.user) {
          currentSession = data;
          box.classList.remove('none');
          info.innerHTML =
            '<div class="field"><span>User:</span> ' + data.user.name + ' (' + data.user.email + ')</div>' +
            '<div class="field"><span>ID:</span> ' + data.user.id + '</div>' +
            '<div class="field"><span>Session:</span> ' + data.session.id + '</div>' +
            '<div class="field"><span>2FA:</span> ' + (data.user.twoFactorEnabled ? 'Enabled' : 'Disabled') + '</div>' +
            '<div class="field"><span>Expires:</span> ' + new Date(data.session.expiresAt).toLocaleString() + '</div>';
          badge.textContent = data.user.name;
          badge.className = 'badge badge-green';
          setStep(3);

          // Update 2FA UI
          if (data.user.twoFactorEnabled) {
            document.getElementById('2fa-status').textContent = 'On';
            document.getElementById('2fa-status').className = 'badge badge-green';
            document.getElementById('2fa-setup').classList.add('hidden');
            document.getElementById('2fa-totp').classList.add('hidden');
            document.getElementById('2fa-done').classList.remove('hidden');
            setStep(4);
          } else {
            document.getElementById('2fa-status').textContent = 'Off';
            document.getElementById('2fa-status').className = 'badge badge-red';
            document.getElementById('2fa-setup').classList.remove('hidden');
            document.getElementById('2fa-totp').classList.add('hidden');
            document.getElementById('2fa-done').classList.add('hidden');
          }
        } else {
          currentSession = null;
          box.classList.add('none');
          info.textContent = 'No active session';
          badge.textContent = 'Not signed in';
          badge.className = 'badge badge-red';
        }
      } catch (e) {
        log('Session check failed: ' + e.message, 'err');
      }
    }

    // ── Steps ────────────────────────────────────────────────────
    function setStep(n) {
      for (let i = 1; i <= 5; i++) {
        const el = document.getElementById('step-' + i);
        el.classList.remove('active', 'done');
        if (i < n) el.classList.add('done');
        else if (i === n) el.classList.add('active');
      }
    }

    // ── Sign Up ──────────────────────────────────────────────────
    async function signUp() {
      const name = document.getElementById('signup-name').value;
      const email = document.getElementById('signup-email').value;
      const password = document.getElementById('signup-password').value;

      if (!email || !password || !name) {
        log('Please fill in all fields', 'err');
        return;
      }

      log('Creating account for ' + email + '...', 'info');
      currentPassword = password;
      const { ok, data } = await api('/sign-up/email', {
        method: 'POST',
        body: { name, email, password },
      });

      if (ok) {
        log('Account created successfully!', 'ok');
        setStep(2);
        await refreshSession();
      } else {
        log('Sign up failed: ' + (data?.message || data?.error || 'Unknown error'), 'err');
      }
    }

    // ── Sign In ──────────────────────────────────────────────────
    async function signIn() {
      const email = document.getElementById('signin-email').value;
      const password = document.getElementById('signin-password').value;

      if (!email || !password) {
        log('Please fill in email and password', 'err');
        return;
      }

      log('Signing in as ' + email + '...', 'info');
      currentPassword = password;
      const { ok, data } = await api('/sign-in/email', {
        method: 'POST',
        body: { email, password },
      });

      if (ok) {
        log('Signed in successfully!', 'ok');
        await refreshSession();
      } else {
        // Check if 2FA is required
        if (data?.twoFactorRedirect) {
          log('2FA required — enter your TOTP code below', 'info');
          document.getElementById('2fa-setup').classList.add('hidden');
          document.getElementById('2fa-totp').classList.remove('hidden');
          document.getElementById('2fa-done').classList.add('hidden');
        } else {
          log('Sign in failed: ' + (data?.message || data?.error || 'Unknown error'), 'err');
        }
      }
    }

    // ── Social Sign In ─────────────────────────────────────────────
    async function socialSignIn(provider) {
      log('Starting ' + provider + ' OAuth flow...', 'info');
      const { ok, data } = await api('/sign-in/social', {
        method: 'POST',
        body: {
          provider,
          callbackURL: '/demo',
          errorCallbackURL: '/demo',
        },
      });

      if (ok && data) {
        if (data.url) {
          log('Redirecting to ' + provider + '...', 'ok');
          window.location.href = data.url;
        } else if (data.redirect === false) {
          log('Social sign-in completed', 'ok');
          await refreshSession();
        }
      } else {
        log('Social sign-in failed: ' + (data?.message || data?.error || JSON.stringify(data)), 'err');
      }
    }

    // ── Sign Out ─────────────────────────────────────────────────
    async function signOut() {
      log('Signing out...', 'info');
      await api('/sign-out', { method: 'POST' });
      currentSession = null;
      document.getElementById('session-box').classList.add('none');
      document.getElementById('session-info').textContent = 'No active session';
      document.getElementById('auth-badge').textContent = 'Not signed in';
      document.getElementById('auth-badge').className = 'badge badge-red';
      document.getElementById('2fa-setup').classList.remove('hidden');
      document.getElementById('2fa-totp').classList.add('hidden');
      document.getElementById('2fa-done').classList.add('hidden');
      document.getElementById('2fa-status').textContent = 'Off';
      document.getElementById('2fa-status').className = 'badge badge-red';
      setStep(1);
      log('Signed out', 'ok');
    }

    // ── Two-Factor Auth ──────────────────────────────────────────
    async function enableTwoFactor() {
      if (!currentSession) {
        log('Sign in first', 'err');
        return;
      }
      log('Enabling 2FA...', 'info');
      const { ok, data } = await api('/two-factor/enable', {
        method: 'POST',
        body: { password: currentPassword },
      });

      if (ok && data) {
        log('2FA enabled — scan the QR code', 'ok');
        const totpURI = data.totpURI || data.uri || data.secret || JSON.stringify(data);
        document.getElementById('totp-uri').textContent = totpURI;
        // Generate QR code locally using qrcode-generator (no external API call)
        const qrEl = document.getElementById('totp-qr');
        const qr = qrcode(0, 'M');
        qr.addData(totpURI);
        qr.make();
        qrEl.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 4 });
        document.getElementById('2fa-setup').classList.add('hidden');
        document.getElementById('2fa-totp').classList.remove('hidden');
      } else {
        log('Failed to enable 2FA: ' + (data?.message || JSON.stringify(data)), 'err');
      }
    }

    async function verifyTOTP() {
      const code = document.getElementById('totp-code').value;
      if (!code) { log('Enter a TOTP code', 'err'); return; }

      log('Verifying TOTP code...', 'info');
      const { ok, data } = await api('/two-factor/verify-totp', {
        method: 'POST',
        body: { code },
      });

      if (ok) {
        log('TOTP verified! 2FA is now active.', 'ok');
        document.getElementById('2fa-totp').classList.add('hidden');
        document.getElementById('2fa-done').classList.remove('hidden');
        document.getElementById('2fa-status').textContent = 'On';
        document.getElementById('2fa-status').className = 'badge badge-green';
        setStep(4);
        await refreshSession();
      } else {
        log('TOTP verification failed: ' + (data?.message || JSON.stringify(data)), 'err');
      }
    }

    async function generateBackupCodes() {
      log('Generating backup codes...', 'info');
      const { ok, data } = await api('/two-factor/generate-backup-codes', {
        method: 'POST',
        body: { password: currentPassword },
      });

      if (ok && data) {
        const codes = data.backupCodes || data.codes || data;
        document.getElementById('backup-codes').classList.remove('hidden');
        document.getElementById('backup-codes-list').textContent =
          Array.isArray(codes) ? codes.join('\\n') : JSON.stringify(codes, null, 2);
        log('Backup codes generated — save them securely!', 'ok');
      } else {
        log('Failed: ' + (data?.message || JSON.stringify(data)), 'err');
      }
    }

    async function disableTwoFactor() {
      log('Disabling 2FA...', 'info');
      const { ok, data } = await api('/two-factor/disable', {
        method: 'POST',
        body: { password: currentPassword },
      });

      if (ok) {
        log('2FA disabled', 'ok');
        document.getElementById('2fa-done').classList.add('hidden');
        document.getElementById('2fa-setup').classList.remove('hidden');
        document.getElementById('2fa-status').textContent = 'Off';
        document.getElementById('2fa-status').className = 'badge badge-red';
        document.getElementById('backup-codes').classList.add('hidden');
        await refreshSession();
      } else {
        log('Failed: ' + (data?.message || JSON.stringify(data)), 'err');
      }
    }

    // ── OIDC Endpoints ───────────────────────────────────────────
    async function fetchDiscovery() {
      log('Fetching OIDC discovery...', 'info');
      const t0 = performance.now();
      const res = await fetch('/.well-known/openid-configuration');
      const ms = Math.round(performance.now() - t0);
      const data = await res.json();
      log('\\u2713 ' + res.status + ' (' + ms + 'ms)', 'ok');
      logJSON('Discovery', data);
      setStep(5);
    }

    async function fetchCerts() {
      log('Fetching JWKS...', 'info');
      try {
        const t0 = performance.now();
        const res = await fetch('/api/openid_connect/certs');
        const ms = Math.round(performance.now() - t0);
        const text = await res.text();
        let data;
        try { data = JSON.parse(text); } catch { data = text; }
        if (res.ok) {
          log('\\u2713 ' + res.status + ' (' + ms + 'ms)', 'ok');
          logJSON('JWKS', data);
        } else {
          log('\\u2717 ' + res.status + ' (' + ms + 'ms) — ' + (typeof data === 'object' ? data.message || JSON.stringify(data) : data), 'err');
        }
      } catch (e) {
        log('\\u2717 ' + e.message, 'err');
      }
    }

    async function testAuthorize() {
      log('Testing /authorize (via server-side proxy)...', 'info');
      const params = new URLSearchParams({
        client_id: 'urn:gov:gsa:openidconnect.profiles:sp:sso:example:app',
        redirect_uri: 'https://example.gov/auth/callback',
        response_type: 'code',
        scope: 'openid email',
        state: 'demo-' + Math.random().toString(36).slice(2),
        nonce: 'n-' + Math.random().toString(36).slice(2),
        acr_values: 'urn:acr.login.gov:auth-only',
        code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
        code_challenge_method: 'S256',
      });

      try {
        const t0 = performance.now();
        const res = await fetch('/demo/test-authorize?' + params.toString());
        const ms = Math.round(performance.now() - t0);
        const data = await res.json();
        log('\\u2713 ' + data.status + ' (' + ms + 'ms)', data.status >= 300 && data.status < 400 ? 'ok' : 'err');
        log('Location: ' + data.location, 'info');
        if (data.body) log(data.body);
      } catch (e) {
        log('\\u2717 ' + e.message, 'err');
      }
    }

    async function fetchHealth() {
      log('Checking worker health...', 'info');
      const t0 = performance.now();
      try {
        const res = await fetch('/health');
        const data = await res.json();
        const ms = Math.round(performance.now() - t0);
        log('auth-core: ' + (data.ok ? '\\u2713 online' : '\\u2717 error') + ' (' + ms + 'ms)', data.ok ? 'ok' : 'err');
      } catch (e) {
        log('auth-core: \\u2717 ' + e.message, 'err');
      }

      // Check other workers via service binding proxy
      // Note: these only work if each worker is running its own wrangler dev process
      const workers = ['MFA_WORKER', 'SAML_BRIDGE', 'SECURITY_EVENTS', 'IDENTITY_PROOFING', 'ACCOUNT_WORKER', 'ADMIN_WORKER', 'INFRA_WORKER'];
      for (const w of workers) {
        try {
          const t1 = performance.now();
          const res = await fetch('/demo/proxy/' + w + '/health');
          const ms2 = Math.round(performance.now() - t1);
          if (res.ok) {
            const data = await res.json();
            log(w + ': \\u2713 online (' + ms2 + 'ms)', 'ok');
          } else {
            log(w + ': \\u2717 ' + res.status + ' (not running)', 'err');
          }
        } catch (e) {
          log(w + ': \\u25CB not connected (run its wrangler dev separately)', 'dim');
        }
      }
    }

    // ── Init ─────────────────────────────────────────────────────
    // Check if returning from an OAuth callback
    if (window.location.search.includes('code=') || window.location.search.includes('error=')) {
      log('Returned from OAuth callback, checking session...', 'info');
      history.replaceState(null, '', '/demo');
    }
    refreshSession();
  </script>
</body>
</html>`;

  return c.html(page);
});

/**
 * Server-side /authorize test — captures the redirect response
 * so the browser can read the Location header.
 */
demoRoute.get("/demo/test-authorize", async (c) => {
  const url = new URL("/openid_connect/authorize", c.req.url);
  url.search = new URL(c.req.url).search;

  const res = await c.env.AUTH_CORE.fetch(url.toString(), {
    redirect: "manual",
  });

  return c.json({
    status: res.status,
    location: res.headers.get("Location") || "(none)",
    body: res.status >= 400 ? await res.text() : undefined,
  });
});

/**
 * Proxy endpoint for service binding calls from the demo page.
 * Routes: /demo/proxy/:binding/*path
 */
demoRoute.all("/demo/proxy/:binding/*", async (c) => {
  const bindingName = c.req.param("binding");
  const path = "/" + (c.req.param("*") || "");
  const env = c.env as unknown as Record<string, unknown>;
  const worker = env[bindingName] as Fetcher | undefined;

  if (!worker) {
    return c.json({ error: `Unknown binding: ${bindingName}` }, 400);
  }

  const url = new URL(path, "https://internal");
  const headers = new Headers(c.req.raw.headers);
  headers.delete("host");

  const res = await worker.fetch(url.toString(), {
    method: c.req.method,
    headers,
    body: c.req.method !== "GET" && c.req.method !== "HEAD"
      ? c.req.raw.body
      : undefined,
  });

  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
  });
});


export { demoRoute };
