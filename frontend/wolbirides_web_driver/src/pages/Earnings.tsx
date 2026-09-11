import { useEffect, useState } from "react";
import { api, type Earnings as EarningsType } from "../api/client";

export default function Earnings() {
  const [earnings, setEarnings] = useState<EarningsType | null>(null);

  useEffect(() => {
    api.get<EarningsType>("/drivers/me/earnings").then(({ data }) => setEarnings(data));
  }, []);

  return (
    <div className="screen">
      <h1 className="screen-title">Earnings</h1>
      <p className="screen-subtitle">Computed from your completed trips.</p>

      {!earnings && <div className="empty-state">Loading…</div>}

      {earnings && (
        <>
          <div className="card" style={{ marginBottom: 12, textAlign: "center", padding: "24px 16px" }}>
            <div style={{ fontSize: 13, color: "var(--ink-muted)", marginBottom: 6 }}>Today</div>
            <div style={{ fontSize: 32, fontWeight: 700, color: "var(--navy-ink)" }}>
              GH₵{earnings.earnings_today}
            </div>
            <div style={{ fontSize: 13, color: "var(--ink-muted)", marginTop: 4 }}>
              {earnings.trips_completed_today} trip{earnings.trips_completed_today === 1 ? "" : "s"}
            </div>
          </div>

          <div className="card" style={{ textAlign: "center", padding: "20px 16px" }}>
            <div style={{ fontSize: 13, color: "var(--ink-muted)", marginBottom: 6 }}>All time</div>
            <div style={{ fontSize: 24, fontWeight: 700 }}>GH₵{earnings.earnings_total}</div>
            <div style={{ fontSize: 13, color: "var(--ink-muted)", marginTop: 4 }}>
              {earnings.trips_completed_total} trip{earnings.trips_completed_total === 1 ? "" : "s"} completed
            </div>
          </div>

          <p style={{ fontSize: 12, color: "var(--ink-muted)", marginTop: 16 }}>
            This is a live sum of your completed trip fares, not a payout ledger — WR-07.4's
            commission/subscription model isn't deducted here yet, so treat this as gross
            fare collected, not take-home pay.
          </p>
        </>
      )}
    </div>
  );
}
