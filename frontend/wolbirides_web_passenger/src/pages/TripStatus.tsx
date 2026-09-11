import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, type Trip } from "../api/client";
import { useTripSocket } from "../hooks/useTripSocket";
import "./TripStatus.css";

const STATUS_COPY: Record<Trip["status"], { label: string; detail: string }> = {
  requested: { label: "Requesting", detail: "Setting up your fare and confirming the zone." },
  matching: { label: "Finding a driver", detail: "Offering your ride to the nearest available driver." },
  matched: { label: "Driver assigned", detail: "Your driver has accepted and is heading your way." },
  driver_arriving: { label: "Driver arriving", detail: "Your driver is close by." },
  in_progress: { label: "On the way", detail: "Trip in progress — sit back, you're on your way." },
  completed: { label: "Trip complete", detail: "Thanks for riding with WolbiRides." },
  cancelled: { label: "Trip cancelled", detail: "This trip was cancelled." },
  no_drivers_found: { label: "No drivers available", detail: "No founding drivers were online in this zone just now." },
};

export default function TripStatus() {
  const { tripId } = useParams<{ tripId: string }>();
  const navigate = useNavigate();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [rating, setRating] = useState<number | null>(null);
  const [ratingSubmitted, setRatingSubmitted] = useState(false);

  const { lastMessage } = useTripSocket(tripId ?? null);

  function load() {
    if (!tripId) return;
    api
      .get<Trip>(`/trips/${tripId}`)
      .then(({ data }) => setTrip(data))
      .catch(() => setError("Couldn't load this trip."));
  }

  useEffect(load, [tripId]);
  useEffect(() => {
    if (lastMessage) load();
  }, [lastMessage]);

  async function cancelTrip() {
    if (!tripId) return;
    setCancelling(true);
    try {
      await api.post(`/trips/${tripId}/cancel`, { reason: "Passenger cancelled" });
      load();
    } catch {
      setError("Couldn't cancel — try again.");
    } finally {
      setCancelling(false);
    }
  }

  async function submitRating() {
    if (!tripId || rating == null) return;
    try {
      await api.post(`/trips/${tripId}/rating`, { score: rating, issue_tags: [], comment: "" });
      setRatingSubmitted(true);
    } catch {
      setError("Couldn't submit your rating.");
    }
  }

  return (
    <div className="app-layout">
      <header className="topbar">
        <div className="topbar-inner">
          <Link to="/" className="topbar-brand">
            <span className="brand-mark">WR</span>
            <span className="brand-name">WolbiRides</span>
          </Link>
        </div>
      </header>

      <main className="app-main trip-status-main">
        {error && <div className="empty-state">{error}</div>}
        {!trip && !error && <div className="empty-state">Loading…</div>}

        {trip && (
          <div className="trip-status-layout">
            <div className="trip-status-primary">
              <div className="trip-status-banner">
                <div className="trip-status-label">{STATUS_COPY[trip.status].label}</div>
                <div className="trip-status-detail">{STATUS_COPY[trip.status].detail}</div>
              </div>

              {trip.status === "no_drivers_found" && (
                <button className="btn btn-primary" onClick={() => navigate("/")}>
                  Try again
                </button>
              )}

              {trip.status === "completed" && !ratingSubmitted && (
                <div className="card rating-card">
                  <div className="rating-title">How was your ride?</div>
                  <div className="rating-stars">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button
                        key={n}
                        className={"star" + (rating != null && n <= rating ? " star-filled" : "")}
                        onClick={() => setRating(n)}
                        aria-label={`${n} star${n > 1 ? "s" : ""}`}
                      >
                        ★
                      </button>
                    ))}
                  </div>
                  <button className="btn btn-gold" disabled={rating == null} onClick={submitRating}>
                    Submit rating
                  </button>
                </div>
              )}

              {((trip.status === "completed" && ratingSubmitted) || trip.status === "cancelled") && (
                <button className="btn btn-primary" onClick={() => navigate("/")}>
                  Book another ride
                </button>
              )}
            </div>

            <aside className="trip-status-side">
              <div className="card">
                <h2 className="side-card-title">Trip details</h2>
                <div className="trip-route-row"><span className="trip-dot trip-dot-pickup" /> {trip.pickup_label || "Pickup"}</div>
                <div className="trip-route-row"><span className="trip-dot trip-dot-dest" /> {trip.destination_label || "Destination"}</div>
                <div className="trip-fare-row">
                  <span>Fare</span>
                  <strong>
                    {trip.fare_final ? `GH₵${trip.fare_final}` : trip.fare_quote ? `GH₵${trip.fare_quote.total} est.` : "—"}
                  </strong>
                </div>

                {["requested", "matching", "matched", "driver_arriving"].includes(trip.status) && (
                  <button className="btn btn-danger-ghost btn-block" disabled={cancelling} onClick={cancelTrip} style={{ marginTop: 16 }}>
                    {cancelling ? "Cancelling…" : "Cancel ride"}
                  </button>
                )}
              </div>
            </aside>
          </div>
        )}
      </main>
    </div>
  );
}
