import { useCallback, useEffect, useState } from "react";
import { Text } from "react-native";
import { api } from "../api/client";
import { colors, spacing, typography } from "../theme";
import { Button, Card, ErrorBanner } from "./ui";

interface Payment { method: string; amount: string; status: string }

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
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
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

  const paid = prepaid || payment?.status === "success";
  const momoPending = payment?.method === "momo" && payment.status === "pending";

  return (
    <Card style={{ marginTop: spacing.md, gap: spacing.sm }}>
      <Text style={typography.h2}>Payment</Text>
      {paid ? (
        <Text style={{ color: colors.success, fontWeight: "600" }}>
          {prepaid ? "Prepaid. Don't collect cash; it's in your weekly payout."
            : payment!.method === "momo" ? `Paid GH₵${payment!.amount} by MoMo. Don't collect cash.`
            : `Cash GH₵${payment!.amount} recorded.`}
        </Text>
      ) : momoPending ? (
        <Text style={typography.body}>The rider is approving a MoMo payment. Wait a moment before collecting cash.</Text>
      ) : (
        <>
          <Text style={typography.body}>Collect GH₵{fare} in cash, or wait while the rider pays by MoMo.</Text>
          {error && <ErrorBanner message={error} />}
          <Button title={busy ? "Saving…" : "Cash received"} variant="success" onPress={confirmCash} loading={busy} />
        </>
      )}
      <Button title={paid ? "Back to home" : "Skip for now"} variant="ghost" onPress={onDone} />
    </Card>
  );
}
