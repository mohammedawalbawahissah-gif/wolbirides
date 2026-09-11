import { useEffect, useState } from "react";
import { api, type Trip } from "../api/client";

const STATUS_TONE: Record<string, string> = {
  completed: "badge-success",
  cancelled: "badge-danger",
};

function formatTime(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function Trips() {
  const [trips, setTrips] = useState<Trip[] | null>(null);

  useEffect(() => {
    api.get<Trip[]>("/drivers/me/trips").then(({ data }) => setTrips(data));
  }, []);

  return (
    <div>
      <div className="page-heading">
        <h1>Your trips</h1>
        <p>Every ride you've accepted.</p>
      </div>

      {trips == null && <div className="empty-state">Loading…</div>}
      {trips && trips.length === 0 && <div className="empty-state">No trips yet — accepted rides will show up here.</div>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 14 }}>
        {trips?.map((trip) => (
          <div key={trip.id} className="card">
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
              <span style={{ fontSize: 12.5, color: "var(--ink-muted)" }}>{formatTime(trip.requested_at)}</span>
              <span className={"badge " + (STATUS_TONE[trip.status] || "badge-neutral")}>
                {trip.status.replace(/_/g, " ")}
              </span>
            </div>
            <div style={{ fontSize: 14, marginBottom: 6 }}>
              {trip.pickup_label || "Pickup"} → {trip.destination_label || "Destination"}
            </div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>
              {trip.fare_final ? `GH₵${trip.fare_final}` : "—"}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
