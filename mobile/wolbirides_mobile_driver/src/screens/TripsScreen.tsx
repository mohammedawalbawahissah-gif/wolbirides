import { useEffect, useState } from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";
import { api, type Trip } from "../api/client";
import { Badge, EmptyState } from "../components/ui";
import { colors, spacing, typography } from "../theme";

const STATUS_TONE: Record<string, "success" | "danger" | "neutral"> = {
  completed: "success",
  cancelled: "danger",
};

function formatTime(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function TripsScreen() {
  const [trips, setTrips] = useState<Trip[] | null>(null);

  useEffect(() => {
    api.get<Trip[]>("/drivers/me/trips").then(({ data }) => setTrips(data));
  }, []);

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={typography.h1}>Your trips</Text>
        <Text style={typography.muted}>Every ride you've accepted.</Text>
      </View>

      {trips == null && <EmptyState message="Loading…" />}
      {trips && trips.length === 0 && <EmptyState message="No trips yet — accepted rides will show up here." />}

      <FlatList
        data={trips ?? []}
        keyExtractor={(t) => t.id}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.cardTop}>
              <Text style={styles.date}>{formatTime(item.requested_at)}</Text>
              <Badge label={item.status.replace(/_/g, " ")} tone={STATUS_TONE[item.status] ?? "neutral"} />
            </View>
            <Text style={styles.route}>
              {item.pickup_label || "Pickup"} → {item.destination_label || "Destination"}
            </Text>
            <Text style={styles.fare}>{item.fare_final ? `GH₵${item.fare_final}` : "—"}</Text>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  header: { padding: spacing.lg, paddingBottom: spacing.md },
  listContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl },
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
