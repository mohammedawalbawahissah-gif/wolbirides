import { useNavigate } from "react-router-dom";
import { useTripHistory } from "../hooks/useTripHistory";
import { SkeletonBlock } from "../components/Skeleton";
import { useToast } from "../components/Toast";
import "./History.css";

const STATUS_TONE: Record<string, string> = {
  completed: "badge-success",
  cancelled: "badge-danger",
  no_drivers_found: "badge-danger",
};

function formatTime(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function History() {
  const navigate = useNavigate();
  const toast = useToast();
  const { trips, hasMore, loadingMore, loadMore } = useTripHistory("/passengers/me/rides",
    () => toast.show("Couldn't load your rides. Try again.", "error"));

  return (
    <div>
      <div className="page-heading">
        <h1>Your rides</h1>
      </div>

      {trips == null && (
        <div className="history-grid">
          {[0, 1, 2].map((i) => (
            <div className="card history-card" key={i} style={{ cursor: "default" }}>
              <SkeletonBlock height={14} width="40%" />
              <div style={{ height: 10 }} />
              <SkeletonBlock height={16} width="80%" />
              <div style={{ height: 10 }} />
              <SkeletonBlock height={14} width="30%" />
            </div>
          ))}
        </div>
      )}

      {trips && trips.length === 0 && (
        <div className="empty-state history-empty">
          <div className="history-empty-icon">🛺</div>
          <p>No rides yet — your first trip will show up here.</p>
          <button className="btn btn-gold" onClick={() => navigate("/book", { state: { initialKind: "ride" } })}>Book a ride</button>
        </div>
      )}

      <div className="history-grid">
        {trips?.map((trip) => (
          <div key={trip.id} className="card history-card history-card-wrap">
            <button className="history-card-main" onClick={() => navigate(`/trip/${trip.id}`)}>
              <div className="history-card-top">
                <span className="history-date">{formatTime(trip.requested_at)}</span>
                <span className={"badge " + (STATUS_TONE[trip.status] || "badge-neutral")}>
                  {trip.status.replace(/_/g, " ")}
                </span>
              </div>
              <div className="history-route">
                {trip.pickup_label || "Pickup"} → {trip.destination_label || "Destination"}
              </div>
              <div className="history-fare">
                {trip.fare_final ? `GH₵${trip.fare_final}` : trip.fare_quote ? `GH₵${trip.fare_quote.total}` : "—"}
              </div>
            </button>
            {/* WR-13: one-tap re-request from any past trip. Pre-fills the route; the passenger still confirms. */}
            <button className="btn btn-ghost history-again"
              onClick={() => navigate("/book", { state: {
                initialKind: trip.trip_type === "delivery" ? "delivery" : "ride",
                rebook: {
                  pickup: { lat: Number(trip.pickup_lat), lng: Number(trip.pickup_lng), label: trip.pickup_label },
                  destination: { lat: Number(trip.destination_lat), lng: Number(trip.destination_lng), label: trip.destination_label },
                },
              } })}>
              {trip.trip_type === "delivery" ? "Send again" : "Ride again"}
            </button>
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
