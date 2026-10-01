import { useEffect, useMemo, useState } from "react";
import { api, type SupportTicket } from "../api/client";
import { EmptyState, LoadingState, PageHeader, SortableTh, StatusBadge } from "../components/ui";
import { useSortableData } from "../hooks/useSortableData";

function formatTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

interface TicketRow extends SupportTicket {
  createdTs: number;
}

export default function Support() {
  const [tickets, setTickets] = useState<SupportTicket[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  // Moving a ticket along also notifies the person who raised it (backend AdminSupportTicketUpdateView).
  async function setStatus(ticket: SupportTicket, status: SupportTicket["status"]) {
    setSavingId(ticket.id);
    try {
      const { data } = await api.patch<SupportTicket>(`/admin/support/tickets/${ticket.id}`, { status });
      setTickets((prev) => prev?.map((t) => (t.id === ticket.id ? data : t)) ?? prev);
    } catch {
      setError("Couldn't update that ticket. Try again.");
    } finally {
      setSavingId(null);
    }
  }

  useEffect(() => {
    api
      .get<SupportTicket[]>("/admin/support/tickets")
      .then(({ data }) => setTickets(data))
      .catch(() => setError("Couldn't load support tickets."));
  }, []);

  const rows: TicketRow[] = useMemo(
    () => (tickets ?? []).map((t) => ({ ...t, createdTs: new Date(t.created_at).getTime() })),
    [tickets]
  );
  const { sorted, sortKey, direction, requestSort } = useSortableData<TicketRow>(rows, "createdTs", "desc");

  return (
    <div>
      <PageHeader
        title="Support"
      />

      {error && <EmptyState message={error} />}
      {!tickets && !error && <LoadingState />}
      {tickets && tickets.length === 0 && <EmptyState message="No support tickets right now." />}

      {tickets && tickets.length > 0 && (
        <div className="panel">
          <table className="data-table">
            <thead>
              <tr>
                <SortableTh<TicketRow> label="Received" sortKey="createdTs" activeKey={sortKey} direction={direction} onSort={requestSort} />
                <SortableTh<TicketRow> label="Category" sortKey="category" activeKey={sortKey} direction={direction} onSort={requestSort} />
                <th>Subject</th>
                <SortableTh<TicketRow> label="Status" sortKey="status" activeKey={sortKey} direction={direction} onSort={requestSort} />
              </tr>
            </thead>
            <tbody>
              {sorted.map((ticket) => (
                <tr key={ticket.id}>
                  <td>{formatTime(ticket.created_at)}</td>
                  <td>{ticket.category.replace(/_/g, " ")}</td>
                  <td>
                    <strong>{ticket.subject}</strong>
                    {ticket.description && (
                      <div style={{ fontSize: 13, color: "var(--ink-muted)", whiteSpace: "pre-wrap", marginTop: 4 }}>
                        {ticket.description}
                      </div>
                    )}
                    {ticket.trip && (
                      <div style={{ fontSize: 12, marginTop: 4 }}>About trip <code>{ticket.trip.slice(0, 8)}</code></div>
                    )}
                  </td>
                  <td>
                    <StatusBadge status={ticket.status} />
                    <select aria-label={`Status of "${ticket.subject}"`} value={ticket.status} disabled={savingId === ticket.id}
                      onChange={(e) => setStatus(ticket, e.target.value as SupportTicket["status"])}
                      style={{ display: "block", marginTop: 6 }}>
                      <option value="open">Open</option>
                      <option value="in_progress">Being handled</option>
                      <option value="resolved">Resolved</option>
                    </select>
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
