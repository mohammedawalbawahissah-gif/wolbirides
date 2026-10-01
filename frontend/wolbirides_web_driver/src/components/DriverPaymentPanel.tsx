import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";

interface Payment { method: string; amount: string; status: string; failure_reason: string }

/** After a trip: tells the driver whether to collect cash, and lets them confirm it. */
export default function DriverPaymentPanel({ tripId, fare, paymentMethod, onDone }: {
  tripId: string; fare: string; paymentMethod?: string; onDone: () => void;
}) {
  const [payment, setPayment] = useState<Payment | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const prepaid = paymentMethod === "organization" || paymentMethod === "bundle";

  const load = useCallback(() => {
    api.get<Payment | null>(`/payments/trip/${tripId}`).then(({ data }) => setPayment(data)).catch(() => {});
  }, [tripId]);

  useEffect(() => {
    load();
    const id = window.setInterval(load, 5000); // the passenger may pay by MoMo while the driver waits
    return () => window.clearInterval(id);
  }, [load]);

  async function confirmCash() {
    setBusy(true);
    setError(null);
    try {
      const { data } = await api.post<Payment>("/payments/cash/confirm", { trip_id: tripId });
      setPayment(data);
    } catch (err: any) {
      setError(err?.response?.data?.detail || "Couldn't record that. Try again.");
      load();
    } finally {
      setBusy(false);
    }
  }

  const PROVIDER_NAME: Record<string, string> = { momo: "MTN MoMo", hubtel: "Hubtel" };
  const paid = prepaid || payment?.status === "success";
  const mobileMoneyPending = (payment?.method === "momo" || payment?.method === "hubtel") && payment.status === "pending";

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h2 className="side-card-title">Payment</h2>
      {paid ? (
        <p style={{ color: "var(--success)", fontWeight: 600, margin: "0 0 12px" }}>
          {prepaid ? "Prepaid. Don't collect cash; it's in your weekly payout."
            : payment!.method === "cash" ? `Cash GH₵${payment!.amount} recorded.`
            : `Paid GH₵${payment!.amount} by ${PROVIDER_NAME[payment!.method] ?? payment!.method}. Don't collect cash.`}
        </p>
      ) : mobileMoneyPending ? (
        <p style={{ margin: "0 0 12px" }}>
          The passenger is approving a {PROVIDER_NAME[payment!.method] ?? "mobile money"} payment. Wait a moment before collecting cash.
        </p>
      ) : (
        <>
          <p style={{ margin: "0 0 12px" }}>Collect <strong>GH₵{fare}</strong> in cash, or wait while the passenger pays by mobile money.</p>
          {error && <p style={{ color: "var(--danger)", fontSize: 13.5 }}>{error}</p>}
          <button className="btn btn-success btn-block" disabled={busy} onClick={confirmCash}>
            {busy ? "Saving…" : "Cash received"}
          </button>
        </>
      )}
      <button className="btn btn-ghost btn-block" style={{ marginTop: 8 }} onClick={onDone}>
        {paid ? "Back to home" : "Skip for now"}
      </button>
    </div>
  );
}
