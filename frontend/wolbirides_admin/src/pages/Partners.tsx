import { useEffect, useState } from "react";
import { api } from "../api/client";
import { EmptyState, LoadingState, PageHeader } from "../components/ui";

interface Row { partner_id: string; name: string; category: string; rides_to_partner: number; promo_redemptions: number; discount_given: string }

/** WR-24: what each partner venue is getting from WolbiRides. Partners and promo codes are managed in Django admin. */
export default function Partners() {
  const [days, setDays] = useState(30);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks-js/set-state-in-effect -- resets loading/error state as the effect starts a fetch or subscription
    setRows(null);
    api.get(`/admin/partners/report?days=${days}`).then(({ data }) => setRows(data.partners)).catch(() => setError("Couldn't load the partner report."));
  }, [days]);

  return (
    <div>
      <PageHeader title="Partners" />
      <div className="filter-row">
        <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
        </select>
      </div>
      {error && <EmptyState message={error} />}
      {!rows && !error && <LoadingState />}
      {rows && rows.length === 0 && <EmptyState message="No active partners yet." />}
      {rows && rows.length > 0 && (
        <div className="panel">
          <table className="data-table">
            <thead><tr><th>Partner</th><th>Category</th><th>Rides to partner</th><th>Promo uses</th><th>Discount given</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.partner_id}>
                  <td>{r.name}</td><td>{r.category}</td><td>{r.rides_to_partner}</td>
                  <td>{r.promo_redemptions}</td><td>GH₵{r.discount_given}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
