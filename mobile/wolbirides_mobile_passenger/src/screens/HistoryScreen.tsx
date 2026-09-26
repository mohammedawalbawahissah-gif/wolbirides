import { FlatList, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useTripHistory } from "../hooks/useTripHistory";
import { Badge, EmptyState } from "../components/ui";
import { colors, spacing, typography } from "../theme";
import type { MainTabScreenProps } from "../navigation/types";

const STATUS_TONE: Record<string, "success" | "danger" | "neutral"> = {
  completed: "success",
  cancelled: "danger",
  no_drivers_found: "danger",
};

function formatTime(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function HistoryScreen({ navigation }: MainTabScreenProps<"History">) {
  const { trips, hasMore, loadingMore, loadMore } = useTripHistory("/passengers/me/rides");

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={typography.h1}>Your rides</Text>
        <Text style={typography.muted}>Past trips and receipts.</Text>
      </View>

      {trips == null && <EmptyState message="Loading…" />}
      {trips && trips.length === 0 && <EmptyState message="No rides yet — your first trip will show up here." />}

      <FlatList
        ListFooterComponent={hasMore ? (
          <TouchableOpacity onPress={loadMore} disabled={loadingMore} accessibilityRole="button"
            style={{ alignItems: "center", paddingVertical: 16 }}>
            <Text style={{ fontWeight: "700", textDecorationLine: "underline" }}>
              {loadingMore ? "Loading…" : "Load older trips"}
            </Text>
          </TouchableOpacity>
        ) : null}
        data={trips ?? []}
        keyExtractor={(t) => t.id}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.card}
            onPress={() => navigation.navigate("TripStatus", { tripId: item.id })}
          >
            <View style={styles.cardTop}>
              <Text style={styles.date}>{formatTime(item.requested_at)}</Text>
              <Badge label={item.status.replace(/_/g, " ")} tone={STATUS_TONE[item.status] ?? "neutral"} />
            </View>
            <Text style={styles.route}>
              {item.pickup_label || "Pickup"} → {item.destination_label || "Destination"}
            </Text>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={styles.fare}>
                {item.fare_final ? `GH₵${item.fare_final}` : item.fare_quote ? `GH₵${item.fare_quote.total}` : "—"}
              </Text>
              {/* WR-13: one-tap re-request. Pre-fills the route; the rider still confirms. */}
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Ride again"
                onPress={() => navigation.navigate("Ride", { rebook: {
                  pickup: { lat: Number(item.pickup_lat), lng: Number(item.pickup_lng), label: item.pickup_label },
                  destination: { lat: Number(item.destination_lat), lng: Number(item.destination_lng), label: item.destination_label },
                } })}
                style={{ paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: "#C9A227" }}>
                <Text style={{ fontWeight: "700", fontSize: 13 }}>Ride again</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  header: { padding: spacing.lg, paddingBottom: spacing.md },
  listContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl, gap: spacing.sm },
  card: {
    backgroundColor: colors.paperRaised,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.xs },
  date: { fontSize: 12.5, color: colors.inkMuted },
  route: { fontSize: 14, color: colors.ink, marginBottom: spacing.xs },
  fare: { fontSize: 15, fontWeight: "700", color: colors.ink },
});
