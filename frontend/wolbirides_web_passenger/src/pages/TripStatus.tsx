import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, type Trip } from "../api/client";
import { useTripSocket } from "../hooks/useTripSocket";
import DriverCard from "../components/DriverCard";
import RideStepper from "../components/RideStepper";
import SearchingRadar from "../components/SearchingRadar";
import SOSButton from "../components/SOSButton";
import { useAuth } from "../auth/AuthContext";
import PaymentStep from "../components/PaymentStep";
import { realPhone, samePhone } from "../phone";
import RatingCard from "../components/RatingCard";
import SupportCard from "../components/SupportCard";
import { CheckInPrompt, PostTripCheckin, PreferenceDecision, ShareTripButton } from "../components/TripSafety";
import TripMap from "../components/TripMap";
import { TripStatusSkeleton } from "../components/Skeleton";
import { useToast } from "../components/Toast";
import "./TripStatus.css";

/** A delivery a person on our team is arranging: what the passenger should expect. */
function arrangingText(reason: Trip["queue_reason"]) {
  switch (reason) {
    case "driver_withdrew":
    case "reassigned":
      return "Your courier can't make it, so we're finding you another. We'll tell you as soon as they're assigned.";
    case "no_courier_accepted":
      return "No rider nearby was free, so our team is finding you a courier. We'll tell you as soon as one is assigned.";
    default:
      return "Our team checks errands and vendor orders, then hands them to a courier. We'll tell you as soon as one is assigned.";
  }
}

/** Plain-words version of why a search found nobody (recorded by the server at the time). */
function noDriversText(reason: Trip["no_drivers_reason"]) {
  switch (reason) {
    case "none_online": return "No riders are online near you right now.";
    case "all_busy": return "Every nearby rider is on another trip right now.";
    case "no_delivery_couriers": return "No riders are taking deliveries right now.";
    default: return "Nearby riders didn't respond in time.";
  }
}

const STATUS_COPY: Record<Trip["status"], { label: string }> = {
  requested: { label: "Requesting" },
  matching: { label: "Finding a rider" },
  awaiting_assignment: { label: "Being arranged" },
  matched: { label: "Rider assigned" },
  driver_arriving: { label: "Rider arriving" },
  in_progress: { label: "On the way" },
  completed: { label: "Trip complete" },
  cancelled: { label: "Trip cancelled" },
  no_drivers_found: { label: "No riders available" },
};

export default function TripStatus() {
  const { tripId } = useParams<{ tripId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const toast = useToast();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load() only reads tripId, which is listed
  }, [lastMessage]);

  // Fire a toast whenever the trip crosses into a new status — key moments
  // (matched, arriving, completed) deserve a nudge, not just a silent
  // re-render of the banner text.
  useEffect(() => {
    if (!trip || trip.status === lastStatus) return;
    if (lastStatus !== null) {
      if (trip.status === "matched") toast.show("A rider has accepted your ride!", "success");
      if (trip.status === "driver_arriving") toast.show("Your rider is nearby.", "info");
      if (trip.status === "in_progress") toast.show("Trip started — enjoy the ride.", "success");
      if (trip.status === "completed") toast.show("Trip complete. Thanks for riding with us!", "success");
      if (trip.status === "cancelled") toast.show("This trip was cancelled.", "error");
      if (trip.status === "no_drivers_found") toast.show("No riders were available nearby.", "error");
    }
    // eslint-disable-next-line react-hooks-js/set-state-in-effect -- resets loading/error state as the effect starts a fetch or subscription
    setLastStatus(trip.status);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- toast only when the status changes, not on every trip update
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
              </div>

              {trip.status === "in_progress" && <CheckInPrompt tripId={trip.id} refreshKey={lastMessage} />}
              {trip.status === "matching" && (
                <PreferenceDecision tripId={trip.id} status={trip.preference_status} onDecided={load} />
              )}

              {showRadar && <SearchingRadar />}
              {trip.status === "awaiting_assignment" && (
                <div className="empty-state"><p>{arrangingText(trip.queue_reason)}</p></div>
              )}

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
                  <p>{noDriversText(trip.no_drivers_reason)}</p>
                  <button className="btn btn-primary" onClick={() => navigate("/")}>
                    Try again
                  </button>
                </div>
              )}

              {trip.status === "completed" && !["organization", "voucher", "bundle"].includes(trip.payment_method ?? "") && (
                <PaymentStep tripId={trip.id} fare={trip.fare_final || trip.fare_quote?.total || ""}
                  preferredMethod={trip.payment_method === "momo" || trip.payment_method === "hubtel" ? trip.payment_method : undefined} />
              )}

              {trip.status === "completed" && <PostTripCheckin tripId={trip.id} />}

              {trip.status === "completed" && !ratingSubmitted && !trip.rated_by_me && (
                <RatingCard tripId={trip.id} driverName={trip.driver_detail?.name} onDone={() => setRatingSubmitted(true)} />
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
                {trip.shareable && (
                  <div className="delivery-box">
                    <strong>Shared ride</strong>
                    {trip.pool_info && trip.pool_info.passenger_count > 1 && (
                      <span>You're sharing with one other passenger going your way.</span>
                    )}
                  </div>
                )}
                {trip.delivery && (
                  <div className="delivery-box">
                    {trip.delivery.external_courier && (
                      <div><strong>Courier:</strong> {trip.delivery.external_courier.name}{" "}
                        <a href={`tel:${trip.delivery.external_courier.phone}`}>{trip.delivery.external_courier.phone}</a></div>
                    )}
                    {trip.delivery.sender_name && (
                      <div><strong>From:</strong> {trip.delivery.sender_name}{trip.delivery.sender_phone ? ` (${trip.delivery.sender_phone})` : ""}</div>
                    )}
                    {trip.delivery.recipient_name && (
                      <div><strong>To:</strong> {trip.delivery.recipient_name}{trip.delivery.recipient_phone ? ` (${trip.delivery.recipient_phone})` : ""}</div>
                    )}
                    {trip.delivery.delivery_subtype === "parcel" && (
                      <div><strong>Package:</strong> {trip.delivery.package_description} ({trip.delivery.package_size})</div>
                    )}
                    {trip.delivery.delivery_subtype === "errand" && (
                      <>
                        <div><strong>Task:</strong> {trip.delivery.task_description}</div>
                        {trip.delivery.spend_limit && <div><strong>Spending limit:</strong> GH₵{trip.delivery.spend_limit}</div>}
                      </>
                    )}
                    {trip.delivery.delivery_subtype === "vendor_order" && (
                      <>
                        {trip.delivery.vendor && (
                          <div><strong>Vendor:</strong> {trip.delivery.vendor.name}{trip.delivery.vendor.location_label ? ` — ${trip.delivery.vendor.location_label}` : ""}</div>
                        )}
                        <div><strong>Order:</strong> {trip.delivery.task_description}</div>
                        {trip.delivery.spend_limit && <div><strong>Spending limit:</strong> GH₵{trip.delivery.spend_limit}</div>}
                      </>
                    )}
                    {trip.delivery.pickup_code && !trip.delivery.picked_up_at && (
                      <div className="delivery-code">
                        Pickup code <strong>{trip.delivery.pickup_code}</strong>
                        <span>{trip.delivery.sender_phone && !samePhone(trip.delivery.sender_phone, realPhone(user))
                          ? `We've texted it to ${trip.delivery.sender_name}. The rider needs it to collect the item.`
                          : "Show the rider this code when they collect the item."}</span>
                      </div>
                    )}
                    {trip.delivery.dropoff_code && trip.status !== "completed" && (
                      <div className="delivery-code">
                        Drop-off code <strong>{trip.delivery.dropoff_code}</strong>
                        <span>{trip.delivery.recipient_phone && !samePhone(trip.delivery.recipient_phone, realPhone(user))
                          ? `We've texted it to ${trip.delivery.recipient_name}. The rider needs it to finish.`
                          : "Give the rider this code when you receive it."}</span>
                      </div>
                    )}
                  </div>
                )}
                {trip.fare_quote && Number(trip.fare_quote.discount ?? 0) > 0 && (
                  <div className="trip-fare-row trip-fare-sub">
                    <span>{trip.fare_quote.discount_reason || "Discount"}</span>
                    <span>−GH₵{trip.fare_quote.discount}</span>
                  </div>
                )}
                <div className="trip-fare-row trip-fare-sub">
                  <span>Paying with</span>
                  <span>
                    {trip.payment_method === "organization" ? trip.organization_name
                      : trip.payment_method === "voucher" ? `Voucher from ${trip.organization_name}`
                      : trip.payment_method === "bundle" ? "Ride bundle"
                      : trip.payment_method === "momo" ? "Mobile Money" : "Cash to rider"}
                  </span>
                </div>
                <div className="trip-fare-row">
                  <span>Fare</span>
                  <strong>
                    {trip.fare_final ? `GH₵${trip.fare_final}`
                      : trip.pool_seat_fare ? `GH₵${trip.pool_seat_fare} (shared)`
                      : trip.fare_quote ? `GH₵${trip.fare_quote.total} est.` : "—"}
                  </strong>
                </div>

                {trip.fare_quote && (
                  <button className="btn btn-ghost btn-block" style={{ marginTop: 12 }}
                    onClick={() => window.dispatchEvent(new CustomEvent("wolbirides:ask-assistant", { detail: {
                      tripId: trip.id, label: `${trip.pickup_label || "Pickup"} to ${trip.destination_label || "destination"}`,
                      message: "Can you explain how this trip's fare was worked out?" } }))}>
                    Ask about this fare
                  </button>
                )}
                {["completed", "cancelled", "no_drivers_found"].includes(trip.status) && (
                  <details className="trip-help">
                    <summary>Report a problem with this trip</summary>
                    <SupportCard tripId={trip.id} compact />
                  </details>
                )}

                {["requested", "matching", "awaiting_assignment", "matched", "driver_arriving"].includes(trip.status) && (
                  <button className="btn btn-danger-ghost btn-block" disabled={cancelling} onClick={cancelTrip} style={{ marginTop: 16 }}>
                    {cancelling ? "Cancelling…" : trip.trip_type === "delivery" ? "Cancel delivery" : "Cancel ride"}
                  </button>
                )}

                {["matching", "matched", "driver_arriving", "in_progress"].includes(trip.status) && (
                  <ShareTripButton tripId={trip.id} />
                )}
                {["matched", "driver_arriving", "in_progress"].includes(trip.status) && <SOSButton tripId={trip.id} />}
              </div>
            </aside>
          </div>
        )}
      </main>
    </div>
  );
}
