import { useEffect, useState } from "react";
import { api, type Incident } from "../api/client";
import { EmptyState, LoadingState, PageHeader, StatusBadge } from "../components/ui";

const SEVERITY_OPTIONS = ["", "p0", "p1", "p2", "p3"];

function formatTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

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

  return (
    <div>
      <PageHeader
        title="Incidents"
        subtitle="Severity levels follow WR-06.3 — P0/P1 automatically suspend the involved driver pending review."
      />

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
                <th>Reported</th>
                <th>Severity</th>
                <th>Description</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {incidents.map((incident) => (
                <tr key={incident.id}>
                  <td>{formatTime(incident.created_at)}</td>
                  <td><StatusBadge status={incident.severity} /></td>
                  <td>{incident.description}</td>
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
