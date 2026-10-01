import { useState } from "react";
import { api } from "../api/client";

/** WR-18: drivers face harassment too. Same "did anything feel off?" check-in, separate from ratings. */
export default function PostTripCheckin({ tripId }: { tripId: string }) {
  const [state, setState] = useState<"ask" | "details" | "done">("ask");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);

  async function send(response: "fine" | "something_off") {
    setBusy(true);
    try {
      await api.post(`/trips/${tripId}/checkin`, { response, details: details.trim() });
      setState("done");
    } finally {
      setBusy(false);
    }
  }

  if (state === "done") return null;
  return (
    <div className="card" style={{ marginTop: 16, borderLeft: "4px solid var(--navy-ink)" }}>
      <h2 className="side-card-title">Safety check: did anything feel off?</h2>
      {state === "ask" ? (
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-ghost" disabled={busy} onClick={() => send("fine")}>No, all fine</button>
          <button className="btn btn-ghost" disabled={busy} onClick={() => setState("details")}>Something felt off</button>
        </div>
      ) : (
        <>
          <label className="field-label" htmlFor="drv-checkin">What happened? (optional)</label>
          <textarea id="drv-checkin" className="field-input" rows={3} maxLength={500} value={details}
            onChange={(e) => setDetails(e.target.value)} />
          <button className="btn btn-primary" disabled={busy} onClick={() => send("something_off")}>Send to safety team</button>
          <p style={{ fontSize: 12.5, color: "var(--ink-muted)" }}>
            If you're in danger now, use SOS or call 112.
          </p>
        </>
      )}
    </div>
  );
}
