import { useEffect, useState } from "react";
import { api, type Earnings as EarningsType } from "../api/client";

export default function Earnings() {
  const [earnings, setEarnings] = useState<EarningsType | null>(null);

  useEffect(() => {
    api.get<EarningsType>("/drivers/me/earnings").then(({ data }) => setEarnings(data));
  }, []);

  return (
    <div>
      <div className="page-heading">
        <h1>Earnings</h1>
        <p>Computed live from your completed trips.</p>
      </div>

      {!earnings && <div className="empty-state">Loading…</div>}

      {earnings && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16, marginBottom: 20 }}>
            <div className="card" style={{ padding: "28px 24px" }}>
              <div style={{ fontSize: 13, color: "var(--ink-muted)", marginBottom: 8 }}>Today</div>
              <div style={{ fontSize: 34, fontWeight: 700, color: "var(--navy-ink)" }}>GH₵{earnings.earnings_today}</div>
              <div style={{ fontSize: 13, color: "var(--ink-muted)", marginTop: 6 }}>
                {earnings.trips_completed_today} trip{earnings.trips_completed_today === 1 ? "" : "s"}
              </div>
            </div>

            <div className="card" style={{ padding: "28px 24px" }}>
              <div style={{ fontSize: 13, color: "var(--ink-muted)", marginBottom: 8 }}>All time</div>
              <div style={{ fontSize: 34, fontWeight: 700 }}>GH₵{earnings.earnings_total}</div>
              <div style={{ fontSize: 13, color: "var(--ink-muted)", marginTop: 6 }}>
                {earnings.trips_completed_total} trip{earnings.trips_completed_total === 1 ? "" : "s"} completed
              </div>
            </div>
          </div>

          <p style={{ fontSize: 12.5, color: "var(--ink-muted)", maxWidth: 560 }}>
            This is a live sum of your completed trip fares, not a payout ledger — WR-07.4's
            commission/subscription model isn't deducted here yet, so treat this as gross
            fare collected, not take-home pay.
          </p>
        </>
      )}
    </div>
  );
}
