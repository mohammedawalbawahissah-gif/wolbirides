import { useEffect, useState } from "react";
import { Modal, StyleSheet, Text, View } from "react-native";
import { Button } from "../components/ui";
import { colors, spacing } from "../theme";
import type { RideOffer } from "../api/client";

export default function OfferModal({
  offer,
  onAccept,
  onDecline,
}: {
  offer: RideOffer;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const [secondsLeft, setSecondsLeft] = useState(offer.timeout_seconds);

  useEffect(() => {
    setSecondsLeft(offer.timeout_seconds);
    const interval = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          clearInterval(interval);
          onDecline();
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offer.trip_id]);

  const pct = (secondsLeft / offer.timeout_seconds) * 100;

  return (
    <Modal visible transparent animationType="fade">
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.timerTrack}>
            <View style={[styles.timerFill, { width: `${pct}%` }]} />
          </View>

          <Text style={styles.title}>New ride request</Text>
          <View style={styles.routeRow}>
            <View style={[styles.dot, { backgroundColor: colors.gold }]} />
            <Text style={styles.routeText}>{offer.pickup_label}</Text>
          </View>
          <View style={styles.routeRow}>
            <View style={[styles.dot, { backgroundColor: colors.navyInk }]} />
            <Text style={styles.routeText}>{offer.destination_label}</Text>
          </View>
          <Text style={styles.fare}>GH₵{offer.fare_estimate}</Text>

          <View style={styles.actions}>
            <Button title="Decline" onPress={onDecline} variant="dangerGhost" style={styles.actionBtn} />
            <Button title={`Accept (${secondsLeft}s)`} onPress={onAccept} variant="success" style={styles.actionBtn} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(22, 35, 63, 0.55)",
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
  },
  card: {
    backgroundColor: colors.paperRaised,
    width: "100%",
    maxWidth: 380,
    borderRadius: 16,
    padding: spacing.lg,
  },
  timerTrack: { height: 4, backgroundColor: colors.line, borderRadius: 2, overflow: "hidden", marginBottom: spacing.md },
  timerFill: { height: "100%", backgroundColor: colors.gold },
  title: { fontSize: 17, fontWeight: "700", marginBottom: spacing.md, color: colors.ink },
  routeRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.sm },
  dot: { width: 8, height: 8, borderRadius: 4 },
  routeText: { fontSize: 14.5, color: colors.ink },
  fare: { fontSize: 24, fontWeight: "700", color: colors.navyInk, marginVertical: spacing.md },
  actions: { flexDirection: "row", gap: spacing.sm },
  actionBtn: { flex: 1 },
});
