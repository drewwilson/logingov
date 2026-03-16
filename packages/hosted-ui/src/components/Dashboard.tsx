import React from "react";

export interface DashboardProps {
  name: string;
  email: string;
  image?: string;
}

export function Dashboard({ name, email, image }: DashboardProps) {
  const initial = (name || email)[0].toUpperCase();

  return (
    <div className="page">
      <div className="top-bar">
        <a href="/dashboard" className="top-bar-logo">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          Login.gov
        </a>
      </div>

      <div className="content">
        <div className="avatar">
          {image ? <img src={image} alt="" /> : initial}
        </div>

        <h1 className="greeting">Welcome, {name || "User"}</h1>

        <div className="status">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6L9 17l-5-5" />
          </svg>
          Signed in successfully
        </div>

        <div className="info-card">
          <div className="info-row">
            <span className="info-label">Email</span>
            <span className="info-value">{email}</span>
          </div>
          <div className="info-row">
            <span className="info-label">Name</span>
            <span className="info-value">{name || "User"}</span>
          </div>
        </div>

        <button className="logout-btn" id="logout-btn">Sign out</button>
      </div>
    </div>
  );
}
