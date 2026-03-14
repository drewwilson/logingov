/**
 * Deprecated ACR values middleware.
 * Translates legacy URNs (ial/1, ial/2, loa/1, loa/3) to current URNs
 * before the IAL evaluator processes them.
 */
import type { Context, Next } from "hono";
import type { Env } from "@logingov/shared";

/**
 * Map from deprecated ACR values to their current equivalents.
 */
const DEPRECATED_ACR_MAP: Record<string, string> = {
  "http://idmanagement.gov/ns/assurance/ial/1": "urn:acr.login.gov:auth-only",
  "http://idmanagement.gov/ns/assurance/ial/2": "urn:acr.login.gov:verified",
  "http://idmanagement.gov/ns/assurance/loa/1": "urn:acr.login.gov:auth-only",
  "http://idmanagement.gov/ns/assurance/loa/3": "urn:acr.login.gov:verified",
};

/**
 * Middleware that intercepts acr_values from the query string and
 * translates any deprecated URNs to current ones. Sets c.set("acr_values_translated")
 * to indicate that translation occurred (for logging/metrics).
 */
export async function deprecatedAcrMiddleware(
  c: Context<{ Bindings: Env }>,
  next: Next
): Promise<void> {
  const acrValues = c.req.query("acr_values");

  if (acrValues) {
    const values = acrValues.split(" ").filter(Boolean);
    let translated = false;
    const mapped = values.map((v) => {
      if (DEPRECATED_ACR_MAP[v]) {
        translated = true;
        return DEPRECATED_ACR_MAP[v];
      }
      return v;
    });

    if (translated) {
      // Store translated values for downstream use
      c.set("acr_values" as never, mapped.join(" "));
      c.set("acr_values_translated" as never, true);
    } else {
      c.set("acr_values" as never, acrValues);
      c.set("acr_values_translated" as never, false);
    }
  }

  await next();
}
