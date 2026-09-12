import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { api, type Earnings as EarningsType } from "../api/client";
import { Card, EmptyState } from "../components/ui";
import { colors, spacing, typography } from "../theme";

export default function EarningsScreen() {
  const [earnings, setEarnings] = useState<EarningsType | null>(null);

  useEffect(() => {
    api.get<EarningsType>("/drivers/me/earnings").then(({ data }) => setEarnings(data));
  }, []);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={typography.h1}>Earnings</Text>
      <Text style={[typography.muted, styles.subtitle]}>Computed live from your completed trips.</Text>

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
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  content: { padding: spacing.lg },
  subtitle: { marginBottom: spacing.lg },
  cardsRow: { gap: spacing.md, marginBottom: spacing.md },
  statCard: { alignItems: "flex-start", paddingVertical: spacing.lg },
  statValue: { fontSize: 30, fontWeight: "700", color: colors.navyInk, marginVertical: spacing.xs },
  footnote: { fontSize: 12.5, color: colors.inkMuted, lineHeight: 18, marginTop: spacing.sm },
});
