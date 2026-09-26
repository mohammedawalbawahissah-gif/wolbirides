import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api, type DraftTrip, type ServiceZone } from "../api/client";
import "./AssistantPanel.css";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  draft?: DraftTrip;
}

export default function AssistantPanel({ greeting }: { greeting: string }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [booking, setBooking] = useState(false);
  // WR-15: when opened from a trip, every message carries that trip so the
  // assistant explains its real fare breakdown rather than guessing.
  const [tripContext, setTripContext] = useState<{ id: string; label: string } | null>(null);

  useEffect(() => {
    function onAsk(e: Event) {
      const detail = (e as CustomEvent<{ tripId: string; label: string; message: string }>).detail;
      setOpen(true);
      setTripContext({ id: detail.tripId, label: detail.label });
      sendText(detail.message, detail.tripId);
    }
    window.addEventListener("wolbirides:ask-assistant", onAsk);
    return () => window.removeEventListener("wolbirides:ask-assistant", onAsk);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);
  const listRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  // WR-15: the assistant only *proposes* a ride. Booking goes through the
  // same POST /trips as the map, so fare and validation are identical.
  async function bookDraft(draft: DraftTrip) {
    setBooking(true);
    setError(null);
    try {
      const { data: zones } = await api.get<ServiceZone[]>("/zones");
      if (zones.length === 0) throw new Error("no zone");
      const { data } = await api.post("/trips", {
        zone_id: zones[0].id,
        pickup_lat: draft.pickup_lat.toFixed(6),
        pickup_lng: draft.pickup_lng.toFixed(6),
        pickup_label: draft.pickup_label,
        destination_lat: draft.destination_lat.toFixed(6),
        destination_lng: draft.destination_lng.toFixed(6),
        destination_label: draft.destination_label,
      });
      setOpen(false);
      navigate(`/trip/${data.id}`);
    } catch {
      setError("Couldn't book that ride. Try again, or book from the map.");
    } finally {
      setBooking(false);
    }
  }

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, open]);

  async function handleSend(e: FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    sendText(text, tripContext?.id);
  }

  async function sendText(text: string, tripId?: string) {
    setError(null);
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setBusy(true);
    try {
      const { data } = await api.post<{ reply: string; draft_trip?: DraftTrip }>("/assistant/chat", {
        message: text,
        history: messages.map(({ role, content }) => ({ role, content })),
        ...(tripId ? { trip_id: tripId } : {}),
      });
      setMessages((prev) => [...prev, { role: "assistant", content: data.reply, draft: data.draft_trip }]);
    } catch (err: any) {
      setError(err?.response?.data?.detail || "The assistant couldn't respond right now.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="assistant-root">
      {open && (
        <div className="assistant-panel">
          <div className="assistant-header">
            <span>WolbiRides Assistant</span>
            <button className="assistant-close" onClick={() => setOpen(false)} aria-label="Close assistant">
              ✕
            </button>
          </div>

          {tripContext && (
            <div className="assistant-context">
              About your trip: {tripContext.label}
              <button onClick={() => setTripContext(null)} aria-label="Stop asking about this trip">✕</button>
            </div>
          )}
          <div className="assistant-messages" ref={listRef}>
            {messages.length === 0 && <div className="assistant-greeting">{greeting}</div>}
            {messages.map((m, i) => (
              <div key={i}>
                {m.content && <div className={`assistant-bubble assistant-bubble-${m.role}`}>{m.content}</div>}
                {m.draft && (
                  <div className="assistant-draft">
                    <div className="assistant-draft-route">
                      <span className="trip-dot trip-dot-pickup" /> {m.draft.pickup_label}
                    </div>
                    <div className="assistant-draft-route">
                      <span className="trip-dot trip-dot-dest" /> {m.draft.destination_label}
                    </div>
                    <button className="btn btn-gold btn-block" disabled={booking} onClick={() => bookDraft(m.draft!)}>
                      {booking ? "Booking…" : "Book this ride"}
                    </button>
                  </div>
                )}
              </div>
            ))}
            {busy && <div className="assistant-bubble assistant-bubble-assistant assistant-typing">···</div>}
          </div>

          {error && <div className="assistant-error">{error}</div>}

          <form className="assistant-input-row" onSubmit={handleSend}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask a question…"
              disabled={busy}
            />
            <button type="submit" disabled={busy || !input.trim()} aria-label="Send">
              ➤
            </button>
          </form>
        </div>
      )}

      <button
        className="assistant-fab"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Close assistant" : "Open assistant"}
      >
        {open ? "✕" : "💬"}
      </button>
    </div>
  );
}
