import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { colors, spacing, typography } from "../theme";
import { Button, Card, ErrorBanner, FieldLabel, TextField } from "./ui";

interface Payment { method: string; amount: string; status: string; failure_reason: string }

/** Pay-after-trip: MoMo approval prompt (polled until MTN settles) or cash to the driver. */
export default function PaymentStep({ tripId, fare }: { tripId: string; fare: string }) {
  const { user } = useAuth();
  const [payment, setPayment] = useState<Payment | null | undefined>(undefined);
  const [phone, setPhone] = useState(user?.phone && !user.phone.startsWith("merged:") ? user.phone : "");
  const [cash, setCash] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const poll = useCallback(() => {
    api.get<Payment | null>(`/payments/trip/${tripId}`).then(({ data }) => setPayment(data)).catch(() => {});
  }, [tripId]);
  useEffect(poll, [poll]);
  useEffect(() => {
    if (payment?.method === "momo" && payment.status === "pending") {
      const id = setInterval(poll, 4000);
      return () => clearInterval(id);
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
      <Card style={{ marginBottom: spacing.md, borderLeftWidth: 4, borderLeftColor: colors.success }}>
        <Text style={{ color: colors.success, fontWeight: "700" }}>
          Paid GH₵{payment.amount} {payment.method === "momo" ? "by MoMo" : "in cash"}. Thank you!
        </Text>
      </Card>
    );
  }

  if (payment?.method === "momo" && payment.status === "pending") {
    return (
      <Card style={{ marginBottom: spacing.md, gap: spacing.sm }}>
        <Text style={typography.h2} accessibilityLiveRegion="polite">Check your phone</Text>
        <Text style={typography.body}>Approve the MoMo prompt for GH₵{payment.amount} with your PIN. This updates when it goes through.</Text>
        <ActivityIndicator color={colors.gold} />
      </Card>
    );
  }

  return (
    <Card style={{ marginBottom: spacing.md, gap: spacing.sm }}>
      <Text style={typography.h2}>Pay GH₵{fare}</Text>
      {payment?.status === "failed" && (
        <ErrorBanner message={`${payment.failure_reason || "The MoMo payment didn't go through."} Try again or pay cash.`} />
      )}
      {cash ? (
        <>
          <Text style={typography.body}>Hand GH₵{fare} to your driver. They'll confirm it on their app.</Text>
          <Button title="Pay with MoMo instead" variant="ghost" onPress={() => setCash(false)} />
        </>
      ) : (
        <View>
          <FieldLabel>MoMo number</FieldLabel>
          <TextField value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="024 123 4567" />
          {error && <ErrorBanner message={error} />}
          <Button title={busy ? "Sending prompt…" : "Pay with MoMo"} variant="gold" onPress={payMomo} loading={busy}
            disabled={phone.trim().length < 9} />
          <Button title="I'll pay cash" variant="ghost" onPress={() => setCash(true)} style={{ marginTop: spacing.sm }} />
        </View>
      )}
    </Card>
  );
}
