import type { Trip } from "../api/client";
import "./RideStepper.css";

const STEPS: { key: Trip["status"][]; label: string }[] = [
  { key: ["requested", "matching"], label: "Finding driver" },
  { key: ["matched"], label: "Driver assigned" },
  { key: ["driver_arriving"], label: "Arriving" },
  { key: ["in_progress"], label: "On trip" },
  { key: ["completed"], label: "Done" },
];

export default function RideStepper({ status }: { status: Trip["status"] }) {
  if (status === "cancelled" || status === "no_drivers_found") return null;

  const activeIndex = STEPS.findIndex((s) => s.key.includes(status));

  return (
    <div className="ride-stepper" role="progressbar" aria-valuenow={activeIndex + 1} aria-valuemax={STEPS.length}>
      {STEPS.map((step, i) => {
        const state = i < activeIndex ? "done" : i === activeIndex ? "active" : "pending";
        return (
          <div className={`ride-step ride-step-${state}`} key={step.label}>
            <div className="ride-step-dot">{state === "done" ? "✓" : i + 1}</div>
            <div className="ride-step-label">{step.label}</div>
            {i < STEPS.length - 1 && <div className="ride-step-line" />}
          </div>
        );
      })}
    </div>
  );
}
