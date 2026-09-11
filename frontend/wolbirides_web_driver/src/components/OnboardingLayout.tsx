import type { ReactNode } from "react";
import "./OnboardingLayout.css";

export default function OnboardingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="onboarding-page">
      <header className="onboarding-header">
        <span className="brand-mark">WR</span>
        <span className="onboarding-brand-name">WolbiRides Driver</span>
      </header>
      <main className="onboarding-main">{children}</main>
    </div>
  );
}
