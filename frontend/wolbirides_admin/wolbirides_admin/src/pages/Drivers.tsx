import { useEffect, useMemo, useState } from "react";
import { api, type Driver } from "../api/client";
import { EmptyState, LoadingState, PageHeader, SortableTh, StatusBadge } from "../components/ui";
import { useSortableData } from "../hooks/useSortableData";

const STATUS_OPTIONS = ["", "pending", "verified", "suspended", "rejected"];

interface DriverRow extends Driver {
  nameKey: string;
}

export default function Drivers() {
  const [tab, setTab] = useState<"pending" | "all">("pending");
  const [drivers, setDrivers] = useState<Driver[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");

  function load() {
    setDrivers(null);
    const url = tab === "pending" ? "/admin/drivers/pending" : "/admin/drivers";
    const params = tab === "all" ? { status: statusFilter || undefined, search: search || undefined } : undefined;
    api
      .get<Driver[]>(url, { params })
      .then(({ data }) => setDrivers(data))
      .catch(() => setError("Couldn't load drivers."));
  }

  useEffect(load, [tab, statusFilter]);

  async function act(driverId: string, action: "verify" | "reject" | "suspend") {
    setActingOn(driverId);
    try {
      await api.patch(`/admin/drivers/${driverId}/verify`, { action });
      load();
    } catch {
      setError(`Couldn't ${action} that driver. Try again.`);
    } finally {
      setActingOn(null);
    }
  }

  const rows: DriverRow[] = useMemo(
    () => (drivers ?? []).map((d) => ({ ...d, nameKey: d.user?.name || d.user?.phone || "" })),
    [drivers]
  );
  const { sorted, sortKey, direction, requestSort } = useSortableData<DriverRow>(rows, "nameKey", "asc");

  return (
    <div>
      <PageHeader
        title="Drivers"
        subtitle={
          tab === "pending"
            ? "Founding drivers awaiting the WR-07.2 compliance check before they can go online."
            : "Every driver who has applied, regardless of status."
        }
      />

      <div className="btn-row" style={{ marginBottom: 16 }}>
        <button className={tab === "pending" ? "btn btn-primary" : "btn btn-ghost"} onClick={() => setTab("pending")}>
          Pending review
        </button>
        <button className={tab === "all" ? "btn btn-primary" : "btn btn-ghost"} onClick={() => setTab("all")}>
          All drivers
        </button>
      </div>

      {tab === "all" && (
        <form
          className="filter-row"
          onSubmit={(e) => {
            e.preventDefault();
            load();
          }}
        >
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>{s === "" ? "All statuses" : s}</option>
            ))}
          </select>
          <input
            type="text"
            placeholder="Search by name, phone, or licence"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button className="btn btn-primary" type="submit">Search</button>
        </form>
      )}

      {error && <EmptyState message={error} />}
      {!drivers && !error && <LoadingState />}

      {drivers && drivers.length === 0 && (
        <EmptyState message={tab === "pending" ? "No drivers waiting on review right now." : "No drivers match this filter."} />
      )}

      {drivers && drivers.length > 0 && (
        <div className="panel">
          <table className="data-table">
            <thead>
              <tr>
                <SortableTh<DriverRow> label="Driver" sortKey="nameKey" activeKey={sortKey} direction={direction} onSort={requestSort} />
                <th>Licence</th>
                <th>Vehicle</th>
                <SortableTh<DriverRow> label="Status" sortKey="verification_status" activeKey={sortKey} direction={direction} onSort={requestSort} />
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((driver) => (
                <tr key={driver.id}>
                  <td>
                    <div>{driver.user?.name || "Unnamed"}</div>
                    <div className="mono">{driver.user?.phone}</div>
                  </td>
                  <td>
                    <div className="mono">{driver.licence_number}</div>
                    {driver.licence_expiry && (
                      <div className="mono">expires {driver.licence_expiry}</div>
                    )}
                  </td>
                  <td>
                    {driver.vehicles.length > 0
                      ? driver.vehicles.map((v) => v.plate_number).join(", ")
                      : "No vehicle on file"}
                  </td>
                  <td>
                    <StatusBadge status={driver.verification_status} />
                  </td>
                  <td>
                    <div className="btn-row">
                      {driver.verification_status !== "verified" && (
                        <button
                          className="btn btn-success"
                          disabled={actingOn === driver.id}
                          onClick={() => act(driver.id, "verify")}
                        >
                          Verify
                        </button>
                      )}
                      {driver.verification_status === "pending" && (
                        <button
                          className="btn btn-ghost"
                          disabled={actingOn === driver.id}
                          onClick={() => act(driver.id, "reject")}
                        >
                          Reject
                        </button>
                      )}
                      {driver.verification_status === "verified" && (
                        <button
                          className="btn btn-danger"
                          disabled={actingOn === driver.id}
                          onClick={() => act(driver.id, "suspend")}
                        >
                          Suspend
                        </button>
                      )}
                    </div>
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
