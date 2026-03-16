import React from "react";
import { sanitizeUrl } from "../theme.js";

interface HeroPanelProps {
  heroPanel: string;
}

export function HeroPanel({ heroPanel }: HeroPanelProps) {
  if (!heroPanel) return null;

  const isGradient = heroPanel.includes("gradient(");
  const isColor = heroPanel.startsWith("#") || heroPanel.startsWith("rgb");
  const isImage = heroPanel.startsWith("https://") || heroPanel.startsWith("/");

  const style: React.CSSProperties = isGradient
    ? { backgroundImage: heroPanel }
    : isImage
      ? { backgroundImage: `url('${sanitizeUrl(heroPanel)}')` }
      : isColor
        ? { backgroundColor: heroPanel }
        : {};

  return (
    <div
      className="hero-panel"
      style={style}
      role="presentation"
    />
  );
}
