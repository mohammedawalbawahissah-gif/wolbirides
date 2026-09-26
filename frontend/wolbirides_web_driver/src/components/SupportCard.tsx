import { useEffect, useState, type FormEvent } from "react";
import { api } from "../api/client";
import { useToast } from "./Toast";

interface Ticket { id: string; category: string; status: string; subject: string; created_at: string; trip: string | null }

const STATUS_LABEL: Record<string, string> = { open: "Open", in_progress: "Being handled", resolved: "Resolved" };

/**
 * PRD Section 7 / WR-15 escalation: a person can always reach a human.
 * With a tripId it's the "problem with this trip" form; without, it's the
 * Help & support card with the person's recent tickets.
 */
export default function SupportCard({ tripId, compact }: { tripId?: string; compact?: boolean }) {
  const toast = useToast();
  const [category, setCategory] = useState(tripId ? "trip_issue" : "other");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [sent, setSent] = useState(false);

  function load() {
    if (!compact) api.get<Ticket[]>("/support/tickets").then(({ data }) => setTickets(data)).catch(() => setTickets([]));
  }
  useEffect(load, [compact]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post("/support/tickets", { category, subject: subject.trim(), description: description.trim(),
        ...(tripId ? { trip: tripId } : {}) });
      setSubject(""); setDescription(""); setSent(true);
      toast.show("Sent. Our support team will get back to you.", "success");
      load();
    } catch {
      toast.show("Couldn't send that. Try again.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={compact ? "" : "card"} style={compact ? undefined : { maxWidth: 420, marginTop: 16 }}>
      {!compact && <h2 style={{ fontSize: 16, margin: "0 0 8px" }}>Help & support</h2>}
      {compact && sent ? (
        <p style={{ fontSize: 13.5, margin: 0 }}>Thanks. We've got your message and will follow up.</p>
      ) : (
        <form onSubmit={submit}>
          {!tripId && (
            <>
              <label className="field-label" htmlFor="sup-cat">What's it about?</label>
              <select id="sup-cat" className="field-input" value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="trip_issue">A trip</option>
                <option value="payment">Payment</option>
                <option value="account">My account</option>
                <option value="other">Something else</option>
              </select>
            </>
          )}
          <label className="field-label" htmlFor="sup-subj">Subject</label>
          <input id="sup-subj" className="field-input" required maxLength={200} value={subject}
            onChange={(e) => setSubject(e.target.value)} placeholder={tripId ? "e.g. I was charged the wrong fare" : ""} />
          <label className="field-label" htmlFor="sup-desc">Details</label>
          <textarea id="sup-desc" className="field-input" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
          <button className="btn btn-primary" type="submit" disabled={busy || !subject.trim()}>
            {busy ? "Sending…" : "Send to support"}
          </button>
        </form>
      )}
      {!compact && tickets && tickets.length > 0 && (
        <div style={{ marginTop: 16 }}>
          {tickets.slice(0, 5).map((t) => (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderTop: "1px solid var(--line)" }} key={t.id}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{t.subject}</div>
                <div style={{ fontSize: 12.5, color: "var(--ink-muted)" }}>{new Date(t.created_at).toLocaleDateString()}</div>
              </div>
              <span className={"badge " + (t.status === "resolved" ? "badge-success" : "badge-warning")}>
                {STATUS_LABEL[t.status] ?? t.status}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
