import { useEffect, useState } from "react";
import { Linking, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api, type Trip } from "../api/client";
import { useTripSocket } from "../hooks/useTripSocket";
import { Button, Card, ErrorBanner } from "../components/ui";
import { colors, spacing } from "../theme";
import type { RootStackScreenProps } from "../navigation/types";

const STATUS_COPY: Record<string, string> = {
  matched: "Head to the pickup point",
  driver_arriving: "Arriving at pickup",
  in_progress: "Trip in progress",
};

export default function ActiveTripScreen({ route, navigation }: RootStackScreenProps<"ActiveTrip">) {
  const { tripId } = route.params;
  const [trip, setTrip] = useState<Trip | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { lastMessage } = useTripSocket(tripId);

  function load() {
    api.get<Trip>(`/trips/${tripId}`).then(({ data }) => setTrip(data));
  }

  useEffect(load, [tripId]);
  useEffect(() => {
    if (lastMessage) load();
  }, [lastMessage]);

  useEffect(() => {
    if (trip && (trip.status === "completed" || trip.status === "cancelled")) {
      navigation.replace("MainTabs");
    }
  }, [trip, navigation]);

  async function startTrip() {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/trips/${tripId}/start`);
      load();
    } catch {
      setError("Couldn't start the trip.");
    } finally {
      setBusy(false);
    }
  }

  async function completeTrip() {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/trips/${tripId}/complete`);
      navigation.replace("MainTabs");
    } catch {
      setError("Couldn't complete the trip.");
    } finally {
      setBusy(false);
    }
  }

  async function cancelTrip() {
    setBusy(true);
    try {
      await api.post(`/trips/${tripId}/cancel`, { reason: "Driver cancelled" });
      navigation.replace("MainTabs");
    } finally {
      setBusy(false);
    }
  }

  function openNavigation(lat: string, lng: string) {
    Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`);
  }

  if (!trip) return null;

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.statusBanner}>
          <Text style={styles.statusLabel}>{STATUS_COPY[trip.status] || trip.status}</Text>
        </View>

        <Card style={styles.detailCard}>
          <View style={styles.routeRow}>
            <View style={[styles.dot, { backgroundColor: colors.gold }]} />
            <Text style={styles.routeText}>{trip.pickup_label || "Pickup"}</Text>
          </View>
          <View style={styles.routeRow}>
            <View style={[styles.dot, { backgroundColor: colors.navyInk }]} />
            <Text style={styles.routeText}>{trip.destination_label || "Destination"}</Text>
          </View>
          <Text style={styles.fareText}>{trip.fare_quote ? `GH₵${trip.fare_quote.total}` : "—"}</Text>
        </Card>

        <Button
          title="Navigate with Google Maps"
          onPress={() =>
            openNavigation(
              trip.status === "in_progress" ? trip.destination_lat : trip.pickup_lat,
              trip.status === "in_progress" ? trip.destination_lng : trip.pickup_lng
            )
          }
          variant="primary"
        />

        {error && <ErrorBanner message={error} />}

        {(trip.status === "matched" || trip.status === "driver_arriving") && (
          <Button title={busy ? "Starting…" : "Start trip (arrived at pickup)"} onPress={startTrip} variant="gold" loading={busy} />
        )}

        {trip.status === "in_progress" && (
          <Button title={busy ? "Completing…" : "Complete trip"} onPress={completeTrip} variant="success" loading={busy} />
        )}

        <Button title="Cancel trip" onPress={cancelTrip} variant="dangerGhost" disabled={busy} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.paper },
  content: { padding: spacing.lg, gap: spacing.md },
  statusBanner: { backgroundColor: colors.navyInk, borderRadius: 14, padding: spacing.lg },
  statusLabel: { color: "#FFFFFF", fontSize: 18, fontWeight: "700" },
  detailCard: { gap: spacing.sm },
  routeRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  dot: { width: 8, height: 8, borderRadius: 4 },
  routeText: { fontSize: 14, color: colors.ink },
  fareText: { fontSize: 17, fontWeight: "700", color: colors.navyInk, marginTop: spacing.xs },
});
