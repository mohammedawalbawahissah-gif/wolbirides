import { useEffect, useState } from "react";
import { api } from "../api/client";
import { EmptyState, LoadingState, PageHeader, StatusBadge } from "../components/ui";

interface Bundle {
  id: string; plan_name: string; rides_total: number; rides_remaining: number; price_paid: string; status: string;
  payment_method: string; payment_reference: string; created_at: string; expires_at: string | null;
  owner: { name: string; phone: string; email: string | null };
}

/** WR-22: confirm bundle payments during the pilot. Plans are edited in Django admin. */
export default function Bundles() {
  const [status, setStatus] = useState("pending_payment");
  const [bundles, setBundles] = useState<Bundle[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    api.get<Bundle[]>("/admin/bundles", { params: status ? { status } : {} })
      .then(({ data }) => setBundles(data)).catch(() => setError("Couldn't load bundles."));
  }
  useEffect(load, [status]);

  async function activate(b: Bundle) {
    const reference = window.prompt(`Receipt or MoMo reference for GH₵${b.price_paid} from ${b.owner.name || b.owner.phone}:`);
    if (reference === null) return;
    try {
      await api.post(`/admin/bundles/${b.id}/activate`, { reference });
      load();
    } catch (err: any) {
      setError(err?.response?.data?.detail || "Couldn't activate that bundle.");
    }
  }

  return (
    <div>
      <PageHeader title="Ride bundles" />
      <div className="filter-row">
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="pending_payment">Awaiting payment</option>
          <option value="active">Active</option>
          <option value="exhausted">Used up</option>
          <option value="expired">Expired</option>
          <option value="">All</option>
        </select>
      </div>
      {error && <EmptyState message={error} />}
      {!bundles && !error && <LoadingState />}
      {bundles && bundles.length === 0 && <EmptyState message="Nothing here." />}
      {bundles && bundles.length > 0 && (
        <div className="panel">
          <table className="data-table">
            <thead><tr><th>Passenger</th><th>Plan</th><th>Price</th><th>Rides</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {bundles.map((b) => (
                <tr key={b.id}>
                  <td>{b.owner.name || "—"}<div style={{ fontSize: 12, color: "var(--ink-muted)" }}>{b.owner.phone}</div></td>
                  <td>{b.plan_name}</td>
                  <td>GH₵{b.price_paid}</td>
                  <td>{b.rides_remaining} / {b.rides_total}</td>
                  <td><StatusBadge status={b.status} />{b.payment_reference && <div style={{ fontSize: 12 }}>Ref {b.payment_reference}</div>}</td>
                  <td>{b.status === "pending_payment" && <button className="btn btn-success" onClick={() => activate(b)}>Confirm payment</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
