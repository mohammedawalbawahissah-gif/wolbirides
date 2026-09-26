import { useEffect, useMemo, useState } from "react";
import { api, type Incident } from "../api/client";
import { EmptyState, LoadingState, PageHeader, SortableTh, StatusBadge } from "../components/ui";
import { useSortableData } from "../hooks/useSortableData";
import SOSMap from "../components/SOSMap";

const SEVERITY_OPTIONS = ["", "p0", "p1", "p2", "p3"];

function formatTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

interface IncidentRow extends Incident {
  createdTs: number;
}

const SOURCE_LABEL: Record<string, string> = {
  post_trip_checkin: "Post-trip check-in",
  overdue_checkin: "Unanswered in-trip check-in",
  manual_report: "Reported",
};

export default function Incidents() {
  const [incidents, setIncidents] = useState<Incident[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [severityFilter, setSeverityFilter] = useState("");
  const [actingOn, setActingOn] = useState<string | null>(null);

  function load() {
    const params: Record<string, string> = {};
    if (severityFilter) params.severity = severityFilter;
    api
      .get<Incident[]>("/admin/incidents", { params })
      .then(({ data }) => setIncidents(data))
      .catch(() => setError("Couldn't load incidents."));
  }

  useEffect(load, [severityFilter]);

  // SOS alerts can't wait for someone to hit refresh.
  useEffect(() => {
    const id = window.setInterval(load, 15000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load() only reads severityFilter, which is listed
  }, [severityFilter]);

  const openSOS = (incidents ?? []).filter((i) => i.is_sos && i.status !== "resolved");

  async function resolve(id: string) {
    setActingOn(id);
    try {
      await api.patch(`/incidents/${id}`, { status: "resolved" });
      load();
    } catch {
      setError("Couldn't resolve that incident. Try again.");
    } finally {
      setActingOn(null);
    }
  }

  const rows: IncidentRow[] = useMemo(
    () => (incidents ?? []).map((i) => ({ ...i, createdTs: new Date(i.created_at).getTime() })),
    [incidents]
  );
  const { sorted, sortKey, direction, requestSort } = useSortableData<IncidentRow>(rows, "createdTs", "desc");

  return (
    <div>
      <PageHeader
        title="Incidents"
        subtitle="Severity levels follow WR-06.3 — P0/P1 automatically suspend the involved driver pending review."
      />

      {openSOS.length > 0 && (
        <div className="sos-alert-banner" role="alert">
          <strong>{openSOS.length} open SOS alert{openSOS.length === 1 ? "" : "s"}.</strong> Call the rider or driver now,
          and escalate to 112 if you can't reach them.
        </div>
      )}

      <SOSMap incidents={openSOS} />

      <div className="filter-row">
        <select value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value)}>
          {SEVERITY_OPTIONS.map((s) => (
            <option key={s} value={s}>{s === "" ? "All severities" : s.toUpperCase()}</option>
          ))}
        </select>
      </div>

      {error && <EmptyState message={error} />}
      {!incidents && !error && <LoadingState />}
      {incidents && incidents.length === 0 && <EmptyState message="No incidents match this filter." />}

      {incidents && incidents.length > 0 && (
        <div className="panel">
          <table className="data-table">
            <thead>
              <tr>
                <SortableTh<IncidentRow> label="Reported" sortKey="createdTs" activeKey={sortKey} direction={direction} onSort={requestSort} />
                <SortableTh<IncidentRow> label="Severity" sortKey="severity" activeKey={sortKey} direction={direction} onSort={requestSort} />
                <th>Description</th>
                <SortableTh<IncidentRow> label="Status" sortKey="status" activeKey={sortKey} direction={direction} onSort={requestSort} />
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((incident) => (
                <tr key={incident.id} className={incident.is_sos && incident.status !== "resolved" ? "sos-row" : undefined}>
                  <td>{formatTime(incident.created_at)}</td>
                  <td>
                    <StatusBadge status={incident.severity} />
                    {incident.is_sos && <span className="badge badge-danger" style={{ marginLeft: 6 }}>SOS</span>}
                    {incident.trigger_source && incident.trigger_source !== "sos_button" && (
                      <div style={{ fontSize: 11.5, color: "var(--ink-muted)", marginTop: 4 }}>
                        {SOURCE_LABEL[incident.trigger_source] ?? incident.trigger_source}
                      </div>
                    )}
                  </td>
                  <td>
                    {incident.description}
                    {incident.location_lat && incident.location_lng && (
                      <>
                        {" "}
                        <a
                          href={`https://maps.google.com/?q=${incident.location_lat},${incident.location_lng}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open location
                        </a>
                      </>
                    )}
                  </td>
                  <td><StatusBadge status={incident.status} /></td>
                  <td>
                    {incident.status !== "resolved" && (
                      <button
                        className="btn btn-success"
                        disabled={actingOn === incident.id}
                        onClick={() => resolve(incident.id)}
                      >
                        Mark resolved
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
