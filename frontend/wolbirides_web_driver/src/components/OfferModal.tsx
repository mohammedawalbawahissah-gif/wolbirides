import { useEffect, useState } from "react";
import type { RideOffer } from "../api/client";
import "./OfferModal.css";

export default function OfferModal({
  offer,
  onAccept,
  onDecline,
}: {
  offer: RideOffer;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const [secondsLeft, setSecondsLeft] = useState(offer.timeout_seconds);

  // Mirrors the backend's DISPATCH_OFFER_TIMEOUT_SECONDS (trips/services.py)
  // — if the driver doesn't respond, the server-side Celery task cascades to
  // the next candidate on its own; this countdown just gives visual feedback
  // and calls onDecline locally so the modal doesn't hang open past expiry.
  useEffect(() => {
    setSecondsLeft(offer.timeout_seconds);
    const interval = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          clearInterval(interval);
          onDecline();
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offer.trip_id]);

  const pct = (secondsLeft / offer.timeout_seconds) * 100;

  return (
    <div className="offer-overlay">
      <div className="offer-card">
        <div className="offer-timer-track">
          <div className="offer-timer-fill" style={{ width: `${pct}%` }} />
        </div>

        <div className="offer-title">New ride request</div>
        <div className="offer-route">
          <div className="offer-route-row"><span className="trip-dot trip-dot-pickup" /> {offer.pickup_label}</div>
          <div className="offer-route-row"><span className="trip-dot trip-dot-dest" /> {offer.destination_label}</div>
        </div>
        <div className="offer-fare">GH₵{offer.fare_estimate}</div>

        <div className="offer-actions">
          <button className="btn btn-danger-ghost offer-btn" onClick={onDecline}>
            Decline
          </button>
          <button className="btn btn-success offer-btn" onClick={onAccept}>
            Accept ({secondsLeft}s)
          </button>
        </div>
      </div>
    </div>
  );
}
