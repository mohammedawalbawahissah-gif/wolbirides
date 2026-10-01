import { useState } from "react";
import { api } from "../api/client";
import { useToast } from "./Toast";
import "./RatingCard.css";

/** Star rating for one completed trip. Used both right after a trip finishes and
 * from the standalone "Rate Driver" screen for a trip rated later. */
export default function RatingCard({ tripId, driverName, onDone }: { tripId: string; driverName?: string; onDone: () => void }) {
  const toast = useToast();
  const [rating, setRating] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (rating == null) return;
    setBusy(true);
    try {
      await api.post(`/trips/${tripId}/rating`, { score: rating, issue_tags: [], comment: "" });
      onDone();
    } catch {
      toast.show("Couldn't submit your rating.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card rating-card">
      <div className="rating-title">{driverName ? `How was your ride with ${driverName}?` : "How was your ride?"}</div>
      <div className="rating-stars">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} className={"star" + (rating != null && n <= rating ? " star-filled" : "")}
            onClick={() => setRating(n)} aria-label={`${n} star${n > 1 ? "s" : ""}`}>★</button>
        ))}
      </div>
      <button className="btn btn-gold" disabled={rating == null || busy} onClick={submit}>
        {busy ? "Submitting…" : "Submit rating"}
      </button>
    </div>
  );
}
