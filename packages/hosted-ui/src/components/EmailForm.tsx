import React from "react";

interface EmailFormProps {
  sessionId: string;
  secondaryLinkText: string;
}

export function EmailForm({ sessionId, secondaryLinkText }: EmailFormProps) {
  return (
    <form id="sign-in-form" method="POST" action="/api/auth/sign-in/email">
      <input type="hidden" name="session_id" value={sessionId} />
      <div className="field-header">
        <label htmlFor="email" className="field-label">
          Email address
        </label>
      </div>
      <input
        type="email"
        id="email"
        name="email"
        className="email-input"
        placeholder="Enter your email address"
        autoComplete="email"
        required
      />
      <div id="password-field" className="password-field hidden">
        <div className="field-header">
          <label htmlFor="password" className="field-label">
            Password
          </label>
          <a href="#" className="field-link">
            {secondaryLinkText}
          </a>
        </div>
        <input
          type="password"
          id="password"
          name="password"
          className="email-input"
          placeholder="Enter your password"
          autoComplete="current-password"
        />
      </div>
      <button type="submit" className="continue-btn">
        Continue
      </button>
      <div id="form-error" className="form-error hidden" />
    </form>
  );
}
