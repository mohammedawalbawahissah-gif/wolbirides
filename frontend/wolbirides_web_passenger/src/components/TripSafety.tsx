import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useToast } from "./Toast";
import "./TripSafety.css";

/** WR-18: share a live link to this ride. */
export function ShareTripButton({ tripId }: { tripId: string }) {
  const { user } = useAuth();
  const toast = useToast();
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function share(sendToContact: boolean) {
    setBusy(true);
    try {
      const { data } = await api.post<{ url: string; sent_to_contact: boolean }>(`/trips/${tripId}/share`, {
        send_to_contact: sendToContact,
      });
      setUrl(data.url);
      if (sendToContact) {
        toast.show(data.sent_to_contact ? "Link texted to your emergency contact." : "Couldn't text the link. Copy it instead.",
          data.sent_to_contact ? "success" : "error");
        return;
      }
      if (navigator.share) {
        await navigator.share({ title: "Follow my WolbiRides trip", url: data.url }).catch(() => {});
      } else {
        await navigator.clipboard.writeText(data.url);
        toast.show("Link copied. Paste it to anyone you like.", "success");
      }
    } catch {
      toast.show("Couldn't create a share link right now.", "error");
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    await api.delete(`/trips/${tripId}/share`).catch(() => {});
    setUrl(null);
    toast.show("Sharing stopped. Old links no longer work.", "success");
  }

  return (
    <div className="trip-share">
      <button className="btn btn-ghost btn-block" disabled={busy} onClick={() => share(false)}>
        Share trip
      </button>
      {user?.emergency_contact_phone && (
        <button className="btn btn-ghost btn-block" disabled={busy} onClick={() => share(true)}>
          Text link to {user.emergency_contact_name || "emergency contact"}
        </button>
      )}
      {url && (
        <div className="trip-share-live">
          <span>Your trip is being shared.</span>
          <button onClick={stop}>Stop sharing</button>
        </div>
      )}
    </div>
  );
}

/** WR-18: answers the automatic "Are you OK?" prompt on overdue trips. */
export function CheckInPrompt({ tripId, refreshKey }: { tripId: string; refreshKey: unknown }) {
  const [pending, setPending] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const load = useCallback(() => {
    api.get(`/trips/${tripId}/safety-check`).then(({ data }) => setPending(!!data)).catch(() => {});
  }, [tripId]);

  useEffect(load, [load, refreshKey]);
  useEffect(() => {
    const id = window.setInterval(load, 30000);
    return () => window.clearInterval(id);
  }, [load]);

  async function answer(response: "ok" | "help") {
    setBusy(true);
    try {
      await api.post(`/trips/${tripId}/safety-check`, { response });
      setPending(false);
      toast.show(response === "ok" ? "Thanks. Enjoy the rest of your ride." : "Alert sent. Our team is calling you.",
        response === "ok" ? "success" : "info");
    } catch {
      toast.show("That didn't send. Try again, or use SOS.", "error");
    } finally {
      setBusy(false);
    }
  }

  if (!pending) return null;
  return (
    <div className="check-in" role="alertdialog" aria-labelledby="check-in-title">
      <div id="check-in-title" className="check-in-title">Are you OK?</div>
      <div className="check-in-actions">
        <button className="btn btn-success" disabled={busy} onClick={() => answer("ok")}>I'm OK</button>
        <button className="btn btn-danger" disabled={busy} onClick={() => answer("help")}>I need help</button>
      </div>
    </div>
  );
}

/**
 * WR-18 post-trip check-in: "Did anything feel off?" Deliberately separate from the
 * star rating, so it never reads as fishing for a good review.
 */
export function PostTripCheckin({ tripId }: { tripId: string }) {
  const toast = useToast();
  const [state, setState] = useState<"ask" | "details" | "done">("ask");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);

  async function send(response: "fine" | "something_off") {
    setBusy(true);
    try {
      await api.post(`/trips/${tripId}/checkin`, { response, details: details.trim() });
      setState("done");
      if (response === "something_off") toast.show("Thank you. Our safety team will look into it.", "info");
    } catch {
      toast.show("That didn't send. Try again.", "error");
    } finally {
      setBusy(false);
    }
  }

  if (state === "done") return null;
  return (
    <div className="card post-checkin" aria-labelledby="post-checkin-title">
      <div id="post-checkin-title" className="post-checkin-title">Safety check: did anything feel off?</div>
      {state === "ask" ? (
        <div className="check-in-actions">
          <button className="btn btn-ghost" disabled={busy} onClick={() => send("fine")}>No, all fine</button>
          <button className="btn btn-ghost" disabled={busy} onClick={() => setState("details")}>Something felt off</button>
        </div>
      ) : (
        <>
          <label className="field-label" htmlFor="checkin-details">What happened? (optional)</label>
          <textarea id="checkin-details" className="field-input" rows={3} value={details}
            onChange={(e) => setDetails(e.target.value)} maxLength={500} />
          <button className="btn btn-primary" disabled={busy} onClick={() => send("something_off")}>Send to safety team</button>
          <p className="opt-note">If you're in danger now, call 112.</p>
        </>
      )}
    </div>
  );
}

/** WR-19: no driver matching the passenger's preference is free. The passenger decides; nobody is silently reassigned. */
export function PreferenceDecision({ tripId, status, onDecided }: { tripId: string; status?: string; onDecided: () => void }) {
  const [busy, setBusy] = useState(false);
  if (status !== "awaiting_passenger" && status !== "keep_waiting") return null;

  async function decide(decision: "any_driver" | "keep_waiting") {
    setBusy(true);
    try {
      await api.post(`/trips/${tripId}/preference-decision`, { decision });
      onDecided();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="check-in" role="alertdialog" aria-labelledby="pref-title">
      <div id="pref-title" className="check-in-title">
        {status === "keep_waiting" ? "Still looking for a matching rider" : "No matching rider is free right now"}
      </div>
      <div className="check-in-actions">
        <button className="btn btn-gold" disabled={busy} onClick={() => decide("any_driver")}>Next available rider</button>
        {status !== "keep_waiting" && (
          <button className="btn btn-ghost" disabled={busy} onClick={() => decide("keep_waiting")}>Keep waiting</button>
        )}
      </div>
    </div>
  );
}
