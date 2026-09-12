import "./OnboardingStepper.css";

export default function OnboardingStepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <div className="onboarding-stepper" role="progressbar" aria-valuenow={current + 1} aria-valuemax={steps.length}>
      {steps.map((label, i) => {
        const state = i < current ? "done" : i === current ? "active" : "pending";
        return (
          <div className={`onb-step onb-step-${state}`} key={label}>
            <div className="onb-step-dot">{state === "done" ? "✓" : i + 1}</div>
            <div className="onb-step-label">{label}</div>
            {i < steps.length - 1 && <div className="onb-step-line" />}
          </div>
        );
      })}
    </div>
  );
}
