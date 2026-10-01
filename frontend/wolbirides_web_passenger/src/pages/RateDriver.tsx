import { useState } from "react";
import RatingCard from "../components/RatingCard";
import { useTripHistory } from "../hooks/useTripHistory";
import { useToast } from "../components/Toast";
import "./RateDriver.css";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Completed trips you haven't rated yet — for when the in-app prompt was missed. */
export default function RateDriver() {
  const toast = useToast();
  const { trips, hasMore, loadingMore, loadMore } = useTripHistory("/passengers/me/rides",
    () => toast.show("Couldn't load your rides.", "error"));
  const [rated, setRated] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);

  const pending = (trips ?? []).filter((t) => t.status === "completed" && !t.rated_by_me && !rated.has(t.id));

  return (
    <div>
      <div className="page-heading">
        <h1>Rate Rider</h1>
        <p>Completed trips you haven't rated yet.</p>
      </div>

      {trips == null && <p className="empty-state">Loading…</p>}
      {trips != null && pending.length === 0 && (
        <p className="empty-state">You're all caught up — no trips waiting for a rating.</p>
      )}

      <div className="rate-list">
        {pending.map((t) => (
          <div key={t.id} className="card rate-list-item">
            {open === t.id ? (
              <RatingCard tripId={t.id} driverName={t.driver_detail?.name}
                onDone={() => { setRated((s) => new Set(s).add(t.id)); setOpen(null); toast.show("Thanks for rating!", "success"); }} />
            ) : (
              <button className="rate-list-row" onClick={() => setOpen(t.id)}>
                <div>
                  <div className="rate-list-route">{t.pickup_label || "Pickup"} → {t.destination_label || "Destination"}</div>
                  <div className="rate-list-meta">
                    {formatDate(t.requested_at)}{t.driver_detail?.name ? ` · ${t.driver_detail.name}` : ""}
                  </div>
                </div>
                <span className="rate-list-cta">Rate ›</span>
              </button>
            )}
          </div>
        ))}
      </div>

      {hasMore && (
        <div style={{ textAlign: "center", marginTop: 16 }}>
          <button className="btn btn-ghost" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? "Loading…" : "Load older trips"}
          </button>
        </div>
      )}
    </div>
  );
}
