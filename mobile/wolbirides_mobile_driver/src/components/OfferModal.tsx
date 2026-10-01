import { useEffect, useState } from "react";
import { Modal, StyleSheet, Text, View } from "react-native";
import { Button } from "../components/ui";
import { colors, spacing } from "../theme";
import type { RideOffer } from "../api/client";

/** The offer's own details, shared between the countdown modal and the persistent Requests
 * screen — whichever a driver sees it through, it should read exactly the same. */
export function OfferBody({ offer }: { offer: RideOffer }) {
  return (
    <>
      <Text style={styles.title}>
        {(offer.trip_type ?? offer.kind) === "delivery" ? "New delivery request"
          : offer.pool_legs ? "Shared ride: 2 passengers" : "New ride request"}
      </Text>
      {(offer.trip_type ?? offer.kind) === "delivery" && (
        <Text style={styles.tag}>
          {offer.delivery_subtype === "errand" && `Errand: ${offer.task_description ?? ""}`}
          {offer.delivery_subtype === "vendor_order" && `Vendor order${offer.vendor_name ? ` from ${offer.vendor_name}` : ""}: ${offer.task_description ?? ""}`}
          {(!offer.delivery_subtype || offer.delivery_subtype === "parcel") && !!offer.package_description &&
            `Package: ${offer.package_description}${offer.package_size ? ` (${offer.package_size})` : ""}`}
          {!!offer.spend_limit && ` · Spend up to GH₵${offer.spend_limit}`}
        </Text>
      )}
      {offer.pool_legs?.map((leg, i) => (
        <Text key={`${leg.type}-${leg.trip_id}`} style={{ fontSize: 13.5, color: colors.ink, marginBottom: 2 }}>
          {i + 1}. {leg.type === "pickup" ? "Pick up" : "Drop off"} {leg.first_name}: {leg.label || "—"}
        </Text>
      ))}
      <View style={styles.routeRow}>
        <View style={[styles.dot, { backgroundColor: colors.gold }]} />
        <Text style={styles.routeText}>{offer.pickup_label}</Text>
      </View>
      <View style={styles.routeRow}>
        <View style={[styles.dot, { backgroundColor: colors.navyInk }]} />
        <Text style={styles.routeText}>{offer.destination_label}</Text>
      </View>
      <Text style={styles.fare}>GH₵{offer.fare_estimate}</Text>
    </>
  );
}

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

          <OfferBody offer={offer} />

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
  tag: { alignSelf: "flex-start", fontSize: 13, backgroundColor: colors.warningBg, color: colors.warning, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, marginBottom: 6, overflow: "hidden" },
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
