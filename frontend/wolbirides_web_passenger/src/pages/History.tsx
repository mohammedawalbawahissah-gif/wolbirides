import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type Trip } from "../api/client";

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
    <div className="screen">
      <h1 className="screen-title">Your rides</h1>
      <p className="screen-subtitle">Past trips and receipts.</p>

      {trips == null && <div className="empty-state">Loading…</div>}
      {trips && trips.length === 0 && <div className="empty-state">No rides yet — your first trip will show up here.</div>}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {trips?.map((trip) => (
          <button
            key={trip.id}
            className="card"
            style={{ textAlign: "left", cursor: "pointer", width: "100%", border: "1px solid var(--line)" }}
            onClick={() => navigate(`/trip/${trip.id}`)}
          >
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={{ fontSize: 13, color: "var(--ink-muted)" }}>{formatTime(trip.requested_at)}</span>
              <span className={"badge " + (STATUS_TONE[trip.status] || "badge-neutral")}>
                {trip.status.replace(/_/g, " ")}
              </span>
            </div>
            <div style={{ fontSize: 14, marginBottom: 4 }}>
              {trip.pickup_label || "Pickup"} → {trip.destination_label || "Destination"}
            </div>
            <div style={{ fontWeight: 700 }}>
              {trip.fare_final ? `GH₵${trip.fare_final}` : trip.fare_quote ? `GH₵${trip.fare_quote.total}` : "—"}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
