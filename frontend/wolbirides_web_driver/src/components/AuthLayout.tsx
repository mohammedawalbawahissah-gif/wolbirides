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
            <span className="auth-logo-name">WolbiRides</span>
          </div>
          <h1>{tagline}</h1>
          <p>{description || "The UDS-first mobility platform — request a yellow-yellow, see who's coming, track the trip."}</p>
        </div>
      </div>
      <div className="auth-form-panel">
        <div className="auth-form-box">{children}</div>
      </div>
    </div>
  );
}
