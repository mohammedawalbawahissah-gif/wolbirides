import { useEffect, useState } from "react";
import { api, type Payout } from "../api/client";
import { EmptyState, LoadingState, PageHeader, StatusBadge } from "../components/ui";

const STATUS_OPTIONS = ["pending", "approved", "paid", "failed", ""];

function lastWeek() {
  const end = new Date();
  end.setDate(end.getDate() - ((end.getDay() + 6) % 7)); // this Monday
  const start = new Date(end);
  start.setDate(start.getDate() - 7);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { start: iso(start), end: iso(end) };
}

/** WR-14: review and approve weekly driver payouts (MoMo-paid trips only). */
export default function Payouts() {
  const [payouts, setPayouts] = useState<Payout[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("pending");
  const [actingOn, setActingOn] = useState<string | null>(null);
  const [period, setPeriod] = useState(lastWeek());
  const [generating, setGenerating] = useState(false);

  function load() {
    // eslint-disable-next-line react-hooks-js/set-state-in-effect -- resets loading/error state as the effect starts a fetch or subscription
    setError(null);
    api
      .get<Payout[]>("/admin/payouts/batches", { params: statusFilter ? { status: statusFilter } : {} })
      .then(({ data }) => setPayouts(data))
      .catch(() => setError("Couldn't load payouts."));
  }

  useEffect(load, [statusFilter]);

  async function approve(p: Payout) {
    if (!window.confirm(`Approve GH₵${p.amount} to ${p.driver_name || p.driver_phone}? This sends real money.`)) return;
    setActingOn(p.id);
    try {
      await api.post(`/admin/payouts/batches/${p.id}/approve`);
      load();
    } catch (err: any) {
      setError(err?.response?.data?.detail || "Couldn't approve that payout.");
    } finally {
      setActingOn(null);
    }
  }

  async function generate() {
    setGenerating(true);
    setError(null);
    try {
      await api.post("/admin/payouts/batches/generate", { period_start: period.start, period_end: period.end });
      setStatusFilter("pending");
      load();
    } catch (err: any) {
      setError(err?.response?.data?.detail || "Couldn't generate payouts for that period.");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Payouts"
      />

      <div className="filter-row">
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>{s === "" ? "All statuses" : s[0].toUpperCase() + s.slice(1)}</option>
          ))}
        </select>
        <label>
          From <input type="date" value={period.start} onChange={(e) => setPeriod({ ...period, start: e.target.value })} />
        </label>
        <label>
          To <input type="date" value={period.end} onChange={(e) => setPeriod({ ...period, end: e.target.value })} />
        </label>
        <button className="btn btn-ghost" disabled={generating} onClick={generate}>
          {generating ? "Generating…" : "Generate for period"}
        </button>
      </div>

      {error && <EmptyState message={error} />}
      {!payouts && !error && <LoadingState />}
      {payouts && payouts.length === 0 && <EmptyState message="No payouts with this status." />}

      {payouts && payouts.length > 0 && (
        <div className="panel">
          <table className="data-table">
            <thead>
              <tr>
                <th>Rider</th>
                <th>Period</th>
                <th>Trips</th>
                <th>Amount</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {payouts.map((p) => (
                <tr key={p.id}>
                  <td>
                    {p.driver_name || "Unnamed rider"}
                    <div style={{ fontSize: 12, color: "var(--ink-muted)" }}>{p.driver_phone}</div>
                  </td>
                  <td>{p.period_start} to {p.period_end}</td>
                  <td>{p.line_items.length}</td>
                  <td><strong>GH₵{p.amount}</strong></td>
                  <td>
                    <StatusBadge status={p.status} />
                    {p.status === "failed" && p.failure_reason && (
                      <div style={{ fontSize: 12, color: "var(--danger)" }}>{p.failure_reason}</div>
                    )}
                  </td>
                  <td>
                    {p.status === "pending" && (
                      <button className="btn btn-success" disabled={actingOn === p.id} onClick={() => approve(p)}>
                        Approve
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
