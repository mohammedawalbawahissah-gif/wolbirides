import { useState } from "react";
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import RatingCard from "../components/RatingCard";
import { EmptyState } from "../components/ui";
import { useTripHistory } from "../hooks/useTripHistory";
import { colors, spacing, typography } from "../theme";
import type { RootStackScreenProps } from "../navigation/types";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Completed trips you haven't rated yet — for when the in-app prompt was missed. */
export default function RateDriverScreen({ navigation }: RootStackScreenProps<"RateDriver">) {
  const { trips, hasMore, loadingMore, loadMore } = useTripHistory("/passengers/me/rides");
  const [rated, setRated] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);

  const pending = (trips ?? []).filter((t) => t.status === "completed" && !t.rated_by_me && !rated.has(t.id));

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={navigation.goBack} accessibilityLabel="Back"><Text style={styles.back}>‹ Back</Text></TouchableOpacity>
        <Text style={typography.h1}>Rate Rider</Text>
        <View style={{ width: 60 }} />
      </View>
      <Text style={[typography.muted, styles.subtitle]}>Completed trips you haven't rated yet.</Text>

      {trips == null && <EmptyState message="Loading…" />}
      {trips != null && pending.length === 0 && <EmptyState message="You're all caught up — no trips waiting for a rating." />}

      <FlatList
        data={pending}
        keyExtractor={(t) => t.id}
        contentContainerStyle={styles.list}
        ListFooterComponent={hasMore ? (
          <TouchableOpacity onPress={loadMore} disabled={loadingMore} style={{ alignItems: "center", paddingVertical: 16 }}>
            <Text style={{ fontWeight: "700", textDecorationLine: "underline" }}>{loadingMore ? "Loading…" : "Load older trips"}</Text>
          </TouchableOpacity>
        ) : null}
        renderItem={({ item }) => (
          open === item.id ? (
            <RatingCard tripId={item.id} driverName={item.driver_detail?.name}
              onDone={() => { setRated((s) => new Set(s).add(item.id)); setOpen(null); }} />
          ) : (
            <TouchableOpacity style={styles.row} onPress={() => setOpen(item.id)}>
              <View style={{ flex: 1 }}>
                <Text style={styles.route}>{item.pickup_label || "Pickup"} → {item.destination_label || "Destination"}</Text>
                <Text style={styles.meta}>{formatDate(item.requested_at)}{item.driver_detail?.name ? ` · ${item.driver_detail.name}` : ""}</Text>
              </View>
              <Text style={styles.cta}>Rate ›</Text>
            </TouchableOpacity>
          )
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  back: { color: colors.navyInk, fontSize: 16, width: 60 },
  subtitle: { paddingHorizontal: spacing.md, marginBottom: spacing.sm },
  list: { padding: spacing.md, gap: spacing.sm },
  row: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: spacing.md,
    backgroundColor: colors.paperRaised, borderRadius: 12, marginBottom: spacing.sm,
  },
  route: { fontWeight: "600", fontSize: 14.5, color: colors.ink },
  meta: { fontSize: 12.5, color: colors.inkMuted, marginTop: 2 },
  cta: { color: colors.navyInk, fontWeight: "700", fontSize: 14 },
});
