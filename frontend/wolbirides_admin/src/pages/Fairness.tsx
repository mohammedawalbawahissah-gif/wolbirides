import { useEffect, useState } from "react";
import { api } from "../api/client";
import { EmptyState, KpiCard, LoadingState, PageHeader } from "../components/ui";

interface Report {
  days: number;
  drivers: { driver_id: string; name: string; offers: number; accepted: number; completed_trips: number; earnings: string }[];
  summary: {
    drivers: number; completed_trips: number; top_20_percent_share: number; drivers_with_no_trips: number;
    gini: number; p90_p10_ratio: number | null; fair_queue_offers: number; fair_queue_share_of_offers: number;
    fair_queue_avg_extra_km: number;
  };
}

/** WR-20: is work being shared fairly between verified drivers? */
export default function Fairness() {
  const [days, setDays] = useState(7);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks-js/set-state-in-effect -- resets loading/error state as the effect starts a fetch or subscription
    setReport(null);
    api.get<Report>(`/admin/dispatch/fairness?days=${days}`).then(({ data }) => setReport(data)).catch(() => setError("Couldn't load the report."));
  }, [days]);

  return (
    <div>
      <PageHeader title="Dispatch fairness"
        subtitle="Most offers go nearest-first. On a small share (FAIR_QUEUE_SHARE, 15%), the equally-close driver with the fewest trips this week goes first. Watch the extra pickup distance: that's the rider's cost." />
      <div className="filter-row">
        <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
        </select>
      </div>
      {error && <EmptyState message={error} />}
      {!report && !error && <LoadingState />}
      {report && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 16 }}>
            <KpiCard label="Completed trips" value={String(report.summary.completed_trips)} />
            <KpiCard label="Share taken by busiest 20% of drivers" value={`${Math.round(report.summary.top_20_percent_share * 100)}%`} />
            <KpiCard label="Verified drivers with no trips" value={String(report.summary.drivers_with_no_trips)} />
            <KpiCard label="Gini of trips per driver (0 = even)" value={report.summary.gini.toFixed(2)} />
            <KpiCard label="p90 / p10 trips per driver" value={report.summary.p90_p10_ratio == null ? "—" : String(report.summary.p90_p10_ratio)} />
            <KpiCard label="Offers made by the fairness floor"
              value={`${report.summary.fair_queue_offers} (${Math.round(report.summary.fair_queue_share_of_offers * 100)}%)`} />
            <KpiCard label="Extra pickup distance per fairness offer"
              value={`${(report.summary.fair_queue_avg_extra_km * 1000).toFixed(0)} m`}
              tone={report.summary.fair_queue_avg_extra_km > 0.4 ? "warning" : "neutral"} />
          </div>
          {report.drivers.length === 0 ? <EmptyState message="No verified drivers yet." /> : (
            <div className="panel">
              <table className="data-table">
                <thead><tr><th>Driver</th><th>Offers</th><th>Accepted</th><th>Completed</th><th>Fares</th></tr></thead>
                <tbody>
                  {report.drivers.map((d) => (
                    <tr key={d.driver_id}>
                      <td>{d.name}</td><td>{d.offers}</td><td>{d.accepted}</td><td>{d.completed_trips}</td><td>GH₵{d.earnings}</td>
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
