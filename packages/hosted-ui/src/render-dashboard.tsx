import React from "react";
import { renderToString } from "react-dom/server";
import { Dashboard } from "./components/Dashboard.js";

export function renderDashboard(user: {
  name: string;
  email: string;
  image?: string;
}): string {
  const html = renderToString(
    <Dashboard name={user.name} email={user.email} image={user.image} />
  );

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Dashboard — Login.gov</title>
  <style>
    :root {
      --primary: #0071bc;
      --primary-60: color-mix(in srgb, #0071bc 60%, transparent);
      --primary-20: color-mix(in srgb, #0071bc 20%, transparent);
      --font: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    }

    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { height: 100%; font-family: var(--font); -webkit-font-smoothing: antialiased; }

    .page {
      background: #ffffff;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
    }

    .top-bar {
      width: 100%;
      padding: 16px 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .top-bar-logo {
      font-size: 15px;
      font-weight: 600;
      color: #1b1b1b;
      text-decoration: none;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .top-bar-logo svg { flex-shrink: 0; }

    .content {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: flex-start;
      padding: 60px 48px 80px;
      max-width: 480px;
      width: 100%;
    }

    .avatar {
      width: 80px;
      height: 80px;
      border-radius: 50%;
      background: var(--primary);
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 32px;
      font-weight: 700;
      margin-bottom: 28px;
      overflow: hidden;
    }
    .avatar img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .greeting {
      font-size: 24px;
      font-weight: 700;
      color: #1b1b1b;
      text-align: center;
      margin-bottom: 8px;
    }

    .status {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 14px;
      color: #2e8540;
      margin-bottom: 32px;
    }
    .status svg { flex-shrink: 0; }

    .info-card {
      width: 100%;
      border: 1px solid var(--primary-20);
      border-radius: 12px;
      padding: 24px;
      margin-bottom: 32px;
    }

    .info-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 0;
    }
    .info-row + .info-row {
      border-top: 1px solid #f0f0f0;
    }
    .info-label {
      font-size: 13px;
      font-weight: 600;
      color: rgba(27,27,27,0.5);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .info-value {
      font-size: 15px;
      color: #1b1b1b;
      font-weight: 500;
    }

    .logout-btn {
      width: 100%;
      height: 52px;
      border: 2px solid #e31c3d;
      border-radius: 9999px;
      background: transparent;
      color: #e31c3d;
      font-size: 16px;
      font-weight: 600;
      font-family: var(--font);
      cursor: pointer;
      transition: background 0.15s, color 0.15s;
    }
    .logout-btn:hover {
      background: #e31c3d;
      color: #fff;
    }
    .logout-btn:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }

    @media (max-width: 768px) {
      .content { padding: 40px 24px 60px; }
    }
  </style>
</head>
<body>
  <div id="root">${html}</div>
  <script>
    (function() {
      var btn = document.getElementById('logout-btn');
      btn.addEventListener('click', function() {
        btn.textContent = 'Signing out\\u2026';
        btn.disabled = true;
        fetch('/api/auth/sign-out', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: '{}' })
          .then(function() { window.location.href = '/sign-in'; });
      });
    })();
  </script>
</body>
</html>`;
}
