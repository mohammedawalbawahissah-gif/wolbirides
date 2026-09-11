import { useEffect, useState } from "react";
import { api, type SupportTicket } from "../api/client";
import { EmptyState, LoadingState, PageHeader, StatusBadge } from "../components/ui";

function formatTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
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
                <th>Received</th>
                <th>Category</th>
                <th>Subject</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((ticket) => (
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
