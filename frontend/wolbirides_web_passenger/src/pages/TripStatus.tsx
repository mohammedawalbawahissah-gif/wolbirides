import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, type Trip } from "../api/client";
import { useTripSocket } from "../hooks/useTripSocket";
import DriverCard from "../components/DriverCard";
import RideStepper from "../components/RideStepper";
import SearchingRadar from "../components/SearchingRadar";
import TripMap from "../components/TripMap";
import { TripStatusSkeleton } from "../components/Skeleton";
import { useToast } from "../components/Toast";
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
  const toast = useToast();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [rating, setRating] = useState<number | null>(null);
  const [ratingSubmitted, setRatingSubmitted] = useState(false);
  const [lastStatus, setLastStatus] = useState<Trip["status"] | null>(null);

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

  // Fire a toast whenever the trip crosses into a new status — key moments
  // (matched, arriving, completed) deserve a nudge, not just a silent
  // re-render of the banner text.
  useEffect(() => {
    if (!trip || trip.status === lastStatus) return;
    if (lastStatus !== null) {
      if (trip.status === "matched") toast.show("A driver has accepted your ride!", "success");
      if (trip.status === "driver_arriving") toast.show("Your driver is nearby.", "info");
      if (trip.status === "in_progress") toast.show("Trip started — enjoy the ride.", "success");
      if (trip.status === "completed") toast.show("Trip complete. Thanks for riding with us!", "success");
      if (trip.status === "cancelled") toast.show("This trip was cancelled.", "error");
      if (trip.status === "no_drivers_found") toast.show("No drivers were available nearby.", "error");
    }
    setLastStatus(trip.status);
  }, [trip?.status]);

  async function cancelTrip() {
    if (!tripId) return;
    setCancelling(true);
    try {
      await api.post(`/trips/${tripId}/cancel`, { reason: "Passenger cancelled" });
      load();
    } catch {
      toast.show("Couldn't cancel — try again.", "error");
    } finally {
      setCancelling(false);
    }
  }

  async function submitRating() {
    if (!tripId || rating == null) return;
    try {
      await api.post(`/trips/${tripId}/rating`, { score: rating, issue_tags: [], comment: "" });
      setRatingSubmitted(true);
      toast.show("Thanks for the feedback!", "success");
    } catch {
      toast.show("Couldn't submit your rating.", "error");
    }
  }

  const showRadar = trip && (trip.status === "requested" || trip.status === "matching");
  const showMap = trip && !["completed", "cancelled", "no_drivers_found"].includes(trip.status);

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
        {error && (
          <div className="error-state">
            <div className="error-state-icon">!</div>
            <div className="error-state-title">Something went wrong</div>
            <div className="error-state-detail">{error}</div>
            <button className="btn btn-primary" onClick={() => { setError(null); load(); }}>
              Try again
            </button>
          </div>
        )}

        {!trip && !error && <TripStatusSkeleton />}

        {trip && (
          <div className="trip-status-layout">
            <div className="trip-status-primary">
              <RideStepper status={trip.status} />

              <div className={`trip-status-banner trip-status-banner-${trip.status}`}>
                <div className="trip-status-label">{STATUS_COPY[trip.status].label}</div>
                <div className="trip-status-detail">{STATUS_COPY[trip.status].detail}</div>
              </div>

              {showRadar && <SearchingRadar />}

              {trip.driver_detail && (trip.status === "matched" || trip.status === "driver_arriving" || trip.status === "in_progress") && (
                <DriverCard
                  driver={trip.driver_detail}
                  eta={trip.status === "driver_arriving" ? "Arriving now" : trip.status === "in_progress" ? "On the way to destination" : "On the way to you"}
                />
              )}

              {showMap && (
                <div style={{ marginTop: 16 }}>
                  <TripMap
                    pickup={{ lat: Number(trip.pickup_lat), lng: Number(trip.pickup_lng) }}
                    destination={{ lat: Number(trip.destination_lat), lng: Number(trip.destination_lng) }}
                    driver={
                      trip.driver_detail?.current_lat && trip.driver_detail?.current_lng
                        ? { lat: Number(trip.driver_detail.current_lat), lng: Number(trip.driver_detail.current_lng) }
                        : null
                    }
                  />
                </div>
              )}

              {trip.status === "no_drivers_found" && (
                <div className="empty-state">
                  <p>{STATUS_COPY.no_drivers_found.detail}</p>
                  <button className="btn btn-primary" onClick={() => navigate("/")}>
                    Try again
                  </button>
                </div>
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
