import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type Trip } from "../api/client";
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
  const [trips, setTrips] = useState<Trip[] | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    api.get<Trip[]>("/passengers/me/rides").then(({ data }) => setTrips(data));
  }, []);

  return (
    <div>
      <div className="page-heading">
        <h1>Your rides</h1>
        <p>Past trips and receipts.</p>
      </div>

      {trips == null && <div className="empty-state">Loading…</div>}
      {trips && trips.length === 0 && <div className="empty-state">No rides yet — your first trip will show up here.</div>}

      <div className="history-grid">
        {trips?.map((trip) => (
          <button key={trip.id} className="card history-card" onClick={() => navigate(`/trip/${trip.id}`)}>
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
        ))}
      </div>
    </div>
  );
}
