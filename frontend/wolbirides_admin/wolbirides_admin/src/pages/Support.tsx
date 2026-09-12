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
        subtitle="In-app tickets from passengers and drivers, per WR-06.5."
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
                  <td>{ticket.subject}</td>
                  <td><StatusBadge status={ticket.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
