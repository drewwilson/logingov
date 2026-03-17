import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { FormPanel } from "./FormPanel.js";
import { HeroPanel } from "./HeroPanel.js";
export function SignInPage({ theme, sessionId }) {
    const hasHero = Boolean(theme.heroPanel);
    return (_jsxs("div", { className: `layout${hasHero ? "" : " layout--no-hero"}`, children: [_jsx(FormPanel, { logo: theme.logo, agencyName: theme.agencyName, backLinkText: theme.backLinkText, backLinkUrl: theme.backLinkUrl, secondaryLinkText: theme.secondaryLinkText || "Forgot?", sessionId: sessionId }), hasHero && _jsx(HeroPanel, { heroPanel: theme.heroPanel })] }));
}
