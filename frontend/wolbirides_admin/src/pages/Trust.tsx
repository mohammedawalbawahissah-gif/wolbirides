import { useEffect, useState } from "react";
import { api } from "../api/client";
import { EmptyState, KpiCard, LoadingState, PageHeader } from "../components/ui";

interface Indicators {
  days: number;
  notification_opt_out: { users_opted_out: number; passengers: number; rate: number; what_it_catches: string };
  driver_trip_distribution_7d: { gini: number; p90_p10_ratio: number | null; drivers: number; what_it_catches: string };
  pressure_language_tickets: {
    count: number; of_all_tickets: number; what_it_catches: string;
    recent: { id: string; subject: string; created_at: string }[];
  };
}

/** The Growth PRD's three cross-cutting signals that efficiency work has started costing trust. */
export default function Trust() {
  const [data, setData] = useState<Indicators | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<Indicators>("/admin/trust-indicators?days=30").then(({ data }) => setData(data))
      .catch(() => setError("Couldn't load trust indicators."));
  }, []);

  return (
    <div>
      <PageHeader title="Trust indicators"
        subtitle="Early warnings that growth features have started trading against riders' and drivers' trust. Treat a rise as a signal to fix, not to route around." />
      {error && <EmptyState message={error} />}
      {!data && !error && <LoadingState />}
      {data && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, marginBottom: 16 }}>
            <KpiCard label={`Notification opt-out rate (${data.notification_opt_out.users_opted_out} of ${data.notification_opt_out.passengers})`}
              value={`${Math.round(data.notification_opt_out.rate * 100)}%`}
              tone={data.notification_opt_out.rate > 0.25 ? "warning" : "neutral"} />
            <KpiCard label="Driver trip concentration, 7 days (Gini)" value={data.driver_trip_distribution_7d.gini.toFixed(2)}
              tone={data.driver_trip_distribution_7d.gini > 0.4 ? "warning" : "neutral"} />
            <KpiCard label={`Tickets saying "pressured" / "didn't realize" (30 days, of ${data.pressure_language_tickets.of_all_tickets})`}
              value={String(data.pressure_language_tickets.count)}
              tone={data.pressure_language_tickets.count > 0 ? "warning" : "neutral"} />
          </div>
          <div className="panel" style={{ padding: 20 }}>
            <p style={{ margin: "0 0 6px" }}><strong>Opt-outs:</strong> {data.notification_opt_out.what_it_catches}</p>
            <p style={{ margin: "0 0 6px" }}><strong>Concentration:</strong> {data.driver_trip_distribution_7d.what_it_catches}</p>
            <p style={{ margin: 0 }}><strong>Pressure language:</strong> {data.pressure_language_tickets.what_it_catches}</p>
            {data.pressure_language_tickets.recent.length > 0 && (
              <ul style={{ marginTop: 12 }}>
                {data.pressure_language_tickets.recent.map((t) => (
                  <li key={t.id}>{t.subject} <span style={{ color: "var(--ink-muted)" }}>({new Date(t.created_at).toLocaleDateString()})</span></li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
