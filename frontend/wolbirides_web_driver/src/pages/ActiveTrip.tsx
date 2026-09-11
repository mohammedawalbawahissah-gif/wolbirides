import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, type Trip } from "../api/client";
import { useTripSocket } from "../hooks/useTripSocket";
import "./ActiveTrip.css";
import "../components/AppLayout.css";

const STATUS_COPY: Record<string, string> = {
  matched: "Head to the pickup point",
  driver_arriving: "Arriving at pickup",
  in_progress: "Trip in progress",
};

export default function ActiveTrip() {
  const { tripId } = useParams<{ tripId: string }>();
  const navigate = useNavigate();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { lastMessage } = useTripSocket(tripId ?? null);

  function load() {
    if (!tripId) return;
    api.get<Trip>(`/trips/${tripId}`).then(({ data }) => setTrip(data));
  }

  useEffect(load, [tripId]);
  useEffect(() => {
    if (lastMessage) load();
  }, [lastMessage]);

  useEffect(() => {
    if (trip && (trip.status === "completed" || trip.status === "cancelled")) {
      navigate("/", { replace: true });
    }
  }, [trip, navigate]);

  async function startTrip() {
    if (!tripId) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/trips/${tripId}/start`);
      load();
    } catch {
      setError("Couldn't start the trip.");
    } finally {
      setBusy(false);
    }
  }

  async function completeTrip() {
    if (!tripId) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/trips/${tripId}/complete`);
      navigate("/", { replace: true });
    } catch {
      setError("Couldn't complete the trip.");
    } finally {
      setBusy(false);
    }
  }

  async function cancelTrip() {
    if (!tripId) return;
    setBusy(true);
    try {
      await api.post(`/trips/${tripId}/cancel`, { reason: "Driver cancelled" });
      navigate("/", { replace: true });
    } finally {
      setBusy(false);
    }
  }

  function openNavigation(lat: string, lng: string) {
    window.open(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`, "_blank");
  }

  return (
    <div className="app-layout">
      <header className="topbar">
        <div className="topbar-inner">
          <Link to="/" className="topbar-brand">
            <span className="brand-mark">WR</span>
            <span className="brand-name">WolbiRides Driver</span>
          </Link>
        </div>
      </header>

      <main className="app-main">
        {!trip && <div className="empty-state">Loading…</div>}

        {trip && (
          <div className="active-trip-layout">
            <div className="active-trip-primary">
              <div className="trip-status-banner">
                <div className="trip-status-label">{STATUS_COPY[trip.status] || trip.status}</div>
              </div>

              <button
                className="btn btn-primary"
                onClick={() =>
                  openNavigation(
                    trip.status === "in_progress" ? trip.destination_lat : trip.pickup_lat,
                    trip.status === "in_progress" ? trip.destination_lng : trip.pickup_lng
                  )
                }
              >
                Navigate with Google Maps
              </button>

              {error && <div className="auth-error" style={{ marginTop: 16 }}>{error}</div>}
            </div>

            <aside className="active-trip-side">
              <div className="card">
                <h2 className="side-card-title">Trip details</h2>
                <div className="trip-route-row"><span className="trip-dot trip-dot-pickup" /> {trip.pickup_label || "Pickup"}</div>
                <div className="trip-route-row"><span className="trip-dot trip-dot-dest" /> {trip.destination_label || "Destination"}</div>
                <div className="trip-fare-row">
                  <span>Fare</span>
                  <strong>{trip.fare_quote ? `GH₵${trip.fare_quote.total}` : "—"}</strong>
                </div>

                <div className="active-trip-actions">
                  {(trip.status === "matched" || trip.status === "driver_arriving") && (
                    <button className="btn btn-gold btn-block" disabled={busy} onClick={startTrip}>
                      {busy ? "Starting…" : "Start trip (arrived at pickup)"}
                    </button>
                  )}

                  {trip.status === "in_progress" && (
                    <button className="btn btn-success btn-block" disabled={busy} onClick={completeTrip}>
                      {busy ? "Completing…" : "Complete trip"}
                    </button>
                  )}

                  <button className="btn btn-danger-ghost btn-block" disabled={busy} onClick={cancelTrip}>
                    Cancel trip
                  </button>
                </div>
              </div>
            </aside>
          </div>
        )}
      </main>
    </div>
  );
}
