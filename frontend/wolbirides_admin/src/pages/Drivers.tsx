import { Fragment, useEffect, useMemo, useState } from "react";
import { api, type Driver } from "../api/client";
import { EmptyState, LoadingState, PageHeader, SortableTh, StatusBadge } from "../components/ui";
import { useSortableData } from "../hooks/useSortableData";
import "./Drivers.css";

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
  const [expanded, setExpanded] = useState<string | null>(null);

  function load() {
    // eslint-disable-next-line react-hooks-js/set-state-in-effect -- resets loading/error state as the effect starts a fetch or subscription
    setDrivers(null);
    const url = tab === "pending" ? "/admin/drivers/pending" : "/admin/drivers";
    const params = tab === "all" ? { status: statusFilter || undefined, search: search || undefined } : undefined;
    api
      .get<Driver[]>(url, { params })
      .then(({ data }) => setDrivers(data))
      .catch(() => setError("Couldn't load riders."));
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps -- search applies when the user submits, not on every keystroke
  useEffect(load, [tab, statusFilter]);

  async function act(driverId: string, action: "verify" | "reject" | "suspend") {
    setActingOn(driverId);
    try {
      await api.patch(`/admin/drivers/${driverId}/verify`, { action });
      load();
    } catch {
      setError(`Couldn't ${action} that rider. Try again.`);
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
        title="Riders"
      />

      <div className="btn-row" style={{ marginBottom: 16 }}>
        <button className={tab === "pending" ? "btn btn-primary" : "btn btn-ghost"} onClick={() => setTab("pending")}>
          Pending review
        </button>
        <button className={tab === "all" ? "btn btn-primary" : "btn btn-ghost"} onClick={() => setTab("all")}>
          All riders
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
        <EmptyState message={tab === "pending" ? "No riders waiting on review right now." : "No riders match this filter."} />
      )}

      {drivers && drivers.length > 0 && (
        <div className="panel">
          <table className="data-table">
            <thead>
              <tr>
                <th aria-hidden="true"></th>
                <SortableTh<DriverRow> label="Rider" sortKey="nameKey" activeKey={sortKey} direction={direction} onSort={requestSort} />
                <th>Licence</th>
                <th>Vehicle</th>
                <SortableTh<DriverRow> label="Status" sortKey="verification_status" activeKey={sortKey} direction={direction} onSort={requestSort} />
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((driver) => (
                <Fragment key={driver.id}>
                <tr className="driver-row" onClick={() => setExpanded(expanded === driver.id ? null : driver.id)}>
                  <td className="driver-expand-cell">
                    <span className={"driver-expand-chevron" + (expanded === driver.id ? " driver-expand-chevron-open" : "")} aria-hidden="true">›</span>
                  </td>
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
                  <td onClick={(e) => e.stopPropagation()}>
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
                {expanded === driver.id && <ApplicationDetailRow driver={driver} />}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Doc({ label, url }: { label: string; url?: string }) {
  if (!url) return <div className="driver-doc driver-doc-missing"><span>{label}</span><span>Not uploaded</span></div>;
  const isImage = /\.(png|jpe?g|webp|gif)(\?|$)/i.test(url);
  return (
    <a className="driver-doc" href={url} target="_blank" rel="noopener noreferrer">
      {isImage ? <img src={url} alt={label} className="driver-doc-thumb" /> : <div className="driver-doc-thumb driver-doc-file">File</div>}
      <span>{label}</span>
    </a>
  );
}

/** Everything ops needs to actually look at before approving — not just the text fields the
 * collapsed row shows, but the real documents, so nobody verifies a rider blind. */
function ApplicationDetailRow({ driver }: { driver: Driver }) {
  const vehicle = driver.vehicles[0];
  return (
    <tr className="driver-detail-row">
      <td colSpan={6}>
        <div className="driver-detail">
          <div className="driver-detail-docs">
            <Doc label="Licence photo" url={driver.licence_document} />
            <Doc label="Vehicle photo" url={vehicle?.photo} />
            <Doc label="Vehicle registration" url={vehicle?.registration_document} />
          </div>
          <div className="driver-detail-info">
            <div><span>Emergency contact</span><strong>{driver.emergency_contact_name || "—"}{driver.emergency_contact_phone ? ` · ${driver.emergency_contact_phone}` : ""}</strong></div>
            <div><span>Paid by</span><strong>{driver.payout_provider === "hubtel" ? "Hubtel" : "MTN MoMo"}{driver.payout_phone ? ` · ${driver.payout_phone}` : " · account phone"}</strong></div>
            <div><span>Vehicle type</span><strong>{vehicle?.vehicle_type?.replace("_", " ") || "—"}</strong></div>
          </div>
        </div>
      </td>
    </tr>
  );
}
