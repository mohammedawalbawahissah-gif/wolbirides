import { useCallback, useEffect, useRef, useState } from "react";
import { api, requestErrorMessage, type RiderPass, type RiderPassStatus } from "../api/client";

function when(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** Rider pass: shows cover, sells day/week passes by MoMo, polls until MTN confirms.
 *  Renders nothing while passes aren't switched on and the rider has none. */
export default function RiderPassCard({ refreshKey = 0 }: { refreshKey?: number }) {
  const [status, setStatus] = useState<RiderPassStatus | null>(null);
  const [phone, setPhone] = useState("");
  const [pending, setPending] = useState<RiderPass | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const polls = useRef(0);

  const load = useCallback(() => {
    api.get<RiderPassStatus>("/drivers/me/passes").then(({ data }) => setStatus(data)).catch(() => {});
  }, []);
  useEffect(load, [load, refreshKey]);

  // While a MoMo prompt is open, check every 5s for up to ~2 minutes.
  useEffect(() => {
    if (!pending) return;
    polls.current = 0;
    const timer = window.setInterval(async () => {
      polls.current += 1;
      try {
        const { data } = await api.post<RiderPass>(`/drivers/me/passes/${pending.id}/refresh`);
        if (data.status !== "pending_payment") {
          setPending(null);
          if (data.status === "cancelled") setError("The MoMo payment didn't go through. Try again.");
          load();
        }
      } catch { /* keep polling */ }
      if (polls.current >= 24) {
        setPending(null);
        setError("Still waiting on MoMo. If you approved it, refresh in a minute.");
      }
    }, 5000);
    return () => window.clearInterval(timer);
  }, [pending, load]);

  async function buy(planId: string) {
    setBusy(true);
    setError(null);
    try {
      const { data } = await api.post<RiderPass>("/drivers/me/passes", { plan_id: planId, phone: phone.trim() || undefined });
      setPending(data);
    } catch (err) {
      setError(requestErrorMessage(err, "Couldn't start the payment."));
    } finally {
      setBusy(false);
    }
  }

  if (!status || (!status.required && !status.current)) return null;

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <h2 className="side-card-title">Rider pass</h2>
      {status.current ? (
        <p>
          {status.current.source === "trial" ? "Free trial" : status.current.plan || "Pass"} active until{" "}
          <strong>{when(status.current.expires_at)}</strong>
          {status.paid_until && status.paid_until !== status.current.expires_at && (
            <> · paid until <strong>{when(status.paid_until)}</strong></>
          )}
        </p>
      ) : status.trial_available ? (
        <p>Your {status.trial_days}-day free trial starts the first time you go online.</p>
      ) : (
        <p>You need a pass to go online. You keep every cedi of your fares.</p>
      )}

      {pending ? (
        <p className="opt-note">Approve the GH₵{pending.price_paid} prompt on your phone. Waiting for MoMo…</p>
      ) : (
        status.plans.length > 0 && (
          <>
            <label className="field-label" htmlFor="pass-phone">MoMo number (optional)</label>
            <input id="pass-phone" className="field-input" inputMode="tel" placeholder="Defaults to your payout number"
              value={phone} onChange={(e) => setPhone(e.target.value)} />
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
              {status.plans.map((p) => (
                <button key={p.id} className="btn btn-gold" disabled={busy} onClick={() => buy(p.id)}>
                  {status.current ? "Add" : "Buy"} {p.name} · GH₵{p.price}
                </button>
              ))}
            </div>
            <p className="opt-note">A new pass starts when your current one ends. Paid ops in cash? They can add it for you.</p>
          </>
        )
      )}
      {error && <div className="auth-error">{error}</div>}
    </div>
  );
}
