import { sanitizeUrl } from "../theme.js";
import { SocialButtons } from "./SocialButtons.js";
import { Divider } from "./Divider.js";
import { EmailForm } from "./EmailForm.js";

interface FormPanelProps {
  logo: string;
  agencyName: string;
  backLinkText: string;
  backLinkUrl: string;
  secondaryLinkText: string;
  sessionId: string;
}

function Logo({ logo }: { logo: string }) {
  if (logo.trimStart().startsWith("<svg")) {
    return (
      <div className="agency-logo" dangerouslySetInnerHTML={{ __html: logo }} />
    );
  }

  const url = sanitizeUrl(logo);
  if (!url) return null;

  return <img src={url} alt="" className="agency-logo" />;
}

export function FormPanel({
  logo,
  agencyName,
  backLinkText,
  backLinkUrl,
  secondaryLinkText,
  sessionId,
}: FormPanelProps) {
  return (
    <div className="form-panel">
      <div className="back-link-container">
        <a href={sanitizeUrl(backLinkUrl) || "#"} className="back-link">
          <svg
            width="7"
            height="12"
            viewBox="0 0 7 12"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M6 1L1 6L6 11"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {backLinkText}
        </a>
      </div>

      <div className="form-content">
        <div className="branding">
          {logo && <Logo logo={logo} />}
          <h2 className="agency-name">{agencyName}</h2>
        </div>

        <div className="sign-in-section">
          <h1 className="sign-in-heading">Welcome</h1>
          <p className="sign-in-subtitle">
            Please sign in or sign up to continue
          </p>

          <SocialButtons />
          <Divider />
          <EmailForm
            sessionId={sessionId}
            secondaryLinkText={secondaryLinkText}
          />
        </div>
      </div>
    </div>
  );
}
