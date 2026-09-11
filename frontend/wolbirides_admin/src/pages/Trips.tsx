import { useEffect, useState } from "react";
import { api, type Trip } from "../api/client";
import { EmptyState, LoadingState, PageHeader, StatusBadge } from "../components/ui";

const STATUS_OPTIONS = [
  "", "requested", "matching", "matched", "driver_arriving",
  "in_progress", "completed", "cancelled", "no_drivers_found",
];

function formatTime(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

export default function Trips() {
  const [trips, setTrips] = useState<Trip[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [phoneFilter, setPhoneFilter] = useState("");

  function load() {
    const params: Record<string, string> = {};
    if (statusFilter) params.status = statusFilter;
    if (phoneFilter) params.passenger_phone = phoneFilter;
    api
      .get<Trip[]>("/admin/trips", { params })
      .then(({ data }) => setTrips(data))
      .catch(() => setError("Couldn't load trips."));
  }

  useEffect(load, [statusFilter]);

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    load();
  }

  return (
    <div>
      <PageHeader title="Trips" subtitle="Search and reconciliation across every requested ride." />

      <form className="filter-row" onSubmit={handleSearchSubmit}>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s === "" ? "All statuses" : s.replace(/_/g, " ")}
            </option>
          ))}
        </select>
        <input
          type="text"
          placeholder="Search by passenger phone"
          value={phoneFilter}
          onChange={(e) => setPhoneFilter(e.target.value)}
        />
        <button className="btn btn-primary" type="submit">Search</button>
      </form>

      {error && <EmptyState message={error} />}
      {!trips && !error && <LoadingState />}
      {trips && trips.length === 0 && <EmptyState message="No trips match this filter." />}

      {trips && trips.length > 0 && (
        <div className="panel">
          <table className="data-table">
            <thead>
              <tr>
                <th>Requested</th>
                <th>Route</th>
                <th>Status</th>
                <th>Fare</th>
                <th>Trip ID</th>
              </tr>
            </thead>
            <tbody>
              {trips.map((trip) => (
                <tr key={trip.id}>
                  <td>{formatTime(trip.requested_at)}</td>
                  <td>
                    {trip.pickup_label || "Pickup"} → {trip.destination_label || "Destination"}
                  </td>
                  <td><StatusBadge status={trip.status} /></td>
                  <td>
                    {trip.fare_final
                      ? `GH₵${trip.fare_final}`
                      : trip.fare_quote
                      ? `GH₵${trip.fare_quote.total} (est.)`
                      : "—"}
                  </td>
                  <td className="mono">{trip.id.slice(0, 8)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
