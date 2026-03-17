export const DEFAULT_THEME = {
    logo: `<svg width="70" height="70" viewBox="0 0 70 70" fill="none" xmlns="http://www.w3.org/2000/svg">
<rect x="42" y="27" width="16" height="8" fill="currentColor"/>
<rect x="17" y="51" width="16" height="8" fill="currentColor"/>
<rect x="33" y="43" width="19" height="8" fill="currentColor"/>
<rect x="11" y="35" width="22" height="8" fill="currentColor"/>
<rect x="42" y="11" width="22" height="8" fill="currentColor"/>
<rect x="8" y="19" width="34" height="8" fill="currentColor"/>
</svg>
`,
    agencyName: "Login.gov",
    primaryColor: "#0D2E7B",
    heroPanel: "linear-gradient(135deg, #0D2E7B 0%, #245ad8 100%)",
    backLinkText: "Back to Login.gov",
    backLinkUrl: "https://login.gov",
    secondaryLinkText: "Forgot?",
    formBackground: {
        color: "#ffffff",
    },
};
/**
 * Determine if a hex color is "light" (should use dark text on top)
 * or "dark" (should use white text on top).
 * Uses relative luminance per WCAG 2.0.
 */
export function isLightColor(hex) {
    const cleaned = hex.replace("#", "");
    const r = parseInt(cleaned.substring(0, 2), 16) / 255;
    const g = parseInt(cleaned.substring(2, 4), 16) / 255;
    const b = parseInt(cleaned.substring(4, 6), 16) / 255;
    const toLinear = (c) => c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    const luminance = 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
    return luminance > 0.4;
}
/**
 * Only allow URLs starting with https:// or / to prevent script injection.
 */
export function sanitizeUrl(url) {
    if (url.startsWith("https://") || url.startsWith("/"))
        return url;
    return "";
}
