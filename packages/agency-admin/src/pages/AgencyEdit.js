import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useState } from "react";
const EMPTY = {
    iaaName: "",
    friendlyName: "",
    abbreviation: "",
    description: "",
    websiteUrl: "",
    protocol: "oidc",
    ial: 1,
    defaultAal: 1,
    logo: "",
    publicCertificate: "",
    redirectUris: "",
    status: "draft",
    themeConfig: {
        primaryColor: "#0071bc",
        heroPanel: "",
        backLinkText: "",
        backLinkUrl: "",
        formBackgroundColor: "#ffffff",
    },
};
export function AgencyEdit({ id, onBack }) {
    const [data, setData] = useState(EMPTY);
    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [error, setError] = useState(null);
    const isNew = id === null;
    useEffect(() => {
        if (!id)
            return;
        fetch(`/api/agencies/${id}`)
            .then((r) => r.json())
            .then((row) => {
            let theme = EMPTY.themeConfig;
            if (row.themeConfig) {
                try {
                    theme = { ...EMPTY.themeConfig, ...JSON.parse(row.themeConfig) };
                }
                catch { }
            }
            setData({
                iaaName: row.iaaName ?? "",
                friendlyName: row.friendlyName ?? "",
                abbreviation: row.abbreviation ?? "",
                description: row.description ?? "",
                websiteUrl: row.websiteUrl ?? "",
                protocol: row.protocol ?? "oidc",
                ial: row.ial ?? 1,
                defaultAal: row.defaultAal ?? 1,
                logo: row.logo ?? "",
                publicCertificate: row.publicCertificate ?? "",
                redirectUris: row.redirectUris ?? "",
                status: row.status ?? "draft",
                themeConfig: theme,
            });
        });
    }, [id]);
    function set(key, value) {
        setData((prev) => ({ ...prev, [key]: value }));
    }
    function setTheme(key, value) {
        setData((prev) => ({
            ...prev,
            themeConfig: { ...prev.themeConfig, [key]: value },
        }));
    }
    async function handleSave() {
        setSaving(true);
        setError(null);
        const method = isNew ? "POST" : "PUT";
        const url = isNew ? "/api/agencies" : `/api/agencies/${id}`;
        // Auto-fill back link fields from websiteUrl if left empty
        const payload = { ...data, themeConfig: { ...data.themeConfig } };
        if (!payload.themeConfig.backLinkUrl && payload.websiteUrl) {
            payload.themeConfig.backLinkUrl = payload.websiteUrl;
        }
        if (!payload.themeConfig.backLinkText && payload.websiteUrl) {
            payload.themeConfig.backLinkText = `Back to ${payload.websiteUrl.replace(/^https?:\/\//, "")}`;
        }
        try {
            const res = await fetch(url, {
                method,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            const json = await res.json();
            if (!res.ok) {
                setError(json.error || `Request failed (${res.status})`);
                setSaving(false);
                return;
            }
            onBack();
        }
        catch (e) {
            setError(e.message || "Network error");
            setSaving(false);
        }
    }
    async function handleDelete() {
        if (!confirm("Delete this agency?"))
            return;
        setDeleting(true);
        await fetch(`/api/agencies/${id}`, { method: "DELETE" });
        setDeleting(false);
        onBack();
    }
    function handleLogoFile(e) {
        const file = e.target.files?.[0];
        if (!file)
            return;
        if (file.type === "image/svg+xml") {
            const reader = new FileReader();
            reader.onload = () => set("logo", reader.result);
            reader.readAsText(file);
        }
        else {
            const reader = new FileReader();
            reader.onload = () => set("logo", reader.result);
            reader.readAsDataURL(file);
        }
    }
    return (_jsxs("div", { className: "container", children: [_jsxs("div", { className: "page-header", children: [_jsxs("div", { children: [_jsx("button", { className: "btn btn-secondary btn-sm", onClick: onBack, children: "\u2190 Back" }), _jsx("h1", { children: isNew ? "New Agency" : "Edit Agency" }), !isNew && (_jsxs("p", { className: "agency-id mono text-muted", title: "Click to copy", onClick: () => navigator.clipboard.writeText(id), children: ["ID: ", id] }))] }), _jsx("div", { className: "header-actions", children: !isNew && (_jsxs(_Fragment, { children: [_jsx("button", { className: "btn btn-secondary btn-sm", onClick: () => window.open(`/api/agencies/${id}/preview`, "_blank"), children: "Preview Sign-In" }), _jsx("button", { className: "btn btn-danger btn-sm", onClick: handleDelete, disabled: deleting, children: deleting ? "Deleting..." : "Delete" })] })) })] }), error && _jsx("div", { className: "error-banner", children: error }), _jsxs("div", { className: "form-card", children: [_jsxs("fieldset", { children: [_jsx("legend", { children: "Registration Info" }), _jsxs("label", { children: [_jsx("span", { className: "label-text", children: "IAA Application Name *" }), _jsx("input", { type: "text", value: data.iaaName, onChange: (e) => set("iaaName", e.target.value), required: true })] }), _jsxs("label", { children: [_jsx("span", { className: "label-text", children: "Friendly Name *" }), _jsx("input", { type: "text", value: data.friendlyName, onChange: (e) => set("friendlyName", e.target.value), required: true })] }), _jsxs("div", { className: "form-row", children: [_jsxs("label", { children: [_jsx("span", { className: "label-text", children: "Abbreviation" }), _jsx("input", { type: "text", value: data.abbreviation, onChange: (e) => set("abbreviation", e.target.value), placeholder: "e.g. IRS" })] }), _jsxs("label", { children: [_jsx("span", { className: "label-text", children: "Website URL" }), _jsx("input", { type: "url", value: data.websiteUrl, onChange: (e) => set("websiteUrl", e.target.value), placeholder: "https://agency.gov" })] })] }), _jsxs("label", { children: [_jsx("span", { className: "label-text", children: "Description" }), _jsx("textarea", { value: data.description, onChange: (e) => set("description", e.target.value), rows: 3 })] })] }), _jsxs("fieldset", { children: [_jsx("legend", { children: "Protocol & Assurance" }), _jsxs("div", { className: "form-row", children: [_jsxs("label", { children: [_jsx("span", { className: "label-text", children: "Protocol" }), _jsxs("select", { value: data.protocol, onChange: (e) => set("protocol", e.target.value), children: [_jsx("option", { value: "oidc", children: "OpenID Connect" }), _jsx("option", { value: "saml", children: "SAML" })] })] }), _jsxs("label", { children: [_jsx("span", { className: "label-text", children: "Service Level" }), _jsxs("select", { value: data.ial, onChange: (e) => set("ial", Number(e.target.value)), children: [_jsx("option", { value: 1, children: "Authentication Only (IAL1)" }), _jsx("option", { value: 2, children: "Identity Verification (IAL2)" })] })] }), _jsxs("label", { children: [_jsx("span", { className: "label-text", children: "Default AAL" }), _jsxs("select", { value: data.defaultAal, onChange: (e) => set("defaultAal", Number(e.target.value)), children: [_jsx("option", { value: 1, children: "AAL1" }), _jsx("option", { value: 2, children: "AAL2" })] })] })] }), _jsxs("label", { children: [_jsx("span", { className: "label-text", children: "Public Certificate (PEM)" }), _jsx("textarea", { value: data.publicCertificate, onChange: (e) => set("publicCertificate", e.target.value), rows: 6, className: "mono", placeholder: "-----BEGIN PUBLIC KEY-----\n..." })] }), _jsxs("label", { children: [_jsx("span", { className: "label-text", children: "Redirect URIs (one per line)" }), _jsx("textarea", { value: data.redirectUris, onChange: (e) => set("redirectUris", e.target.value), rows: 3, className: "mono", placeholder: "https://agency.gov/auth/callback\nhttps://staging.agency.gov/auth/callback" })] })] }), _jsxs("fieldset", { children: [_jsx("legend", { children: "Branding / Theme" }), _jsxs("label", { children: [_jsx("span", { className: "label-text", children: "Logo (SVG or image file)" }), _jsx("input", { type: "file", accept: "image/*,.svg", onChange: handleLogoFile })] }), data.logo && (_jsx("div", { className: "logo-preview", children: data.logo.startsWith("<") ? (_jsx("div", { dangerouslySetInnerHTML: { __html: data.logo } })) : (_jsx("img", { src: data.logo, alt: "Logo preview" })) })), _jsxs("div", { className: "form-row", children: [_jsxs("label", { children: [_jsx("span", { className: "label-text", children: "Primary Color" }), _jsxs("div", { className: "color-input", children: [_jsx("input", { type: "color", value: data.themeConfig.primaryColor, onChange: (e) => setTheme("primaryColor", e.target.value) }), _jsx("input", { type: "text", value: data.themeConfig.primaryColor, onChange: (e) => setTheme("primaryColor", e.target.value), className: "mono", maxLength: 7 })] })] }), _jsxs("label", { children: [_jsx("span", { className: "label-text", children: "Form Background Color" }), _jsxs("div", { className: "color-input", children: [_jsx("input", { type: "color", value: data.themeConfig.formBackgroundColor, onChange: (e) => setTheme("formBackgroundColor", e.target.value) }), _jsx("input", { type: "text", value: data.themeConfig.formBackgroundColor, onChange: (e) => setTheme("formBackgroundColor", e.target.value), className: "mono", maxLength: 7 })] })] })] }), _jsxs("label", { children: [_jsx("span", { className: "label-text", children: "Hero Panel (image URL or CSS gradient)" }), _jsx("input", { type: "text", value: data.themeConfig.heroPanel, onChange: (e) => setTheme("heroPanel", e.target.value), placeholder: "linear-gradient(135deg, #0071bc 0%, #112e51 100%)" })] }), _jsxs("div", { className: "form-row", children: [_jsxs("label", { children: [_jsx("span", { className: "label-text", children: "Back Link Text" }), _jsx("input", { type: "text", value: data.themeConfig.backLinkText, onChange: (e) => setTheme("backLinkText", e.target.value), placeholder: data.websiteUrl ? `Back to ${data.websiteUrl.replace(/^https?:\/\//, "")}` : "Back to Agency.gov" })] }), _jsxs("label", { children: [_jsx("span", { className: "label-text", children: "Back Link URL" }), _jsx("input", { type: "url", value: data.themeConfig.backLinkUrl, onChange: (e) => setTheme("backLinkUrl", e.target.value), placeholder: data.websiteUrl || "https://agency.gov" })] })] })] }), _jsxs("fieldset", { children: [_jsx("legend", { children: "Status" }), _jsx("label", { children: _jsxs("select", { value: data.status, onChange: (e) => set("status", e.target.value), children: [_jsx("option", { value: "draft", children: "Draft" }), _jsx("option", { value: "active", children: "Active" }), _jsx("option", { value: "inactive", children: "Inactive" })] }) })] }), _jsxs("div", { className: "form-actions", children: [_jsx("button", { className: "btn btn-primary", onClick: handleSave, disabled: saving, children: saving ? "Saving..." : isNew ? "Create Agency" : "Save Changes" }), _jsx("button", { className: "btn btn-secondary", onClick: onBack, children: "Cancel" })] })] })] }));
}
