import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { api, type Earnings as EarningsType } from "../api/client";
import { Badge, Card, EmptyState } from "../components/ui";
import { colors, spacing, typography } from "../theme";

export default function EarningsScreen() {
  const [earnings, setEarnings] = useState<EarningsType | null>(null);

  const [payouts, setPayouts] = useState<Payout[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    api.get<EarningsType>("/drivers/me/earnings").then(({ data }) => setEarnings(data));
    api.get<Payout[]>("/drivers/me/payouts").then(({ data }) => setPayouts(data)).catch(() => setPayouts([]));
  }, []);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={typography.h1}>Earnings</Text>


      {!earnings && <EmptyState message="Loading…" />}

      {earnings && (
        <>
          <View style={styles.cardsRow}>
            <Card style={styles.statCard}>
              <Text style={typography.muted}>Today</Text>
              <Text style={styles.statValue}>GH₵{earnings.earnings_today}</Text>
              <Text style={typography.muted}>
                {earnings.trips_completed_today} trip{earnings.trips_completed_today === 1 ? "" : "s"}
              </Text>
            </Card>
            <Card style={styles.statCard}>
              <Text style={typography.muted}>All time</Text>
              <Text style={styles.statValue}>GH₵{earnings.earnings_total}</Text>
              <Text style={typography.muted}>
                {earnings.trips_completed_total} trip{earnings.trips_completed_total === 1 ? "" : "s"}
              </Text>
            </Card>
          </View>

          <Text style={styles.footnote}>
            This is a live sum of your completed trip fares, not a payout ledger — WR-07.4's
            commission/subscription model isn't deducted here yet, so treat this as gross fare
            collected, not take-home pay.
          </Text>
        </>
      )}

      <Text style={[typography.h2, { marginTop: spacing.lg }]}>Weekly payouts</Text>
      <Text style={[typography.muted, { marginBottom: spacing.sm }]}>
        MoMo-paid trips are paid out weekly after review. Cash trips aren't included, since you collected that fare directly.
      </Text>
      {payouts?.length === 0 && <Text style={typography.muted}>No payouts yet.</Text>}
      {payouts?.map((p) => (
        <Card key={p.id} style={{ marginBottom: spacing.sm }}>
          <TouchableOpacity onPress={() => setOpenId(openId === p.id ? null : p.id)} style={styles.payoutRow}
            accessibilityState={{ expanded: openId === p.id }}>
            <View style={{ flex: 1 }}>
              <Text style={styles.payoutPeriod}>{p.period_start} to {p.period_end}</Text>
              <Text style={typography.muted}>{p.line_items.length} trip{p.line_items.length === 1 ? "" : "s"}</Text>
            </View>
            <View style={{ alignItems: "flex-end" }}>
              <Text style={styles.payoutAmount}>GH₵{p.amount}</Text>
              <Badge label={PAYOUT_LABEL[p.status]} tone={p.status === "paid" ? "success" : p.status === "failed" ? "danger" : "warning"} />
            </View>
          </TouchableOpacity>
          {p.status === "failed" && !!p.failure_reason && <Text style={styles.failure}>{p.failure_reason}</Text>}
          {openId === p.id && p.line_items.map((li) => (
            <View key={li.trip_id} style={styles.lineItem}>
              <Text style={typography.muted}>{li.completed_at ? new Date(li.completed_at).toLocaleDateString() : li.trip_id.slice(0, 8)}</Text>
              <Text style={typography.muted}>GH₵{li.fare} − GH₵{li.commission}</Text>
              <Text style={styles.net}>GH₵{li.net}</Text>
            </View>
          ))}
        </Card>
      ))}
    </ScrollView>
  );
}

interface Payout {
  id: string;
  period_start: string;
  period_end: string;
  amount: string;
  status: "pending" | "approved" | "paid" | "failed";
  failure_reason: string;
  line_items: { trip_id: string; fare: string; commission: string; net: string; completed_at?: string | null }[];
}

const PAYOUT_LABEL: Record<Payout["status"], string> = {
  pending: "Under review", approved: "Approved", paid: "Paid", failed: "Failed",
};

const styles = StyleSheet.create({
  payoutRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  payoutPeriod: { fontSize: 15, fontWeight: "600", color: colors.ink },
  payoutAmount: { fontSize: 17, fontWeight: "700", color: colors.navyInk, marginBottom: 4 },
  failure: { color: colors.danger, fontSize: 13, marginTop: spacing.xs },
  lineItem: { flexDirection: "row", justifyContent: "space-between", paddingTop: spacing.sm, marginTop: spacing.sm,
    borderTopWidth: 1, borderTopColor: colors.line },
  net: { fontWeight: "700", color: colors.ink },
  screen: { flex: 1, backgroundColor: colors.paper },
  content: { padding: spacing.lg },
  subtitle: { marginBottom: spacing.lg },
  cardsRow: { gap: spacing.md, marginBottom: spacing.md },
  statCard: { alignItems: "flex-start", paddingVertical: spacing.lg },
  statValue: { fontSize: 30, fontWeight: "700", color: colors.navyInk, marginVertical: spacing.xs },
  footnote: { fontSize: 12.5, color: colors.inkMuted, lineHeight: 18, marginTop: spacing.sm },
});
