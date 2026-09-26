import { useEffect, useState } from "react";
import { api, type Earnings as EarningsType, type Payout } from "../api/client";

export default function Earnings() {
  const [earnings, setEarnings] = useState<EarningsType | null>(null);

  const [payouts, setPayouts] = useState<Payout[] | null>(null);
  const [openPayout, setOpenPayout] = useState<string | null>(null);

  useEffect(() => {
    api.get<EarningsType>("/drivers/me/earnings").then(({ data }) => setEarnings(data));
    api.get<Payout[]>("/drivers/me/payouts").then(({ data }) => setPayouts(data)).catch(() => setPayouts([]));
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

      <h2 style={{ fontSize: 18, margin: "32px 0 6px" }}>Weekly payouts</h2>
      <p style={{ fontSize: 13, color: "var(--ink-muted)", marginTop: 0, maxWidth: 560 }}>
        MoMo-paid trips are paid out weekly after review. Cash trips aren't included, since you collected that fare
        directly.
      </p>
      {payouts == null && <div className="empty-state">Loading…</div>}
      {payouts?.length === 0 && (
        <div className="empty-state">No payouts yet. Your first one appears after a week with MoMo-paid trips.</div>
      )}
      {payouts?.map((p) => (
        <div className="card" key={p.id} style={{ marginBottom: 10, padding: "14px 18px" }}>
          <button
            onClick={() => setOpenPayout(openPayout === p.id ? null : p.id)}
            aria-expanded={openPayout === p.id}
            style={{ all: "unset", cursor: "pointer", display: "flex", width: "100%", justifyContent: "space-between", alignItems: "center", gap: 12 }}
          >
            <span>
              <strong>{formatPeriod(p.period_start, p.period_end)}</strong>
              <span style={{ display: "block", fontSize: 12.5, color: "var(--ink-muted)" }}>
                {p.line_items.length} trip{p.line_items.length === 1 ? "" : "s"}
                {p.commission_rate_snapshot != null && ` · ${Number(p.commission_rate_snapshot) * 100}% commission`}
              </span>
            </span>
            <span style={{ textAlign: "right" }}>
              <strong style={{ fontSize: 18 }}>GH₵{p.amount}</strong>
              <span className={"badge " + PAYOUT_BADGE[p.status]} style={{ display: "block", marginTop: 4 }}>
                {PAYOUT_LABEL[p.status]}
              </span>
            </span>
          </button>
          {p.status === "failed" && p.failure_reason && (
            <p style={{ color: "var(--danger)", fontSize: 13, margin: "8px 0 0" }}>{p.failure_reason}</p>
          )}
          {openPayout === p.id && (
            <table style={{ width: "100%", marginTop: 12, fontSize: 13, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ color: "var(--ink-muted)", textAlign: "left" }}>
                  <th style={{ fontWeight: 500, padding: "4px 0" }}>Trip</th>
                  <th style={{ fontWeight: 500, textAlign: "right" }}>Fare</th>
                  <th style={{ fontWeight: 500, textAlign: "right" }}>Commission</th>
                  <th style={{ fontWeight: 500, textAlign: "right" }}>You get</th>
                </tr>
              </thead>
              <tbody>
                {p.line_items.map((li) => (
                  <tr key={li.trip_id} style={{ borderTop: "1px solid var(--line)" }}>
                    <td style={{ padding: "6px 0" }}>{li.completed_at ? new Date(li.completed_at).toLocaleDateString() : li.trip_id.slice(0, 8)}</td>
                    <td style={{ textAlign: "right" }}>GH₵{li.fare}</td>
                    <td style={{ textAlign: "right" }}>GH₵{li.commission}</td>
                    <td style={{ textAlign: "right", fontWeight: 600 }}>GH₵{li.net}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ))}
    </div>
  );
}

const PAYOUT_LABEL: Record<Payout["status"], string> = {
  pending: "Under review",
  approved: "Approved",
  paid: "Paid",
  failed: "Failed",
};
const PAYOUT_BADGE: Record<Payout["status"], string> = {
  pending: "badge-warning",
  approved: "badge-warning",
  paid: "badge-success",
  failed: "badge-danger",
};

function formatPeriod(start: string, end: string) {
  const opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };
  return `${new Date(start).toLocaleDateString(undefined, opts)} – ${new Date(end).toLocaleDateString(undefined, opts)}`;
}
