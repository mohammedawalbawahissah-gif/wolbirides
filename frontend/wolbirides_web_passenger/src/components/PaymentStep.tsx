import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import "./PaymentStep.css";

interface Payment {
  method: "cash" | "momo" | "organization" | "bundle";
  amount: string;
  status: "pending" | "success" | "failed" | "refunded";
  failure_reason: string;
}

/**
 * Pay-after-trip. Organization and bundle trips are already settled, so
 * this only appears for cash/MoMo trips. MoMo sends an approval prompt to
 * the rider's phone, then we poll until MTN reports the outcome. Cash is
 * handed to the driver, who confirms it on their side.
 */
export default function PaymentStep({ tripId, fare }: { tripId: string; fare: string }) {
  const { user } = useAuth();
  const [payment, setPayment] = useState<Payment | null | undefined>(undefined);
  const [phone, setPhone] = useState(user?.phone && !user.phone.startsWith("merged:") ? user.phone : "");
  const [choice, setChoice] = useState<"momo" | "cash" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  const poll = useCallback(async () => {
    try {
      const { data } = await api.get<Payment | null>(`/payments/trip/${tripId}`);
      setPayment(data);
      return data;
    } catch {
      return null;
    }
  }, [tripId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks-js/set-state-in-effect -- resets loading/error state as the effect starts a fetch or subscription
    poll();
    return () => { if (timer.current) window.clearInterval(timer.current); };
  }, [poll]);

  // While a MoMo prompt is out, check every 4s (MTN usually settles within a minute).
  useEffect(() => {
    if (payment?.method === "momo" && payment.status === "pending") {
      timer.current = window.setInterval(poll, 4000);
      return () => { if (timer.current) window.clearInterval(timer.current); };
    }
  }, [payment?.method, payment?.status, poll]);

  async function payMomo() {
    setBusy(true);
    setError(null);
    try {
      const { data } = await api.post<Payment>("/payments/momo/initiate", { trip_id: tripId, phone: phone.trim() });
      setPayment(data);
    } catch (err: any) {
      setError(err?.response?.data?.detail || err?.response?.data?.phone?.[0] || "Couldn't start the MoMo payment.");
    } finally {
      setBusy(false);
    }
  }

  if (payment === undefined) return null;
  if (payment && ["organization", "bundle"].includes(payment.method)) return null;

  if (payment?.status === "success") {
    return (
      <div className="card pay-card pay-done" role="status">
        <strong>Paid, GH₵{payment.amount}</strong>
        <span>{payment.method === "momo" ? "by MoMo" : "in cash"}. Thank you!</span>
      </div>
    );
  }

  if (payment?.method === "momo" && payment.status === "pending") {
    return (
      <div className="card pay-card" role="status" aria-live="polite">
        <div className="pay-title">Check your phone</div>
        <p>Approve the MoMo prompt for GH₵{payment.amount} with your PIN. This page updates when it goes through.</p>
        <div className="pay-spinner" aria-hidden="true" />
      </div>
    );
  }

  return (
    <div className="card pay-card">
      <div className="pay-title">Pay GH₵{fare}</div>
      {payment?.status === "failed" && (
        <p className="pay-error">{payment.failure_reason || "The MoMo payment didn't go through."} Try again or pay cash.</p>
      )}
      {choice !== "cash" && (
        <>
          <label className="field-label" htmlFor="momo-phone">MoMo number</label>
          <input id="momo-phone" className="field-input" inputMode="tel" value={phone} placeholder="024 123 4567"
            onChange={(e) => setPhone(e.target.value)} />
          {error && <p className="pay-error">{error}</p>}
          <button className="btn btn-gold btn-block" disabled={busy || phone.trim().length < 9} onClick={payMomo}>
            {busy ? "Sending prompt…" : "Pay with MoMo"}
          </button>
          <button className="btn btn-ghost btn-block" onClick={() => setChoice("cash")}>I'll pay cash</button>
        </>
      )}
      {choice === "cash" && (
        <>
          <p>Hand GH₵{fare} to your driver. They'll confirm it on their app.</p>
          <button className="btn btn-ghost btn-block" onClick={() => setChoice(null)}>Pay with MoMo instead</button>
        </>
      )}
    </div>
  );
}
