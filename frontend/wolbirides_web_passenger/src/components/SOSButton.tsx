import { useState } from "react";
import { api, type SOSResult } from "../api/client";
import "./SOSButton.css";

/**
 * WR-18 in-trip SOS. Two taps on purpose: the first opens a confirm sheet,
 * the second sends — an accidental pocket-press shouldn't suspend a driver.
 * Location is attached if the browser gives it within a few seconds; the
 * alert goes out regardless.
 */
export default function SOSButton({ tripId }: { tripId: string }) {
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<SOSResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  function currentPosition(): Promise<GeolocationPosition | null> {
    return new Promise((resolve) => {
      if (!navigator.geolocation) return resolve(null);
      navigator.geolocation.getCurrentPosition(resolve, () => resolve(null), { timeout: 5000, maximumAge: 30000 });
    });
  }

  // PRD WR-18: SOS must survive poor connectivity. A failed send is kept and
  // retried aggressively (every few seconds, and the moment the browser comes
  // back online) until it lands, without the rider pressing anything again.
  async function send() {
    setSending(true);
    setError(null);
    const pos = await currentPosition();
    const body = pos ? { lat: pos.coords.latitude.toFixed(6), lng: pos.coords.longitude.toFixed(6) } : {};
    for (let attempt = 0; attempt < 40; attempt++) {
      try {
        const { data } = await api.post<SOSResult>(`/trips/${tripId}/sos`, body);
        setResult(data);
        setSending(false);
        return;
      } catch (err: any) {
        if (err?.response && err.response.status < 500) break; // a real refusal, not a network problem
        setError("No connection. Still trying to send your alert. If you can, call 112 now.");
        await new Promise<void>((resolve) => {
          const done = () => { window.removeEventListener("online", done); resolve(); };
          window.addEventListener("online", done);
          window.setTimeout(done, Math.min(2000 + attempt * 1000, 8000));
        });
      }
    }
    setError("The alert didn't go through. Call 112 now, then try again.");
    setSending(false);
  }

  return (
    <>
      <button className="sos-trigger" onClick={() => setOpen(true)}>
        SOS
      </button>

      {open && (
        <div className="sos-overlay" role="dialog" aria-modal="true" aria-labelledby="sos-title">
          <div className="sos-sheet">
            {result ? (
              <>
                <h2 id="sos-title">Help is on the way</h2>
                <p>
                  The WolbiRides team has your alert{result.contact_notified ? " and your emergency contact has been texted" : ""}.
                  If you're in immediate danger, call emergency services.
                </p>
                <a className="btn btn-danger btn-block" href={`tel:${result.emergency_number}`}>
                  Call {result.emergency_number}
                </a>
                <button className="btn btn-ghost btn-block" onClick={() => setOpen(false)}>
                  Close
                </button>
              </>
            ) : (
              <>
                <h2 id="sos-title">Send an SOS alert?</h2>
                <p>
                  We'll alert the WolbiRides safety team with your location and text your emergency contact if you've
                  set one.
                </p>
                {error && <p className="sos-error">{error}</p>}
                <button className="btn btn-danger btn-block" disabled={sending} onClick={send}>
                  {sending ? (error ? "Retrying…" : "Sending alert…") : "Send SOS alert"}
                </button>
                <a className="btn btn-ghost btn-block" href="tel:112">
                  Call 112 instead
                </a>
                <button className="sos-cancel" onClick={() => setOpen(false)} disabled={sending}>
                  Cancel
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
