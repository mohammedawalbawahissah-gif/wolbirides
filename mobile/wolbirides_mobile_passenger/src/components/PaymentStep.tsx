import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { realPhone } from "../phone";
import { colors, spacing, typography } from "../theme";
import { Button, Card, ErrorBanner, FieldLabel, TextField } from "./ui";

interface Payment { method: "cash" | "momo" | "hubtel" | "organization" | "bundle"; amount: string; status: string; failure_reason: string }

const PROVIDERS = { momo: "MTN MoMo", hubtel: "Hubtel" } as const;
type Provider = keyof typeof PROVIDERS;

/** Pay-after-trip: a mobile-money approval prompt (polled until it settles) or cash to the driver. */
export default function PaymentStep({ tripId, fare, preferredMethod }: { tripId: string; fare: string; preferredMethod?: "momo" | "hubtel" }) {
  const { user } = useAuth();
  const [payment, setPayment] = useState<Payment | null | undefined>(undefined);
  const [phone, setPhone] = useState(realPhone(user));
  // Honor the payment method chosen at booking time by skipping straight past the
  // picker — the passenger can still back out via "Choose a different way to pay".
  const [choice, setChoice] = useState<Provider | "cash" | null>(preferredMethod ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const poll = useCallback(() => {
    api.get<Payment | null>(`/payments/trip/${tripId}`).then(({ data }) => setPayment(data)).catch(() => {});
  }, [tripId]);
  useEffect(poll, [poll]);
  useEffect(() => {
    if ((payment?.method === "momo" || payment?.method === "hubtel") && payment?.status === "pending") {
      const id = setInterval(poll, 4000);
      return () => clearInterval(id);
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
      <Card style={{ marginBottom: spacing.md, borderLeftWidth: 4, borderLeftColor: colors.success }}>
        <Text style={{ color: colors.success, fontWeight: "700" }}>Paid GH₵{payment.amount} {label}. Thank you!</Text>
      </Card>
    );
  }

  if (payment && (payment.method === "momo" || payment.method === "hubtel") && payment.status === "pending") {
    return (
      <Card style={{ marginBottom: spacing.md, gap: spacing.sm }}>
        <Text style={typography.h2} accessibilityLiveRegion="polite">Check your phone</Text>
        <Text style={typography.body}>Approve the {PROVIDERS[payment.method]} prompt for GH₵{payment.amount} with your PIN. This updates when it goes through.</Text>
        <ActivityIndicator color={colors.gold} />
      </Card>
    );
  }

  return (
    <Card style={{ marginBottom: spacing.md, gap: spacing.sm }}>
      <Text style={typography.h2}>Pay GH₵{fare}</Text>
      {payment?.status === "failed" && (
        <ErrorBanner message={`${payment.failure_reason || "The payment didn't go through."} Try again or pay another way.`} />
      )}
      {choice === null && (
        <View style={{ gap: spacing.sm }}>
          <Button title="MTN MoMo" variant="gold" onPress={() => setChoice("momo")} />
          <Button title="Hubtel" variant="gold" onPress={() => setChoice("hubtel")} />
          <Button title="Cash to rider" variant="ghost" onPress={() => setChoice("cash")} />
        </View>
      )}
      {(choice === "momo" || choice === "hubtel") && (
        <View>
          <FieldLabel>{PROVIDERS[choice]} number</FieldLabel>
          <TextField value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="024 123 4567" />
          {error && <ErrorBanner message={error} />}
          <Button title={busy ? "Sending prompt…" : `Pay with ${PROVIDERS[choice]}`} variant="gold" onPress={() => pay(choice)}
            loading={busy} disabled={phone.trim().length < 9} />
          <Button title="Choose a different way to pay" variant="ghost" onPress={() => setChoice(null)} style={{ marginTop: spacing.sm }} />
        </View>
      )}
      {choice === "cash" && (
        <>
          <Text style={typography.body}>Hand GH₵{fare} to your driver. They'll confirm it on their app.</Text>
          <Button title="Choose a different way to pay" variant="ghost" onPress={() => setChoice(null)} />
        </>
      )}
    </Card>
  );
}
