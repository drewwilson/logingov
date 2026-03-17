import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { getAgencyDb, agencySchema } from "./db.js";
import { renderPage } from "@logingov/hosted-ui/render";
import { DEFAULT_THEME } from "@logingov/hosted-ui/theme";
// Walk up from this file to find .prod.secrets.json at the repo root
function loadDatabaseUrl() {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    // Try a few known locations relative to this file and cwd
    const candidates = [
        resolve(__dirname, "../../.prod.secrets.json"), // from src/
        resolve(__dirname, "../../../.prod.secrets.json"), // one more up
        resolve(process.cwd(), ".prod.secrets.json"), // from cwd
    ];
    for (const p of candidates) {
        try {
            const secrets = JSON.parse(readFileSync(p, "utf-8"));
            if (secrets.DATABASE_URL) {
                // Strip ?ssl=... suffix — not needed for @planetscale/database HTTP driver
                return secrets.DATABASE_URL.replace(/\?ssl=.*$/, "");
            }
        }
        catch { }
    }
    throw new Error("DATABASE_URL not found — ensure .prod.secrets.json exists at the repo root");
}
const DATABASE_URL = loadDatabaseUrl();
const { agencies, serviceProviders } = agencySchema;
const app = new Hono();
function db() {
    return getAgencyDb(DATABASE_URL);
}
function uuid() {
    return crypto.randomUUID();
}
/** Generate a client_id URN from the agency abbreviation or friendly name. */
function generateClientId(abbreviation, friendlyName) {
    const slug = (abbreviation || friendlyName)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
    return `urn:gov:gsa:openidconnect.profiles:sp:sso:${slug}:app`;
}
/** Parse redirect URIs from a newline-separated string. */
function parseRedirectUris(raw) {
    if (!raw)
        return [];
    return raw
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
}
// ── GET /api/agencies ───────────────────────────────────────
app.get("/api/agencies", async (c) => {
    try {
        const d = db();
        const rows = await d.select().from(agencies);
        return c.json({ agencies: rows });
    }
    catch (e) {
        console.error("GET /api/agencies error:", e);
        return c.json({ error: e.message }, 500);
    }
});
// ── GET /api/agencies/:id ───────────────────────────────────
app.get("/api/agencies/:id", async (c) => {
    try {
        const id = c.req.param("id");
        const d = db();
        const [row] = await d.select().from(agencies).where(eq(agencies.id, id)).limit(1);
        if (!row)
            return c.json({ error: "not_found" }, 404);
        // Also fetch the linked service provider to return redirect URIs
        const [sp] = await d
            .select({ redirectUris: serviceProviders.redirectUris, clientId: serviceProviders.id })
            .from(serviceProviders)
            .where(eq(serviceProviders.agencyId, id))
            .limit(1);
        let redirectUris = "";
        if (sp?.redirectUris) {
            try {
                redirectUris = JSON.parse(sp.redirectUris).join("\n");
            }
            catch { }
        }
        return c.json({ ...row, redirectUris, clientId: sp?.clientId ?? null });
    }
    catch (e) {
        console.error("GET /api/agencies/:id error:", e);
        return c.json({ error: e.message }, 500);
    }
});
// ── POST /api/agencies ──────────────────────────────────────
app.post("/api/agencies", async (c) => {
    try {
        const body = await c.req.json();
        const now = new Date().toISOString();
        const id = uuid();
        const d = db();
        await d.insert(agencies).values({
            id,
            iaaName: body.iaaName,
            friendlyName: body.friendlyName,
            abbreviation: body.abbreviation || null,
            description: body.description || null,
            websiteUrl: body.websiteUrl || null,
            protocol: body.protocol || "oidc",
            ial: body.ial ?? 1,
            defaultAal: body.defaultAal ?? 1,
            logo: body.logo || null,
            publicCertificate: body.publicCertificate || null,
            status: body.status || "draft",
            themeConfig: body.themeConfig ? JSON.stringify(body.themeConfig) : null,
            createdAt: now,
            updatedAt: now,
        });
        // Also create the service_providers record for OIDC registration
        const redirectUris = parseRedirectUris(body.redirectUris);
        const publicKey = body.publicCertificate || "";
        const clientId = generateClientId(body.abbreviation, body.friendlyName);
        if (publicKey && redirectUris.length > 0) {
            const themeJson = body.themeConfig
                ? JSON.stringify({
                    agencyName: body.friendlyName,
                    primaryColor: body.themeConfig.primaryColor,
                    heroPanel: body.themeConfig.heroPanel,
                    backLinkText: body.themeConfig.backLinkText,
                    backLinkUrl: body.themeConfig.backLinkUrl,
                    formBackground: { color: body.themeConfig.formBackgroundColor },
                    logo: body.logo || "",
                })
                : null;
            await d.insert(serviceProviders).values({
                id: clientId,
                agencyId: id,
                name: body.friendlyName,
                ialMax: body.ial ?? 1,
                aalMax: body.defaultAal ?? 1,
                redirectUris: JSON.stringify(redirectUris),
                publicKey,
                theme: themeJson,
                createdAt: now,
            });
        }
        return c.json({ id, clientId }, 201);
    }
    catch (e) {
        console.error("POST /api/agencies error:", e);
        return c.json({ error: e.message }, 500);
    }
});
// ── PUT /api/agencies/:id ───────────────────────────────────
app.put("/api/agencies/:id", async (c) => {
    try {
        const id = c.req.param("id");
        const body = await c.req.json();
        const d = db();
        const [existing] = await d.select({ id: agencies.id }).from(agencies).where(eq(agencies.id, id)).limit(1);
        if (!existing)
            return c.json({ error: "not_found" }, 404);
        const now = new Date().toISOString();
        const updates = { updatedAt: now };
        if (body.iaaName !== undefined)
            updates.iaaName = body.iaaName;
        if (body.friendlyName !== undefined)
            updates.friendlyName = body.friendlyName;
        if (body.abbreviation !== undefined)
            updates.abbreviation = body.abbreviation || null;
        if (body.description !== undefined)
            updates.description = body.description || null;
        if (body.websiteUrl !== undefined)
            updates.websiteUrl = body.websiteUrl || null;
        if (body.protocol !== undefined)
            updates.protocol = body.protocol;
        if (body.ial !== undefined)
            updates.ial = body.ial;
        if (body.defaultAal !== undefined)
            updates.defaultAal = body.defaultAal;
        if (body.logo !== undefined)
            updates.logo = body.logo || null;
        if (body.publicCertificate !== undefined)
            updates.publicCertificate = body.publicCertificate || null;
        if (body.status !== undefined)
            updates.status = body.status;
        if (body.themeConfig !== undefined)
            updates.themeConfig = body.themeConfig ? JSON.stringify(body.themeConfig) : null;
        await d.update(agencies).set(updates).where(eq(agencies.id, id));
        // Sync the linked service_providers record
        const [sp] = await d
            .select({ id: serviceProviders.id })
            .from(serviceProviders)
            .where(eq(serviceProviders.agencyId, id))
            .limit(1);
        if (sp) {
            const spUpdates = {};
            if (body.friendlyName !== undefined)
                spUpdates.name = body.friendlyName;
            if (body.ial !== undefined)
                spUpdates.ialMax = body.ial;
            if (body.defaultAal !== undefined)
                spUpdates.aalMax = body.defaultAal;
            if (body.publicCertificate !== undefined)
                spUpdates.publicKey = body.publicCertificate;
            if (body.redirectUris !== undefined) {
                const uris = parseRedirectUris(body.redirectUris);
                if (uris.length > 0)
                    spUpdates.redirectUris = JSON.stringify(uris);
            }
            if (body.themeConfig !== undefined) {
                spUpdates.theme = JSON.stringify({
                    agencyName: body.friendlyName,
                    primaryColor: body.themeConfig?.primaryColor,
                    heroPanel: body.themeConfig?.heroPanel,
                    backLinkText: body.themeConfig?.backLinkText,
                    backLinkUrl: body.themeConfig?.backLinkUrl,
                    formBackground: { color: body.themeConfig?.formBackgroundColor },
                    logo: body.logo || "",
                });
            }
            if (Object.keys(spUpdates).length > 0) {
                await d.update(serviceProviders).set(spUpdates).where(eq(serviceProviders.id, sp.id));
            }
        }
        else {
            // SP doesn't exist yet — create it (e.g., editing a pre-existing agency)
            const redirectUris = parseRedirectUris(body.redirectUris);
            if (redirectUris.length > 0 && body.publicCertificate) {
                const clientId = generateClientId(body.abbreviation, body.friendlyName);
                await d.insert(serviceProviders).values({
                    id: clientId,
                    agencyId: id,
                    name: body.friendlyName,
                    ialMax: body.ial ?? 1,
                    aalMax: body.defaultAal ?? 1,
                    redirectUris: JSON.stringify(redirectUris),
                    publicKey: body.publicCertificate,
                    theme: body.themeConfig ? JSON.stringify({
                        agencyName: body.friendlyName,
                        primaryColor: body.themeConfig.primaryColor,
                        heroPanel: body.themeConfig.heroPanel,
                        backLinkText: body.themeConfig.backLinkText,
                        backLinkUrl: body.themeConfig.backLinkUrl,
                        formBackground: { color: body.themeConfig.formBackgroundColor },
                        logo: body.logo || "",
                    }) : null,
                    createdAt: now,
                });
            }
        }
        return c.json({ ok: true });
    }
    catch (e) {
        console.error("PUT /api/agencies/:id error:", e);
        return c.json({ error: e.message }, 500);
    }
});
// ── DELETE /api/agencies/:id ────────────────────────────────
app.delete("/api/agencies/:id", async (c) => {
    try {
        const id = c.req.param("id");
        const d = db();
        const [existing] = await d.select({ id: agencies.id }).from(agencies).where(eq(agencies.id, id)).limit(1);
        if (!existing)
            return c.json({ error: "not_found" }, 404);
        // Delete linked service provider first
        await d.delete(serviceProviders).where(eq(serviceProviders.agencyId, id));
        await d.delete(agencies).where(eq(agencies.id, id));
        return c.json({ ok: true });
    }
    catch (e) {
        console.error("DELETE /api/agencies/:id error:", e);
        return c.json({ error: e.message }, 500);
    }
});
// ── GET /api/agencies/:id/preview ────────────────────────────
// Render the hosted UI sign-in page with this agency's theme
app.get("/api/agencies/:id/preview", async (c) => {
    try {
        const id = c.req.param("id");
        const d = db();
        const [row] = await d.select().from(agencies).where(eq(agencies.id, id)).limit(1);
        if (!row)
            return c.json({ error: "not_found" }, 404);
        let theme = { ...DEFAULT_THEME };
        // Build theme from agency fields
        if (row.themeConfig) {
            try {
                const parsed = JSON.parse(row.themeConfig);
                theme = { ...DEFAULT_THEME, ...parsed };
            }
            catch { }
        }
        // Override with top-level agency fields (these take precedence)
        if (row.friendlyName) {
            theme.agencyName = row.friendlyName;
        }
        if (row.logo) {
            theme.logo = row.logo;
        }
        const html = renderPage(theme, "", "en", String(row.ial));
        return c.html(html);
    }
    catch (e) {
        console.error("GET /api/agencies/:id/preview error:", e);
        return c.json({ error: e.message }, 500);
    }
});
export default app;
