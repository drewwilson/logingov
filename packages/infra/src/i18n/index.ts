/**
 * Internationalization (i18n) framework.
 *
 * - Locale detection: explicit param > session locale > Accept-Language > default (en)
 * - Translation strings bundled as JSON (no KV round-trip at runtime)
 * - Variable interpolation: t("en", "auth.login.locked", { minutes: "5" })
 */

import en from "./locales/en.json";
import es from "./locales/es.json";
import fr from "./locales/fr.json";
import type { Context } from "hono";
import type { Env } from "@logingov/shared";

// ── Supported locales ───────────────────────────────────────

export const SUPPORTED_LOCALES = ["en", "es", "fr"] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

const translations: Record<SupportedLocale, Record<string, string>> = {
  en: en as Record<string, string>,
  es: es as Record<string, string>,
  fr: fr as Record<string, string>,
};

// ── Translation function ────────────────────────────────────

/**
 * Translate a key into the given locale, with optional variable interpolation.
 *
 * @param locale - Target locale (falls back to "en" if unsupported)
 * @param key - Dot-separated translation key, e.g. "auth.login.title"
 * @param vars - Variables to interpolate, e.g. { minutes: "5" }
 * @returns Translated string, or the key itself if not found
 *
 * @example
 *   t("en", "auth.login.locked", { minutes: "5" })
 *   // => "Your account has been locked ... Try again in 5 minutes."
 */
export function t(
  locale: string,
  key: string,
  vars?: Record<string, string>
): string {
  const resolvedLocale = isSupported(locale) ? locale : "en";
  const dict = translations[resolvedLocale];
  let value = dict[key];

  if (value === undefined) {
    // Fallback to English
    value = translations.en[key];
  }

  if (value === undefined) {
    // Return the key as-is for debugging
    return key;
  }

  // Interpolate variables: {varName} -> value
  if (vars) {
    for (const [varName, varValue] of Object.entries(vars)) {
      value = value.replace(new RegExp(`\\{${varName}\\}`, "g"), varValue);
    }
  }

  return value;
}

// ── Locale detection ────────────────────────────────────────

/**
 * Detect the best locale from request context.
 *
 * Priority:
 *  1. Explicit `locale` query parameter
 *  2. Session locale (passed via header or context)
 *  3. Accept-Language header negotiation
 *  4. Default: "en"
 */
export function detectLocale(c: Context<{ Bindings: Env }>): SupportedLocale {
  // 1. Explicit query param
  const paramLocale = c.req.query("locale");
  if (paramLocale && isSupported(paramLocale)) {
    return paramLocale;
  }

  // 2. Session locale (forwarded by upstream middleware as a header)
  const sessionLocale = c.req.header("x-session-locale");
  if (sessionLocale && isSupported(sessionLocale)) {
    return sessionLocale;
  }

  // 3. Accept-Language header
  const acceptLang = c.req.header("accept-language");
  if (acceptLang) {
    const detected = parseAcceptLanguage(acceptLang);
    if (detected) return detected;
  }

  // 4. Default
  return "en";
}

/**
 * Parse Accept-Language header and return the best supported locale.
 */
function parseAcceptLanguage(header: string): SupportedLocale | null {
  // Parse entries like "es-MX,es;q=0.9,en;q=0.8,fr;q=0.7"
  const entries = header.split(",").map((entry) => {
    const parts = entry.trim().split(";");
    const lang = parts[0].trim().toLowerCase();
    const qPart = parts.find((p) => p.trim().startsWith("q="));
    const q = qPart ? parseFloat(qPart.trim().slice(2)) : 1.0;
    return { lang, q };
  });

  // Sort by quality descending
  entries.sort((a, b) => b.q - a.q);

  for (const { lang } of entries) {
    // Try exact match first
    if (isSupported(lang)) return lang;
    // Try language prefix (e.g., "es-MX" -> "es")
    const prefix = lang.split("-")[0];
    if (isSupported(prefix)) return prefix;
  }

  return null;
}

function isSupported(locale: string): locale is SupportedLocale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(locale);
}
