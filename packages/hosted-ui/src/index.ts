import { Hono } from "hono";
import type { Env } from "@logingov/shared";
import { lookupServiceProvider, lookupAgencyTheme } from "./sp-lookup.js";
import { renderPage } from "./render.js";
import { DEFAULT_THEME } from "./theme.js";
import type { SPThemeConfig } from "./types.js";

const hostedUiApp = new Hono<{ Bindings: Env }>();

hostedUiApp.get("/sign-in", async (c) => {
  const sessionId = c.req.query("session_id");
  const agencyId = c.req.query("agency_id"); // Preview/demo mode only
  const locale = c.req.query("locale") || "en";
  const ial = c.req.query("ial") || "1";

  let theme: SPThemeConfig = DEFAULT_THEME;

  // ── Direct agency preview (for demo/testing only) ─────────
  if (agencyId) {
    try {
      const agency = await lookupAgencyTheme(agencyId, c.env);
      if (agency?.theme) {
        try {
          const parsed = JSON.parse(agency.theme);
          theme = { ...DEFAULT_THEME, ...parsed };
        } catch {}
      }
    } catch (err) {
      console.error("[sign-in] agency preview lookup error:", err);
    }
  }

  // ── Normal session-based flow (SP theme only, no agency fallthrough) ──
  if (sessionId && !agencyId) {
    try {
      const doId = c.env.SESSION_DO.idFromName(sessionId);
      const stub = c.env.SESSION_DO.get(doId);
      const sessionRes = await stub.fetch(
        new Request("https://session-do/get", { method: "GET" })
      );

      if (sessionRes.ok) {
        const session = (await sessionRes.json()) as { spId: string };
        const sp = await lookupServiceProvider(session.spId, c.env);

        if (sp?.theme) {
          try {
            const parsed =
              typeof sp.theme === "string" ? JSON.parse(sp.theme) : sp.theme;
            theme = { ...DEFAULT_THEME, ...parsed };
          } catch {
            // Fall back to default theme on malformed JSON
          }
        }
      }
    } catch (err) {
      console.error("[sign-in] session lookup error:", err);
    }
  }

  // Set CSP for the sign-in page
  c.header(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' https: data:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "base-uri 'none'",
    ].join("; ")
  );

  const html = renderPage(theme, sessionId || "", locale, ial);
  return c.html(html);
});

export default hostedUiApp;
export { renderDashboard } from "./render-dashboard.js";
export type { SPThemeConfig } from "./types.js";
