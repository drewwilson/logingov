export interface SPThemeConfig {
  /** Image URL (string) or inline SVG markup (string starting with "<svg") */
  logo: string;
  agencyName: string;
  /** Single hex color — opacity variants derived in CSS via color-mix */
  primaryColor: string;
  /** Right panel: image URL or hex color (e.g. "#e0e0e0") */
  heroPanel: string;
  /** e.g. "Back to IRS.gov" */
  backLinkText: string;
  /** e.g. "https://irs.gov" */
  backLinkUrl: string;
  /** e.g. "Forgot?" or "Use Phone" */
  secondaryLinkText?: string;
  formBackground: {
    /** Solid base color for the form panel */
    color: string;
    /** Optional CSS gradient or image layered on top of the solid color */
    overlay?: string;
  };
}

export interface SignInPageProps {
  theme: SPThemeConfig;
  sessionId: string;
  locale: string;
  isDarkBackground: boolean;
}
