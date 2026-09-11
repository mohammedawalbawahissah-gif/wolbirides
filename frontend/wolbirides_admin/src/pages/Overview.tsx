import { useEffect, useState } from "react";
import { api, type DashboardSummary } from "../api/client";
import { EmptyState, KpiCard, LoadingState, PageHeader } from "../components/ui";

export default function Overview() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<DashboardSummary>("/admin/dashboard/summary")
      .then(({ data }) => {
        if (!cancelled) setSummary(data);
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load the dashboard summary.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      <PageHeader
        title="Overview"
        subtitle="What needs attention right now, pilot zone by pilot zone."
      />

      {error && <EmptyState message={error} />}
      {!summary && !error && <LoadingState />}

      {summary && (
        <>
          <div className="kpi-grid">
            <KpiCard label="Drivers online" value={summary.drivers_online} />
            <KpiCard
              label="Pending driver verifications"
              value={summary.drivers_pending_verification}
              tone={summary.drivers_pending_verification > 0 ? "warning" : "neutral"}
            />
            <KpiCard label="Trips today" value={summary.trips_today} />
            <KpiCard label="Completed today" value={summary.trips_completed_today} />
            <KpiCard
              label="Cancelled today"
              value={summary.trips_cancelled_today}
              tone={summary.trips_cancelled_today > 0 ? "warning" : "neutral"}
            />
            <KpiCard
              label="Cancellation rate today"
              value={
                summary.cancellation_rate_today != null
                  ? `${Math.round(summary.cancellation_rate_today * 100)}%`
                  : "—"
              }
            />
            <KpiCard
              label="Open incidents"
              value={summary.open_incidents}
              tone={summary.open_incidents > 0 ? "danger" : "neutral"}
            />
            <KpiCard
              label="Open support tickets"
              value={summary.open_support_tickets}
              tone={summary.open_support_tickets > 0 ? "warning" : "neutral"}
            />
          </div>

          {Object.keys(summary.open_incidents_by_severity).length > 0 && (
            <div className="panel">
              <div className="panel-header">
                <h2>Open incidents by severity</h2>
              </div>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Severity</th>
                    <th>Count</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(summary.open_incidents_by_severity).map(([severity, count]) => (
                    <tr key={severity}>
                      <td>{severity.toUpperCase()}</td>
                      <td>{count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
