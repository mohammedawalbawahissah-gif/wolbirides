import { useEffect, useMemo, useState, type FormEvent } from "react";
import { api, type Trip } from "../api/client";
import { EmptyState, LoadingState, PageHeader, SortableTh, StatusBadge } from "../components/ui";
import { useSortableData } from "../hooks/useSortableData";

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

interface TripRow extends Trip {
  routeLabel: string;
  fareValue: number;
  requestedTs: number;
}

export default function Trips() {
  const [trips, setTrips] = useState<Trip[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [phoneFilter, setPhoneFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  function load() {
    const params: Record<string, string> = {};
    if (statusFilter) params.status = statusFilter;
    if (phoneFilter) params.passenger_phone = phoneFilter;
    if (fromDate) params.from = fromDate;
    if (toDate) params.to = toDate;
    api
      .get<Trip[]>("/admin/trips", { params })
      .then(({ data }) => setTrips(data))
      .catch(() => setError("Couldn't load trips."));
  }

  useEffect(load, [statusFilter]);

  function handleSearchSubmit(e: FormEvent) {
    e.preventDefault();
    load();
  }

  function clearFilters() {
    setStatusFilter("");
    setPhoneFilter("");
    setFromDate("");
    setToDate("");
  }

  const hasFilters = Boolean(statusFilter || phoneFilter || fromDate || toDate);

  const rows: TripRow[] = useMemo(
    () =>
      (trips ?? []).map((trip) => ({
        ...trip,
        routeLabel: `${trip.pickup_label || "Pickup"} → ${trip.destination_label || "Destination"}`,
        fareValue: Number(trip.fare_final ?? trip.fare_quote?.total ?? 0),
        requestedTs: trip.requested_at ? new Date(trip.requested_at).getTime() : 0,
      })),
    [trips]
  );

  const { sorted, sortKey, direction, requestSort } = useSortableData<TripRow>(rows, "requestedTs", "desc");

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
        <input
          type="date"
          aria-label="From date"
          value={fromDate}
          onChange={(e) => setFromDate(e.target.value)}
        />
        <input
          type="date"
          aria-label="To date"
          value={toDate}
          onChange={(e) => setToDate(e.target.value)}
        />
        <button className="btn btn-primary" type="submit">Search</button>
        {hasFilters && (
          <button type="button" className="btn btn-ghost" onClick={clearFilters}>
            Clear filters
          </button>
        )}
      </form>

      {error && <EmptyState message={error} />}
      {!trips && !error && <LoadingState />}
      {trips && trips.length === 0 && <EmptyState message="No trips match this filter." />}

      {trips && trips.length > 0 && (
        <div className="panel">
          <table className="data-table">
            <thead>
              <tr>
                <SortableTh<TripRow> label="Requested" sortKey="requestedTs" activeKey={sortKey} direction={direction} onSort={requestSort} />
                <SortableTh<TripRow> label="Route" sortKey="routeLabel" activeKey={sortKey} direction={direction} onSort={requestSort} />
                <SortableTh<TripRow> label="Status" sortKey="status" activeKey={sortKey} direction={direction} onSort={requestSort} />
                <SortableTh<TripRow> label="Fare" sortKey="fareValue" activeKey={sortKey} direction={direction} onSort={requestSort} />
                <SortableTh<TripRow> label="Trip ID" sortKey="id" activeKey={sortKey} direction={direction} onSort={requestSort} />
              </tr>
            </thead>
            <tbody>
              {sorted.map((trip) => (
                <tr key={trip.id}>
                  <td>{formatTime(trip.requested_at)}</td>
                  <td>{trip.routeLabel}</td>
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
