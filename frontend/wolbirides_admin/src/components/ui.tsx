import "./ui.css";

const STATUS_TONES: Record<string, "success" | "danger" | "warning" | "neutral"> = {
  verified: "success",
  completed: "success",
  resolved: "success",
  active: "success",
  matched: "success",
  in_progress: "warning",
  matching: "warning",
  driver_arriving: "warning",
  investigating: "warning",
  pending: "warning",
  open: "warning",
  requested: "neutral",
  cancelled: "danger",
  suspended: "danger",
  rejected: "danger",
  no_drivers_found: "danger",
  p0: "danger",
  p1: "danger",
  p2: "warning",
  p3: "neutral",
};

export function StatusBadge({ status }: { status: string }) {
  const tone = STATUS_TONES[status] ?? "neutral";
  return <span className={`badge badge-${tone}`}>{status.replace(/_/g, " ")}</span>;
}

export function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="page-header">
      <h1>{title}</h1>
      {subtitle && <p>{subtitle}</p>}
    </div>
  );
}

export function KpiCard({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string | number;
  tone?: "neutral" | "warning" | "danger";
}) {
  return (
    <div className={`kpi-card kpi-${tone}`}>
      <div className="kpi-value">{value}</div>
      <div className="kpi-label">{label}</div>
    </div>
  );
}

export function EmptyState({ message }: { message: string }) {
  return <div className="empty-state">{message}</div>;
}

export function LoadingState() {
  return <div className="empty-state">Loading…</div>;
}
