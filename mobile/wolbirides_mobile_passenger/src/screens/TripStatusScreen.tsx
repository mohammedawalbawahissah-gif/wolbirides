import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api, type Trip } from "../api/client";
import { useTripSocket } from "../hooks/useTripSocket";
import { Button, Card, EmptyState, ErrorBanner } from "../components/ui";
import { colors, spacing } from "../theme";
import type { RootStackScreenProps } from "../navigation/types";

const STATUS_COPY: Record<Trip["status"], { label: string; detail: string }> = {
  requested: { label: "Requesting", detail: "Setting up your fare and confirming the zone." },
  matching: { label: "Finding a driver", detail: "Offering your ride to the nearest available driver." },
  matched: { label: "Driver assigned", detail: "Your driver has accepted and is heading your way." },
  driver_arriving: { label: "Driver arriving", detail: "Your driver is close by." },
  in_progress: { label: "On the way", detail: "Trip in progress — sit back, you're on your way." },
  completed: { label: "Trip complete", detail: "Thanks for riding with WolbiRides." },
  cancelled: { label: "Trip cancelled", detail: "This trip was cancelled." },
  no_drivers_found: { label: "No drivers available", detail: "No founding drivers were online in this zone just now." },
};

export default function TripStatusScreen({ route, navigation }: RootStackScreenProps<"TripStatus">) {
  const { tripId } = route.params;
  const [trip, setTrip] = useState<Trip | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [rating, setRating] = useState<number | null>(null);
  const [ratingSubmitted, setRatingSubmitted] = useState(false);

  const { lastMessage } = useTripSocket(tripId);

  function load() {
    api
      .get<Trip>(`/trips/${tripId}`)
      .then(({ data }) => setTrip(data))
      .catch(() => setError("Couldn't load this trip."));
  }

  useEffect(load, [tripId]);
  useEffect(() => {
    if (lastMessage) load();
  }, [lastMessage]);

  async function cancelTrip() {
    setCancelling(true);
    try {
      await api.post(`/trips/${tripId}/cancel`, { reason: "Passenger cancelled" });
      load();
    } catch {
      setError("Couldn't cancel — try again.");
    } finally {
      setCancelling(false);
    }
  }

  async function submitRating() {
    if (rating == null) return;
    try {
      await api.post(`/trips/${tripId}/rating`, { score: rating, issue_tags: [], comment: "" });
      setRatingSubmitted(true);
    } catch {
      setError("Couldn't submit your rating.");
    }
  }

  if (error && !trip) return <SafeAreaView style={styles.safeArea}><EmptyState message={error} /></SafeAreaView>;
  if (!trip) return <SafeAreaView style={styles.safeArea}><EmptyState message="Loading…" /></SafeAreaView>;

  const copy = STATUS_COPY[trip.status];
  const canCancel = ["requested", "matching", "matched", "driver_arriving"].includes(trip.status);

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.statusBanner}>
          <Text style={styles.statusLabel}>{copy.label}</Text>
          <Text style={styles.statusDetail}>{copy.detail}</Text>
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
          <Text style={styles.fareText}>
            {trip.fare_final ? `GH₵${trip.fare_final}` : trip.fare_quote ? `GH₵${trip.fare_quote.total} est.` : "—"}
          </Text>
        </Card>

        {canCancel && (
          <Button title={cancelling ? "Cancelling…" : "Cancel ride"} onPress={cancelTrip} variant="danger" loading={cancelling} />
        )}

        {error && <ErrorBanner message={error} />}

        {trip.status === "no_drivers_found" && (
          <Button title="Try again" onPress={() => navigation.goBack()} variant="primary" />
        )}

        {trip.status === "completed" && !ratingSubmitted && (
          <Card style={styles.ratingCard}>
            <Text style={styles.ratingTitle}>How was your ride?</Text>
            <View style={styles.starsRow}>
              {[1, 2, 3, 4, 5].map((n) => (
                <TouchableOpacity key={n} onPress={() => setRating(n)}>
                  <Text style={[styles.star, rating != null && n <= rating && styles.starFilled]}>★</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Button title="Submit rating" onPress={submitRating} variant="gold" disabled={rating == null} />
          </Card>
        )}

        {((trip.status === "completed" && ratingSubmitted) || trip.status === "cancelled") && (
          <Button title="Book another ride" onPress={() => navigation.goBack()} variant="primary" />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.paper },
  content: { padding: spacing.lg, gap: spacing.md },
  statusBanner: {
    backgroundColor: colors.navyInk,
    borderRadius: 14,
    padding: spacing.lg,
  },
  statusLabel: { color: "#FFFFFF", fontSize: 20, fontWeight: "700", marginBottom: spacing.xs },
  statusDetail: { color: "#C7CCD8", fontSize: 13.5, lineHeight: 19 },
  detailCard: { gap: spacing.sm },
  routeRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  dot: { width: 8, height: 8, borderRadius: 4 },
  routeText: { fontSize: 14, color: colors.ink },
  fareText: { fontSize: 17, fontWeight: "700", color: colors.navyInk, marginTop: spacing.xs },
  ratingCard: { alignItems: "center" },
  ratingTitle: { fontSize: 15, fontWeight: "600", marginBottom: spacing.md },
  starsRow: { flexDirection: "row", gap: 6, marginBottom: spacing.md },
  star: { fontSize: 30, color: colors.line },
  starFilled: { color: colors.gold },
});
