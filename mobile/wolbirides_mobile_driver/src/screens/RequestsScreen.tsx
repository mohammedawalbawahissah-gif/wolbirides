import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { OfferBody } from "../components/OfferModal";
import { useDispatchState } from "../components/DispatchLayer";
import { Button, Card, EmptyState } from "../components/ui";
import { colors, spacing, typography } from "../theme";

/**
 * The offer currently pending this driver's response — the same thing the countdown modal
 * shows, but on its own screen, reachable at any time. Before this existed, an ops-sent
 * delivery offer (or a ride offer whose modal got dismissed) had nowhere else to be seen.
 */
export default function RequestsScreen() {
  const { offer, accept, decline } = useDispatchState();
  const [busy, setBusy] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(offer?.timeout_seconds ?? 0);

  useEffect(() => {
    if (!offer) return;
    setSecondsLeft(offer.timeout_seconds);
    const id = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- resets only when a *different* offer arrives, not every second
  }, [offer?.trip_id]);

  async function handle(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={typography.h1}>Requests</Text>
      <Text style={[typography.muted, styles.subtitle]}>What's waiting for your response right now.</Text>

      {!offer && <EmptyState message="Nothing waiting right now — you'll see a ride or delivery here the moment one's offered to you." />}

      {offer && (
        <Card>
          {offer.admin_offer && <Text style={styles.adminTag}>Sent to you directly by WolbiRides ops</Text>}
          <OfferBody offer={offer} />
          <Text style={styles.timer}>{secondsLeft > 0 ? `${secondsLeft}s to respond` : "Expiring…"}</Text>
          <View style={{ flexDirection: "row", gap: spacing.sm }}>
            <Button title="Decline" variant="dangerGhost" onPress={() => handle(decline)} disabled={busy} style={{ flex: 1 }} />
            <Button title="Accept" variant="success" onPress={() => handle(accept)} disabled={busy} style={{ flex: 1 }} />
          </View>
        </Card>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  content: { padding: spacing.lg },
  subtitle: { marginBottom: spacing.lg },
  adminTag: {
    alignSelf: "flex-start", fontSize: 12, fontWeight: "700", color: colors.navyInk,
    backgroundColor: colors.gold, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, marginBottom: spacing.sm,
  },
  timer: { fontSize: 13, color: colors.inkMuted, textAlign: "center", marginVertical: spacing.sm },
});
