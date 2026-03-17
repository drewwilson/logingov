import { jsx as _jsx } from "react/jsx-runtime";
import { renderToString } from "react-dom/server";
import { isLightColor } from "./theme.js";
import { SignInPage } from "./components/SignInPage.js";
export function renderPage(theme, sessionId, locale, ial = "1") {
    const isDark = !isLightColor(theme.formBackground.color);
    const textOnBg = isDark ? "#ffffff" : "var(--primary)";
    const subtitleOnBg = isDark ? "rgba(255,255,255,0.6)" : "var(--primary-50)";
    // Build form panel background CSS
    const bgLayers = [];
    if (theme.formBackground.overlay) {
        bgLayers.push(theme.formBackground.overlay);
    }
    const bgImage = bgLayers.length > 0 ? bgLayers.join(", ") : "none";
    const html = renderToString(_jsx(SignInPage, { theme: theme, sessionId: sessionId, locale: locale, isDarkBackground: isDark }));
    return `<!DOCTYPE html>
<html lang="${escapeAttr(locale)}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Sign in — ${escapeHtml(theme.agencyName)}</title>
  <style>
    :root {
      --primary: ${escapeAttr(theme.primaryColor)};
      --primary-50: color-mix(in srgb, ${escapeAttr(theme.primaryColor)} 50%, transparent);
      --primary-20: color-mix(in srgb, ${escapeAttr(theme.primaryColor)} 20%, transparent);
      --primary-12: color-mix(in srgb, ${escapeAttr(theme.primaryColor)} 12%, transparent);
      --primary-5: color-mix(in srgb, ${escapeAttr(theme.primaryColor)} 5%, transparent);
      --primary-3: color-mix(in srgb, ${escapeAttr(theme.primaryColor)} 3%, transparent);
      --text-on-bg: ${textOnBg};
      --subtitle-on-bg: ${subtitleOnBg};
      --form-bg-color: ${escapeAttr(theme.formBackground.color)};
      --form-bg-image: ${bgImage};
      --font: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    }

    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    html, body {
      height: 100%;
      font-family: var(--font);
      -webkit-font-smoothing: antialiased;
    }

    /* ── Layout ────────────────────────────────── */

    .layout {
      display: grid;
      grid-template-columns: 55% 45%;
      min-height: 100vh;
    }
    .layout--no-hero {
      grid-template-columns: 1fr;
    }

    /* ── Form Panel ────────────────────────────── */

    .form-panel {
      background-color: var(--form-bg-color);
      background-image: var(--form-bg-image);
      background-size: cover;
      background-position: center;
      display: flex;
      flex-direction: column;
      min-height: 100vh;
      color: var(--text-on-bg);
    }

    .back-link-container {
      padding: 16px 24px;
      background-color: var(--primary-3);
      border-bottom: 1px solid var(--primary-5);
    }

    .back-link {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      color: var(--text-on-bg);
      text-decoration: none;
      font-size: 14px;
      font-weight: 400;
      opacity: 0.8;
      transition: opacity 0.15s;
    }
    .back-link:hover { opacity: 1; }

    .form-content {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: flex-start;
      padding: 40px 48px 60px;
      max-width: 540px;
      margin: 0 auto;
      width: 100%;
    }

    /* ── Branding ──────────────────────────────── */

    .branding {
      text-align: center;
      margin-bottom: 60px;
    }

    .agency-logo {
      max-height: 80px;
      margin-bottom: 16px;
    }
    .agency-logo svg {
      max-height: 80px;
      max-width: 200px;
    }

    .agency-name {
      font-size: 22px;
      font-weight: 600;
      color: var(--text-on-bg);
      letter-spacing: -0.01em;
    }

    /* ── Sign In Section ───────────────────────── */

    .sign-in-section {
      width: 100%;
    }

    .sign-in-heading {
      font-size: 24px;
      font-weight: 700;
      color: var(--text-on-bg);
      text-align: center;
      margin-bottom: 8px;
    }

    .sign-in-subtitle {
      font-size: 14px;
      color: var(--subtitle-on-bg);
      text-align: center;
      margin-bottom: 32px;
    }

    /* ── Social Buttons ────────────────────────── */

    .social-buttons {
      display: flex;
      gap: 12px;
      margin-bottom: 24px;
    }

    .social-btn {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      height: 48px;
      border: none;
      border-radius: 90px;
      background: linear-gradient(180deg, #FFF 0%, #F8F8F8 100%), #FFF;
      box-shadow: 0 0 0 1px #FFF inset, 0 0 0 1px rgba(0, 0, 0, 0.08), 0 1px 0 0 rgba(0, 0, 0, 0.02), 0 2px 3px -1px rgba(0, 0, 0, 0.08);
      cursor: pointer;
      transition: box-shadow 0.15s;
      font-family: var(--font);
    }
    .social-btn:hover {
      box-shadow: 0 0 0 1px #FFF inset, 0 0 0 1px rgba(0, 0, 0, 0.15), 0 1px 0 0 rgba(0, 0, 0, 0.04), 0 3px 5px -1px rgba(0, 0, 0, 0.12);
    }

    /* ── Divider ───────────────────────────────── */

    .divider {
      display: flex;
      align-items: center;
      gap: 16px;
      margin-bottom: 24px;
    }
    .divider-line {
      flex: 1;
      height: 1px;
      background: var(--primary-12);
    }
    .divider-text {
      font-size: 13px;
      color: var(--subtitle-on-bg);
    }

    /* ── Email Form ────────────────────────────── */

    .field-header {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      margin-bottom: 8px;
    }
    .field-label {
      font-size: 14px;
      font-weight: 600;
      color: var(--text-on-bg);
    }
    .field-link {
      font-size: 13px;
      color: var(--subtitle-on-bg);
      text-decoration: none;
    }
    .field-link:hover {
      text-decoration: underline;
    }

    .email-input {
      width: 100%;
      height: 48px;
      padding: 0 16px;
      border: 1px solid var(--primary-20);
      border-radius: 8px;
      font-size: 15px;
      font-family: var(--font);
      background: rgba(255,255,255,0.9);
      color: #1b1b1b;
      outline: none;
      transition: border-color 0.15s;
      margin-bottom: 24px;
    }
    .email-input::placeholder {
      color: #9ca3af;
    }
    .email-input:focus {
      border-color: var(--primary);
      box-shadow: 0 0 0 3px var(--primary-20);
    }

    .continue-btn {
      width: 100%;
      height: 52px;
      border: none;
      border-radius: 9999px;
      background: var(--primary);
      color: #ffffff;
      font-size: 16px;
      font-weight: 600;
      font-family: var(--font);
      cursor: pointer;
      transition: opacity 0.15s;
    }
    .continue-btn:hover {
      opacity: 0.9;
    }

    .password-field {
      transition: max-height 0.3s ease, opacity 0.3s ease;
      max-height: 200px;
      opacity: 1;
      overflow: hidden;
    }
    .password-field.hidden {
      max-height: 0;
      opacity: 0;
      margin: 0;
    }

    .form-error {
      text-align: center;
      margin-top: 12px;
      padding: 10px 14px;
      border-radius: 8px;
      background: #fef2f2;
      color: #b91c1c;
      font-size: 13px;
    }
    .form-error.hidden {
      display: none;
    }

    .continue-btn:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }

    /* ── Hero Panel ────────────────────────────── */

    .hero-panel {
      background-size: cover;
      background-position: center;
      background-repeat: no-repeat;
      min-height: 100vh;
    }

    /* ── Mobile ────────────────────────────────── */

    @media (max-width: 768px) {
      .layout {
        grid-template-columns: 1fr;
      }
      .hero-panel {
        display: none;
      }
      .form-panel {
        min-height: 100vh;
      }
      .form-content {
        padding: 24px 24px 40px;
      }
      .branding {
        margin-bottom: 40px;
      }
    }

    /* ── ID Verification Wizard ──────────────── */

    .wizard { display: none; width: 100%; }
    .wizard.active { display: block; }

    .wizard-progress {
      display: flex;
      gap: 6px;
      margin-bottom: 32px;
    }
    .wizard-progress-bar {
      flex: 1;
      height: 4px;
      border-radius: 2px;
      background: var(--primary-12);
      transition: background 0.3s;
    }
    .wizard-progress-bar.done {
      background: var(--primary);
    }

    .wizard-step { display: none; text-align: center; }
    .wizard-step.active { display: block; }

    .wizard-icon {
      width: 80px;
      height: 80px;
      margin: 0 auto 24px;
      border-radius: 50%;
      background: var(--primary-5);
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .wizard-icon svg {
      width: 40px;
      height: 40px;
      color: var(--primary);
    }

    .wizard-title {
      font-size: 22px;
      font-weight: 700;
      color: var(--text-on-bg);
      margin-bottom: 8px;
    }
    .wizard-desc {
      font-size: 14px;
      color: var(--subtitle-on-bg);
      margin-bottom: 32px;
      line-height: 1.5;
    }

    .wizard-btn {
      width: 100%;
      height: 52px;
      border: none;
      border-radius: 9999px;
      background: var(--primary);
      color: #ffffff;
      font-size: 16px;
      font-weight: 600;
      font-family: var(--font);
      cursor: pointer;
      transition: opacity 0.15s;
    }
    .wizard-btn:hover { opacity: 0.9; }

    .wizard-mock-upload {
      display: flex;
      gap: 16px;
      margin-bottom: 32px;
      justify-content: center;
    }
    .wizard-mock-doc {
      width: 140px;
      height: 90px;
      border-radius: 8px;
      background: var(--primary-5);
      border: 2px dashed var(--primary-20);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 4px;
      position: relative;
    }
    .wizard-mock-doc.uploaded {
      border-style: solid;
      border-color: #16a34a;
      background: #f0fdf4;
    }
    .wizard-mock-doc-label {
      font-size: 11px;
      color: var(--subtitle-on-bg);
      font-weight: 500;
    }
    .wizard-mock-doc.uploaded .wizard-mock-doc-label {
      color: #16a34a;
    }
    .wizard-mock-check {
      position: absolute;
      top: 6px;
      right: 6px;
      width: 18px;
      height: 18px;
      border-radius: 50%;
      background: #16a34a;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .wizard-selfie {
      width: 160px;
      height: 160px;
      border-radius: 50%;
      background: var(--primary-5);
      border: 3px solid var(--primary-20);
      margin: 0 auto 32px;
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;
      overflow: hidden;
    }
    .wizard-selfie.captured {
      border-color: #16a34a;
      background: #f0fdf4;
    }

    .wizard-spinner {
      width: 48px;
      height: 48px;
      border: 4px solid var(--primary-12);
      border-top-color: var(--primary);
      border-radius: 50%;
      animation: wizard-spin 0.8s linear infinite;
      margin: 0 auto 24px;
    }
    @keyframes wizard-spin {
      to { transform: rotate(360deg); }
    }

    .wizard-success-icon {
      width: 80px;
      height: 80px;
      margin: 0 auto 24px;
      border-radius: 50%;
      background: #dcfce7;
      display: flex;
      align-items: center;
      justify-content: center;
    }
  </style>
</head>
<body>
  <div id="root" data-ial="${escapeAttr(ial)}">${html}</div>

  <!-- ID Verification Wizard (shown after sign-in when IAL2 required) -->
  <div id="verify-wizard" class="wizard">
    <div class="form-panel" style="justify-content: center; align-items: center;">
      <div class="form-content" style="justify-content: center;">

        <div class="wizard-progress">
          <div class="wizard-progress-bar" id="wp-1"></div>
          <div class="wizard-progress-bar" id="wp-2"></div>
          <div class="wizard-progress-bar" id="wp-3"></div>
          <div class="wizard-progress-bar" id="wp-4"></div>
        </div>

        <!-- Step 1: Intro -->
        <div class="wizard-step active" data-step="1">
          <div class="wizard-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            </svg>
          </div>
          <h2 class="wizard-title">Verify your identity</h2>
          <p class="wizard-desc">We need to verify your identity to continue.<br/>You'll need a government-issued photo ID.</p>
          <button type="button" class="wizard-btn" data-wizard-next>Continue</button>
        </div>

        <!-- Step 2: Document Upload -->
        <div class="wizard-step" data-step="2">
          <div class="wizard-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="2" y="4" width="20" height="16" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/>
            </svg>
          </div>
          <h2 class="wizard-title">Upload your ID</h2>
          <p class="wizard-desc">Photos of your driver's license have been captured.</p>
          <div class="wizard-mock-upload">
            <div class="wizard-mock-doc uploaded">
              <div class="wizard-mock-check">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
              </div>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>
              <span class="wizard-mock-doc-label">Front</span>
            </div>
            <div class="wizard-mock-doc uploaded">
              <div class="wizard-mock-check">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
              </div>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>
              <span class="wizard-mock-doc-label">Back</span>
            </div>
          </div>
          <button type="button" class="wizard-btn" data-wizard-next>Continue</button>
        </div>

        <!-- Step 3: Selfie -->
        <div class="wizard-step" data-step="3">
          <div class="wizard-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/>
            </svg>
          </div>
          <h2 class="wizard-title">Selfie captured</h2>
          <p class="wizard-desc">Your photo has been taken for facial comparison.</p>
          <div class="wizard-selfie captured">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="1.5">
              <circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 10-16 0"/>
            </svg>
          </div>
          <button type="button" class="wizard-btn" data-wizard-next>Continue</button>
        </div>

        <!-- Step 4: Processing -->
        <div class="wizard-step" data-step="4">
          <div class="wizard-spinner"></div>
          <h2 class="wizard-title">Verifying your identity</h2>
          <p class="wizard-desc">Checking your documents and photo. This will only take a moment.</p>
        </div>

        <!-- Step 5: Success -->
        <div class="wizard-step" data-step="5">
          <div class="wizard-success-icon">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          </div>
          <h2 class="wizard-title">Identity verified</h2>
          <p class="wizard-desc">Your identity has been successfully verified.</p>
          <button type="button" class="wizard-btn" id="wizard-finish">Continue to service</button>
        </div>

      </div>
    </div>
  </div>

  <script>
    var __ial = document.getElementById('root').getAttribute('data-ial');
    var __userId = null;

    // Check if returning from social OAuth with verify flag
    (function() {
      var params = new URLSearchParams(window.location.search);
      if (params.get('verify') === '1' && __ial === '2') {
        // User is already authenticated via social login — fetch session to get userId
        fetch('/api/auth/get-session', { credentials: 'include' })
          .then(function(res) { return res.json(); })
          .then(function(data) {
            if (data && data.user && data.user.id) {
              startWizardOrRedirect(data.user.id);
            }
          })
          .catch(function() {});
      }
    })();

    function startWizardOrRedirect(userId) {
      if (__ial === '2') {
        __userId = userId;
        document.getElementById('root').style.display = 'none';
        document.getElementById('verify-wizard').classList.add('active');
        document.getElementById('wp-1').classList.add('done');
        return true;
      }
      return false;
    }

    function completeRedirect() {
      var sessionId = (document.querySelector('input[name="session_id"]') || {}).value || '';
      if (sessionId) {
        window.location.href = '/api/auth-flow/complete-login?session_id=' + encodeURIComponent(sessionId);
      } else {
        window.location.href = '/dashboard';
      }
    }

    (function() {
      var form = document.getElementById('sign-in-form');
      var emailInput = document.getElementById('email');
      var passwordField = document.getElementById('password-field');
      var passwordInput = document.getElementById('password');
      var errorEl = document.getElementById('form-error');
      var passwordRevealed = false;
      var debounceTimer = null;

      function isValidEmail(v) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
      }

      function revealPassword(focus) {
        if (passwordRevealed) return;
        passwordRevealed = true;
        passwordField.classList.remove('hidden');
        passwordInput.setAttribute('required', '');
        if (focus) passwordInput.focus();
      }

      // Debounced keyup on email — reveal password once a valid email is typed
      emailInput.addEventListener('input', function() {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(function() {
          if (isValidEmail(emailInput.value)) {
            revealPassword(false);
          }
        }, 400);
      });

      form.addEventListener('submit', function(e) {
        e.preventDefault();
        errorEl.classList.add('hidden');

        // If password not yet revealed, validate email and reveal
        if (!passwordRevealed) {
          if (!emailInput.value || !emailInput.checkValidity()) {
            emailInput.focus();
            return;
          }
          revealPassword(true);
          return;
        }

        // Submit credentials
        if (!passwordInput.value) {
          passwordInput.focus();
          return;
        }

        var btn = form.querySelector('.continue-btn');
        btn.disabled = true;
        btn.textContent = 'Signing in\u2026';

        fetch('/api/auth/sign-in/email', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: emailInput.value,
            password: passwordInput.value
          })
        })
        .then(function(res) { return res.json().then(function(d) { return { ok: res.ok, data: d }; }); })
        .then(function(result) {
          if (result.ok) {
            var uid = result.data && result.data.user && result.data.user.id;
            if (!startWizardOrRedirect(uid)) {
              completeRedirect();
            }
            return;
          }

          // Sign-in failed — try creating an account
          btn.textContent = 'Creating account\u2026';

          fetch('/api/auth/sign-up/email', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: emailInput.value.split('@')[0],
              email: emailInput.value,
              password: passwordInput.value
            })
          })
          .then(function(res) { return res.json().then(function(d) { return { ok: res.ok, data: d }; }); })
          .then(function(signupResult) {
            if (signupResult.ok) {
              var uid = signupResult.data && signupResult.data.user && signupResult.data.user.id;
              if (!startWizardOrRedirect(uid)) {
                completeRedirect();
              }
            } else {
              btn.disabled = false;
              btn.textContent = 'Continue';
              var msg = (signupResult.data.message || signupResult.data.error || '').toLowerCase();
              if (msg.includes('already') || msg.includes('exists')) {
                errorEl.textContent = 'Invalid email or password';
              } else {
                errorEl.textContent = signupResult.data.message || signupResult.data.error || 'Could not create account';
              }
              errorEl.classList.remove('hidden');
            }
          })
          .catch(function() {
            btn.disabled = false;
            btn.textContent = 'Continue';
            errorEl.textContent = 'Something went wrong. Please try again.';
            errorEl.classList.remove('hidden');
          });
        })
        .catch(function() {
          btn.disabled = false;
          btn.textContent = 'Continue';
          errorEl.textContent = 'Something went wrong. Please try again.';
          errorEl.classList.remove('hidden');
        });
      });
    })();

    // ── Social Login ──────────────────────────────────────
    (function() {
      var buttons = document.querySelectorAll('.social-btn[data-provider]');
      var sessionId = (document.querySelector('input[name="session_id"]') || {}).value || '';

      buttons.forEach(function(btn) {
        btn.addEventListener('click', function() {
          var provider = btn.getAttribute('data-provider');
          btn.style.opacity = '0.6';
          btn.style.pointerEvents = 'none';

          var callbackURL;
          if (__ial === '2' && sessionId) {
            // Redirect back to sign-in page to show the wizard
            callbackURL = '/sign-in?session_id=' + encodeURIComponent(sessionId) + '&ial=2&verify=1';
          } else if (sessionId) {
            callbackURL = '/api/auth-flow/complete-login?session_id=' + encodeURIComponent(sessionId);
          } else {
            callbackURL = '/dashboard';
          }

          fetch('/api/auth/sign-in/social', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              provider: provider,
              callbackURL: callbackURL,
              errorCallbackURL: window.location.href
            })
          })
          .then(function(res) { return res.json(); })
          .then(function(data) {
            if (data.url) {
              window.location.href = data.url;
            } else {
              btn.style.opacity = '';
              btn.style.pointerEvents = '';
            }
          })
          .catch(function() {
            btn.style.opacity = '';
            btn.style.pointerEvents = '';
          });
        });
      });
    })();

    // ── ID Verification Wizard ──────────────────────────────
    (function() {
      var wizard = document.getElementById('verify-wizard');
      var steps = wizard.querySelectorAll('.wizard-step');
      var bars = wizard.querySelectorAll('.wizard-progress-bar');
      var currentStep = 1;

      function goToStep(n) {
        currentStep = n;
        steps.forEach(function(s) { s.classList.remove('active'); });
        var target = wizard.querySelector('[data-step="' + n + '"]');
        if (target) target.classList.add('active');
        bars.forEach(function(b, i) {
          if (i < n) b.classList.add('done');
        });

        // Step 4 (processing) auto-advances after 2s
        if (n === 4) {
          setTimeout(function() { goToStep(5); }, 2000);
        }
      }

      // "Continue" buttons advance to next step
      wizard.querySelectorAll('[data-wizard-next]').forEach(function(btn) {
        btn.addEventListener('click', function() {
          goToStep(currentStep + 1);
        });
      });

      // "Continue to service" — call mock-verify then redirect
      var finishBtn = document.getElementById('wizard-finish');
      finishBtn.addEventListener('click', function() {
        finishBtn.disabled = true;
        finishBtn.textContent = 'Redirecting\u2026';

        var sessionId = (document.querySelector('input[name="session_id"]') || {}).value || '';

        fetch('/api/auth-flow/mock-verify', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId: sessionId,
            userId: __userId
          })
        })
        .then(function(res) { return res.json(); })
        .then(function(data) {
          if (data.ok) {
            completeRedirect();
          } else {
            finishBtn.disabled = false;
            finishBtn.textContent = 'Continue to service';
          }
        })
        .catch(function() {
          finishBtn.disabled = false;
          finishBtn.textContent = 'Continue to service';
        });
      });
    })();
  </script>
</body>
</html>`;
}
function escapeHtml(str) {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}
function escapeAttr(str) {
    return str.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
