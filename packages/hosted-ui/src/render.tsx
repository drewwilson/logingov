import { renderToString } from "react-dom/server";
import type { SPThemeConfig } from "./types.js";
import { isLightColor } from "./theme.js";
import { SignInPage } from "./components/SignInPage.js";

export function renderPage(
  theme: SPThemeConfig,
  sessionId: string,
  locale: string,
): string {
  const isDark = !isLightColor(theme.formBackground.color);
  const textOnBg = isDark ? "#ffffff" : "var(--primary)";
  const subtitleOnBg = isDark ? "rgba(255,255,255,0.6)" : "var(--primary-50)";

  // Build form panel background CSS
  const bgLayers: string[] = [];
  if (theme.formBackground.overlay) {
    bgLayers.push(theme.formBackground.overlay);
  }
  const bgImage = bgLayers.length > 0 ? bgLayers.join(", ") : "none";

  const html = renderToString(
    <SignInPage
      theme={theme}
      sessionId={sessionId}
      locale={locale}
      isDarkBackground={isDark}
    />,
  );

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
  </style>
</head>
<body>
  <div id="root">${html}</div>
  <script>
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
            var sid = form.querySelector('input[name="session_id"]').value;
            if (sid) {
              window.location.href = '/api/auth-flow/complete-login?session_id=' + encodeURIComponent(sid);
            } else {
              window.location.href = '/dashboard';
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
              var sid = form.querySelector('input[name="session_id"]').value;
              if (sid) {
                window.location.href = '/api/auth-flow/complete-login?session_id=' + encodeURIComponent(sid);
              } else {
                window.location.href = '/dashboard';
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

          var callbackURL = sessionId
            ? '/api/auth-flow/complete-login?session_id=' + encodeURIComponent(sessionId)
            : '/dashboard';

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
  </script>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(str: string): string {
  return str.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
