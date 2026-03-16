import type { SignInPageProps } from "../types.js";
import { FormPanel } from "./FormPanel.js";
import { HeroPanel } from "./HeroPanel.js";

export function SignInPage({ theme, sessionId }: SignInPageProps) {
  const hasHero = Boolean(theme.heroPanel);

  return (
    <div className={`layout${hasHero ? "" : " layout--no-hero"}`}>
      <FormPanel
        logo={theme.logo}
        agencyName={theme.agencyName}
        backLinkText={theme.backLinkText}
        backLinkUrl={theme.backLinkUrl}
        secondaryLinkText={theme.secondaryLinkText || "Forgot?"}
        sessionId={sessionId}
      />
      {hasHero && <HeroPanel heroPanel={theme.heroPanel} />}
    </div>
  );
}
