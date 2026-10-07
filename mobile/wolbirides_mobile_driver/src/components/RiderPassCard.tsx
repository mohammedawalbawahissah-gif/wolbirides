import { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { api, type RiderPass, type RiderPassStatus } from "../api/client";
import { colors, spacing, typography } from "../theme";
import { Button, Card, ErrorBanner, FieldLabel, TextField } from "./ui";

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
    const timer = setInterval(async () => {
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
        setError("Still waiting on MoMo. If you approved it, check again in a minute.");
      }
    }, 5000);
    return () => clearInterval(timer);
  }, [pending, load]);

  async function buy(planId: string) {
    setBusy(true);
    setError(null);
    try {
      const { data } = await api.post<RiderPass>("/drivers/me/passes", { plan_id: planId, phone: phone.trim() || undefined });
      setPending(data);
    } catch (err: any) {
      setError(err?.response?.data?.detail || "Couldn't start the payment.");
    } finally {
      setBusy(false);
    }
  }

  if (!status || (!status.required && !status.current)) return null;

  return (
    <Card style={{ marginBottom: spacing.md }}>
      <Text style={typography.h2}>Rider pass</Text>
      <Text style={styles.body}>
        {status.current
          ? `${status.current.source === "trial" ? "Free trial" : status.current.plan || "Pass"} active until ${when(status.current.expires_at)}`
            + (status.paid_until && status.paid_until !== status.current.expires_at ? ` · paid until ${when(status.paid_until)}` : "")
          : status.trial_available
            ? `Your ${status.trial_days}-day free trial starts the first time you go online.`
            : "You need a pass to go online. You keep every cedi of your fares."}
      </Text>

      {pending ? (
        <Text style={typography.muted}>Approve the GH₵{pending.price_paid} prompt on your phone. Waiting for MoMo…</Text>
      ) : status.plans.length > 0 ? (
        <>
          <FieldLabel>MoMo number (optional)</FieldLabel>
          <TextField value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="Defaults to your payout number" />
          <View style={{ gap: spacing.sm }}>
            {status.plans.map((p) => (
              <Button key={p.id} variant="gold" disabled={busy} onPress={() => buy(p.id)}
                title={`${status.current ? "Add" : "Buy"} ${p.name} · GH₵${p.price}`} />
            ))}
          </View>
          <Text style={[typography.muted, { marginTop: spacing.sm }]}>
            A new pass starts when your current one ends. Paid ops in cash? They can add it for you.
          </Text>
        </>
      ) : null}
      {error && <ErrorBanner message={error} />}
    </Card>
  );
}

const styles = StyleSheet.create({
  body: { fontSize: 14, color: colors.ink, lineHeight: 20, marginVertical: spacing.sm },
});
