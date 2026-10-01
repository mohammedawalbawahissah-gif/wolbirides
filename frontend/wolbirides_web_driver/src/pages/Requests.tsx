import { useEffect, useState } from "react";
import { OfferBody } from "../components/OfferModal";
import { useDispatchState } from "../components/DispatchLayer";
import "./Requests.css";

/**
 * The offer currently pending this driver's response — the same thing the countdown modal
 * shows, but on its own page, reachable at any time. Before this existed, an ops-sent delivery
 * offer (or a ride offer whose modal got dismissed) had nowhere else to be seen or acted on.
 */
export default function Requests() {
  const { offer, accept, decline } = useDispatchState();
  const [busy, setBusy] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(offer?.timeout_seconds ?? 0);

  useEffect(() => {
    if (!offer) return;
    // eslint-disable-next-line react/no-set-state-in-effect -- resets the countdown as the effect starts, keyed on trip_id below
    setSecondsLeft(offer.timeout_seconds);
    const interval = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- resets only when a *different* offer arrives, not every second
  }, [offer?.trip_id]);

  async function handle(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="page-heading">
        <h1>Requests</h1>
        <p>What's waiting for your response right now.</p>
      </div>

      {!offer && <div className="empty-state">Nothing waiting right now — you'll see a ride or delivery here the moment one's offered to you.</div>}

      {offer && (
        <div className="card request-card">
          {offer.admin_offer && <div className="request-admin-tag">Sent to you directly by WolbiRides ops</div>}
          <OfferBody offer={offer} />
          <div className="request-timer">{secondsLeft > 0 ? `${secondsLeft}s to respond` : "Expiring…"}</div>
          <div className="offer-actions">
            <button className="btn btn-danger-ghost offer-btn" disabled={busy} onClick={() => handle(decline)}>Decline</button>
            <button className="btn btn-success offer-btn" disabled={busy} onClick={() => handle(accept)}>Accept</button>
          </div>
        </div>
      )}
    </div>
  );
}
