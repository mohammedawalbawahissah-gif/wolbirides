import SOSButton from "../components/SOSButton";
import DriverPaymentPanel from "../components/DriverPaymentPanel";
import PostTripCheckin from "../components/PostTripCheckin";
import RatePassenger from "../components/RatePassenger";
import SupportCard from "../components/SupportCard";
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
  // WR-17: while a shared ride is still open, new passengers can join; refresh to show them.
  useEffect(() => {
    if (!trip?.pool_info?.open) return;
    const id = window.setInterval(load, 15000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip?.pool_info?.open, tripId]);
  useEffect(() => {
    if (lastMessage) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load() only reads tripId, which is listed
  }, [lastMessage]);

  useEffect(() => {
    if (trip && trip.status === "cancelled") {
      navigate("/", { replace: true });
    }
  }, [trip, navigate]);

  const [code, setCode] = useState("");
  const isDelivery = trip?.trip_type === "delivery";

  // Rides: start/complete. Deliveries (WR-23): confirm pickup with the sender's code,
  // confirm drop-off with the recipient's code. Neither code is ever sent to the driver's app.
  async function act(path: "start" | "complete" | "confirm-pickup" | "confirm-dropoff") {
    if (!tripId) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/trips/${tripId}/${path}`, path.startsWith("confirm") ? { code: code.trim() } : {});
      setCode("");
      load(); // after completion, stay: the payment panel says whether to collect cash
    } catch (err: any) {
      setError(err?.response?.data?.detail || "That didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function cancelTrip() {
    if (!tripId) return;
    setBusy(true);
    try {
      await api.post(`/trips/${tripId}/cancel`, { reason: "Rider cancelled" });
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
            <span className="brand-name">WolbiRides Rider</span>
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
              {trip.pool_info?.stops && trip.pool_info.stops.length > 2 && (
                <div className="card" style={{ marginBottom: 16, borderLeft: "4px solid var(--gold)" }}>
                  <h2 className="side-card-title">Shared ride: {trip.pool_info.passenger_count} passengers, in this order</h2>
                  <ol style={{ margin: 0, paddingLeft: 20 }}>
                    {trip.pool_info.stops.map((stop, idx) => (
                      <li key={`${stop.type}-${stop.trip_id}`} style={{ padding: "6px 0",
                        color: stop.done ? "var(--ink-muted)" : "inherit", textDecoration: stop.done ? "line-through" : "none" }}>
                        <Link to={`/active-trip/${stop.trip_id}`} style={{ color: "inherit",
                          fontWeight: stop.trip_id === trip.id && !stop.done ? 700 : 400 }}>
                          {stop.type === "pickup" ? "Pick up" : "Drop off"} {stop.first_name}
                        </Link>
                        <span style={{ display: "block", fontSize: 12.5, color: "var(--ink-muted)" }}>
                          {stop.label || (stop.type === "pickup" ? "Pickup point" : "Destination")}
                          {idx === 0 && !stop.done ? " · next" : ""}
                        </span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
              <div className="card">
                <h2 className="side-card-title">Trip details</h2>
                <div className="trip-route-row"><span className="trip-dot trip-dot-pickup" /> {trip.pickup_label || "Pickup"}</div>
                <div className="trip-route-row"><span className="trip-dot trip-dot-dest" /> {trip.destination_label || "Destination"}</div>
                {trip.delivery && (
                  <div style={{ margin: "12px 0", padding: 12, borderRadius: 8, background: "var(--warning-bg)", fontSize: 13.5 }}>
                    {trip.delivery.delivery_subtype === "parcel" && (
                      <div><strong>Package:</strong> {trip.delivery.package_description} ({trip.delivery.package_size})</div>
                    )}
                    {trip.delivery.delivery_subtype === "errand" && (
                      <div><strong>Errand:</strong> {trip.delivery.task_description}</div>
                    )}
                    {trip.delivery.delivery_subtype === "vendor_order" && (
                      <>
                        {trip.delivery.vendor && (
                          <div><strong>Vendor:</strong> {trip.delivery.vendor.name}
                            {trip.delivery.vendor.location_label ? `, ${trip.delivery.vendor.location_label}` : ""}</div>
                        )}
                        <div><strong>Order:</strong> {trip.delivery.task_description}</div>
                      </>
                    )}
                    {trip.delivery.spend_limit && <div><strong>Spend up to:</strong> GH₵{trip.delivery.spend_limit}</div>}
                    {trip.delivery.sender_name && (
                      <div><strong>Collect from:</strong> {trip.delivery.sender_name}{" "}
                        {trip.delivery.sender_phone && <a href={`tel:${trip.delivery.sender_phone}`}>{trip.delivery.sender_phone}</a>}</div>
                    )}
                    <div><strong>Deliver to:</strong> {trip.delivery.recipient_name}{" "}
                      <a href={`tel:${trip.delivery.recipient_phone}`}>{trip.delivery.recipient_phone}</a></div>
                  </div>
                )}
                <div className="trip-fare-row">
                  <span>Fare</span>
                  <strong>{trip.fare_final ? `GH₵${trip.fare_final}` : trip.pool_seat_fare ? `GH₵${trip.pool_seat_fare}`
                    : trip.fare_quote ? `GH₵${trip.fare_quote.total}` : "—"}</strong>
                </div>
                <div style={{ fontSize: 13, color: "var(--ink-muted)" }}>
                  {trip.payment_method === "cash" || !trip.payment_method
                    ? "Collect cash from the passenger"
                    : "Already paid. Don't collect cash; it's in your weekly payout."}
                </div>

                <div className="active-trip-actions">
                  {(trip.status === "matched" || trip.status === "driver_arriving") && !isDelivery && (
                    <button className="btn btn-gold btn-block" disabled={busy} onClick={() => act("start")}>
                      {busy ? "Starting…" : "Start trip (passenger on board)"}
                    </button>
                  )}
                  {(trip.status === "matched" || trip.status === "driver_arriving") && isDelivery && (
                    <>
                      <label className="field-label" htmlFor="pcode">Sender's 4-digit pickup code</label>
                      <input id="pcode" className="field-input" inputMode="numeric" maxLength={4} value={code}
                        onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
                      <button className="btn btn-gold btn-block" disabled={busy || code.length !== 4} onClick={() => act("confirm-pickup")}>
                        {busy ? "Confirming…" : "Confirm pickup"}
                      </button>
                    </>
                  )}
                  {trip.status === "in_progress" && isDelivery && (
                    <>
                      <label className="field-label" htmlFor="dcode">Recipient's 4-digit code</label>
                      <input id="dcode" className="field-input" inputMode="numeric" maxLength={4} value={code}
                        onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
                      <button className="btn btn-success btn-block" disabled={busy || code.length !== 4} onClick={() => act("confirm-dropoff")}>
                        {busy ? "Confirming…" : "Confirm drop-off"}
                      </button>
                    </>
                  )}
                  {trip.status === "in_progress" && !isDelivery && (
                    <button className="btn btn-success btn-block" disabled={busy} onClick={() => act("complete")}>
                      {busy ? "Completing…" : "Complete trip"}
                    </button>
                  )}

                  <button className="btn btn-danger-ghost btn-block" disabled={busy} onClick={cancelTrip}>
                    Cancel trip
                  </button>

                  {["matched", "driver_arriving", "in_progress"].includes(trip.status) && <SOSButton tripId={trip.id} />}
                {trip.status === "completed" && <RatePassenger tripId={trip.id} alreadyRated={trip.rated_by_me} />}
                {trip.status === "completed" && <PostTripCheckin tripId={trip.id} />}
                {trip.status === "completed" && (
                  <details style={{ marginTop: 12 }}>
                    <summary style={{ cursor: "pointer", color: "var(--ink-muted)", fontSize: 14 }}>Report a problem with this trip</summary>
                    <SupportCard tripId={trip.id} compact />
                  </details>
                )}
                {trip.status === "completed" && (
                  <DriverPaymentPanel tripId={trip.id} fare={trip.fare_final || trip.fare_quote?.total || ""}
                    paymentMethod={trip.payment_method} onDone={() => navigate("/", { replace: true })} />
                )}
                </div>
              </div>
            </aside>
          </div>
        )}
      </main>
    </div>
  );
}
