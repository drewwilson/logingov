import { Hono } from "hono";
import type { Env } from "@logingov/shared";
import { lookupServiceProvider } from "./sp-lookup.js";
import { renderPage } from "./render.js";
import { DEFAULT_THEME } from "./theme.js";
import type { SPThemeConfig } from "./types.js";

const hostedUiApp = new Hono<{ Bindings: Env }>();

hostedUiApp.get("/sign-in", async (c) => {
  const sessionId = c.req.query("session_id");
  const locale = c.req.query("locale") || "en";

  let theme: SPThemeConfig = DEFAULT_THEME;

  if (sessionId) {
    try {
      // Look up session to get spId
      const doId = c.env.SESSION_DO.idFromName(sessionId);
      const stub = c.env.SESSION_DO.get(doId);
      const sessionRes = await stub.fetch(
        new Request("https://session-do/get", { method: "GET" })
      );

      if (sessionRes.ok) {
        const session = (await sessionRes.json()) as { spId: string };

        // Look up service provider for theme
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
      // Session lookup failed — render with default theme
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
      "img-src 'self' https:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "base-uri 'none'",
    ].join("; ")
  );

  const html = renderPage(theme, sessionId || "", locale);
  return c.html(html);
});

export default hostedUiApp;
export { renderDashboard } from "./render-dashboard.js";
export type { SPThemeConfig } from "./types.js";
