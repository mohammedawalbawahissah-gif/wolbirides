import type { ReactNode } from "react";
import "./AuthLayout.css";

export default function AuthLayout({
  tagline,
  description,
  children,
}: {
  tagline: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="auth-page">
      <div className="auth-brand-panel">
        <div className="auth-brand-content">
          <div className="auth-logo">
            <span className="auth-logo-mark">WR</span>
            <span className="auth-logo-name">WolbiRides Ops</span>
          </div>
          <h1>{tagline}</h1>
          <p>{description || "Founder-run operations console for the WolbiRides UDS pilot."}</p>
        </div>
      </div>
      <div className="auth-form-panel">
        <div className="auth-form-box">{children}</div>
      </div>
    </div>
  );
}
