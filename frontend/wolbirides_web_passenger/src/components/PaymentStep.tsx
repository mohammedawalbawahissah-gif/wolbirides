import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { realPhone } from "../phone";
import "./PaymentStep.css";

interface Payment {
  method: "cash" | "momo" | "hubtel" | "organization" | "bundle";
  amount: string;
  status: "pending" | "success" | "failed" | "refunded";
  failure_reason: string;
}

const PROVIDERS = { momo: "MTN MoMo", hubtel: "Hubtel" } as const;
type Provider = keyof typeof PROVIDERS;

/**
 * Pay-after-trip. Organization and bundle trips are already settled, so
 * this only appears for cash/mobile-money trips. Mobile money sends an
 * approval prompt to the passenger's phone, then we poll until the provider
 * reports the outcome. Cash is handed to the driver, who confirms it.
 */
export default function PaymentStep({ tripId, fare, preferredMethod }: { tripId: string; fare: string; preferredMethod?: "momo" | "hubtel" }) {
  const { user } = useAuth();
  const [payment, setPayment] = useState<Payment | null | undefined>(undefined);
  const [phone, setPhone] = useState(realPhone(user));
  // Honor the payment method chosen at booking time by skipping straight past
  // the picker — the passenger can still back out via "Choose a different way to pay".
  const [choice, setChoice] = useState<Provider | "cash" | null>(preferredMethod ?? null);
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

  // While a mobile-money prompt is out, check every 4s (providers usually settle within a minute).
  useEffect(() => {
    if ((payment?.method === "momo" || payment?.method === "hubtel") && payment?.status === "pending") {
      timer.current = window.setInterval(poll, 4000);
      return () => { if (timer.current) window.clearInterval(timer.current); };
    }
  }, [payment?.method, payment?.status, poll]);

  async function pay(provider: Provider) {
    setBusy(true);
    setError(null);
    try {
      const { data } = await api.post<Payment>(`/payments/${provider}/initiate`, { trip_id: tripId, phone: phone.trim() });
      setPayment(data);
    } catch (err: any) {
      setError(err?.response?.data?.detail || err?.response?.data?.phone?.[0] || `Couldn't start the ${PROVIDERS[provider]} payment.`);
    } finally {
      setBusy(false);
    }
  }

  if (payment === undefined) return null;
  if (payment && ["organization", "bundle"].includes(payment.method)) return null;

  if (payment?.status === "success") {
    const label = payment.method === "cash" ? "in cash" : `by ${PROVIDERS[payment.method as Provider]}`;
    return (
      <div className="card pay-card pay-done" role="status">
        <strong>Paid, GH₵{payment.amount}</strong>
        <span>{label}. Thank you!</span>
      </div>
    );
  }

  if (payment && (payment.method === "momo" || payment.method === "hubtel") && payment.status === "pending") {
    return (
      <div className="card pay-card" role="status" aria-live="polite">
        <div className="pay-title">Check your phone</div>
        <p>Approve the {PROVIDERS[payment.method]} prompt for GH₵{payment.amount} with your PIN. This page updates when it goes through.</p>
        <div className="pay-spinner" aria-hidden="true" />
      </div>
    );
  }

  return (
    <div className="card pay-card">
      <div className="pay-title">Pay GH₵{fare}</div>
      {payment?.status === "failed" && (
        <p className="pay-error">{payment.failure_reason || "The payment didn't go through."} Try again or pay another way.</p>
      )}
      {choice === null && (
        <div className="pay-options">
          <button className="btn btn-gold" onClick={() => setChoice("momo")}>MTN MoMo</button>
          <button className="btn btn-gold" onClick={() => setChoice("hubtel")}>Hubtel</button>
          <button className="btn btn-ghost" onClick={() => setChoice("cash")}>Cash to rider</button>
        </div>
      )}
      {(choice === "momo" || choice === "hubtel") && (
        <>
          <label className="field-label" htmlFor="momo-phone">{PROVIDERS[choice]} number</label>
          <input id="momo-phone" className="field-input" inputMode="tel" value={phone} placeholder="024 123 4567"
            onChange={(e) => setPhone(e.target.value)} />
          {error && <p className="pay-error">{error}</p>}
          <button className="btn btn-gold btn-block" disabled={busy || phone.trim().length < 9} onClick={() => pay(choice)}>
            {busy ? "Sending prompt…" : `Pay with ${PROVIDERS[choice]}`}
          </button>
          <button className="btn btn-ghost btn-block" onClick={() => setChoice(null)}>Choose a different way to pay</button>
        </>
      )}
      {choice === "cash" && (
        <>
          <p>Hand GH₵{fare} to your driver. They'll confirm it on their app.</p>
          <button className="btn btn-ghost btn-block" onClick={() => setChoice(null)}>Choose a different way to pay</button>
        </>
      )}
    </div>
  );
}
