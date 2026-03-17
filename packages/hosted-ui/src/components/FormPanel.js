import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { sanitizeUrl } from "../theme.js";
import { SocialButtons } from "./SocialButtons.js";
import { Divider } from "./Divider.js";
import { EmailForm } from "./EmailForm.js";
function Logo({ logo }) {
    if (logo.trimStart().startsWith("<svg")) {
        return (_jsx("div", { className: "agency-logo", dangerouslySetInnerHTML: { __html: logo } }));
    }
    const url = sanitizeUrl(logo);
    if (!url)
        return null;
    return _jsx("img", { src: url, alt: "", className: "agency-logo" });
}
export function FormPanel({ logo, agencyName, backLinkText, backLinkUrl, secondaryLinkText, sessionId, }) {
    return (_jsxs("div", { className: "form-panel", children: [_jsx("div", { className: "back-link-container", children: _jsxs("a", { href: sanitizeUrl(backLinkUrl) || "#", className: "back-link", children: [_jsx("svg", { width: "7", height: "12", viewBox: "0 0 7 12", fill: "none", "aria-hidden": "true", children: _jsx("path", { d: "M6 1L1 6L6 11", stroke: "currentColor", strokeWidth: "1.5", strokeLinecap: "round", strokeLinejoin: "round" }) }), backLinkText] }) }), _jsxs("div", { className: "form-content", children: [_jsxs("div", { className: "branding", children: [logo && _jsx(Logo, { logo: logo }), _jsx("h2", { className: "agency-name", children: agencyName })] }), _jsxs("div", { className: "sign-in-section", children: [_jsx("h1", { className: "sign-in-heading", children: "Welcome" }), _jsx("p", { className: "sign-in-subtitle", children: "Please sign in or sign up to continue" }), _jsx(SocialButtons, {}), _jsx(Divider, {}), _jsx(EmailForm, { sessionId: sessionId, secondaryLinkText: secondaryLinkText })] })] })] }));
}
