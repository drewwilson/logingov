import { jsx as _jsx } from "react/jsx-runtime";
import { sanitizeUrl } from "../theme.js";
export function HeroPanel({ heroPanel }) {
    if (!heroPanel)
        return null;
    const isGradient = heroPanel.includes("gradient(");
    const isColor = heroPanel.startsWith("#") || heroPanel.startsWith("rgb");
    const isImage = heroPanel.startsWith("https://") || heroPanel.startsWith("/");
    const style = isGradient
        ? { backgroundImage: heroPanel }
        : isImage
            ? { backgroundImage: `url('${sanitizeUrl(heroPanel)}')` }
            : isColor
                ? { backgroundColor: heroPanel }
                : {};
    return (_jsx("div", { className: "hero-panel", style: style, role: "presentation" }));
}
