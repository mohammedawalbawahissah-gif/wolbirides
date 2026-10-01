import { useState } from "react";
import { api } from "../api/client";

/** Drivers rate passengers too (the backend has always supported both directions). */
export default function RatePassenger({ tripId, alreadyRated }: { tripId: string; alreadyRated?: boolean }) {
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(!!alreadyRated);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      await api.post(`/trips/${tripId}/rating`, { score, issue_tags: [], comment: "" });
      setDone(true);
    } catch (err: any) {
      if (err?.response?.status === 409) setDone(true);
    } finally {
      setBusy(false);
    }
  }

  if (done) return null;
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h2 className="side-card-title">How was this passenger?</h2>
      <div role="radiogroup" aria-label="Rating" style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} role="radio" aria-checked={score === n} aria-label={`${n} star${n > 1 ? "s" : ""}`}
            onClick={() => setScore(n)}
            style={{ fontSize: 26, background: "none", border: "none", cursor: "pointer",
              color: n <= score ? "var(--gold)" : "var(--line)" }}>★</button>
        ))}
      </div>
      <button className="btn btn-primary" disabled={!score || busy} onClick={submit}>Submit rating</button>
    </div>
  );
}
