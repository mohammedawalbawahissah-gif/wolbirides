import type { ReactNode } from "react";
import "./AuthLayout.css";

export default function AuthLayout({
  children,
}: {
  tagline?: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="auth-page">
      <div className="auth-brand-panel">
        <div className="auth-brand-lockup">
          <img src="/favicon.svg" alt="" className="auth-lockup-icon" />
          <span className="auth-lockup-name">WolbiRides</span>
        </div>
      </div>
      <div className="auth-form-panel">
        <div className="auth-form-box">{children}</div>
      </div>
    </div>
  );
}
