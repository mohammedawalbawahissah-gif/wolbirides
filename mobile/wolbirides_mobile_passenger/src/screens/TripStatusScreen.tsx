import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api, type Trip } from "../api/client";
import { useTripSocket } from "../hooks/useTripSocket";
import { CheckInPrompt, PostTripCheckin, PreferenceDecision, ShareTripButtons } from "../components/PassengerExtras";
import { SOSButton } from "../components/Safety";
import PaymentStep from "../components/PaymentStep";
import DriverCard from "../components/DriverCard";
import SupportCard from "../components/SupportCard";
import TripMapView from "../components/TripMapView";
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

        {trip.driver_detail && ["matched", "driver_arriving", "in_progress"].includes(trip.status) && (
          <DriverCard driver={trip.driver_detail} />
        )}
        {!["completed", "cancelled", "no_drivers_found"].includes(trip.status) && (
          <TripMapView
            pickup={{ lat: Number(trip.pickup_lat), lng: Number(trip.pickup_lng) }}
            destination={{ lat: Number(trip.destination_lat), lng: Number(trip.destination_lng) }}
            driver={trip.driver_detail?.current_lat && trip.driver_detail?.current_lng
              ? { lat: Number(trip.driver_detail.current_lat), lng: Number(trip.driver_detail.current_lng) } : null}
          />
        )}

        {trip.status === "in_progress" && <CheckInPrompt tripId={trip.id} refreshKey={lastMessage} />}
        {trip.status === "matching" && <PreferenceDecision tripId={trip.id} status={trip.preference_status} onDecided={load} />}

        <Card style={styles.detailCard}>
          <View style={styles.routeRow}>
            <View style={[styles.dot, { backgroundColor: colors.gold }]} />
            <Text style={styles.routeText}>{trip.pickup_label || "Pickup"}</Text>
          </View>
          <View style={styles.routeRow}>
            <View style={[styles.dot, { backgroundColor: colors.navyInk }]} />
            <Text style={styles.routeText}>{trip.destination_label || "Destination"}</Text>
          </View>
          {trip.shareable && (
            <Text style={styles.routeText}>
              {trip.pool_info && trip.pool_info.rider_count > 1
                ? "Shared ride: you're splitting the base fare with one other rider."
                : "Shared ride: if someone nearby is going your way, you'll pay less. Otherwise, the normal fare."}
            </Text>
          )}
          {trip.delivery && (
            <View style={{ marginTop: spacing.sm }}>
              <Text style={styles.routeText}>Package: {trip.delivery.package_description} ({trip.delivery.package_size})</Text>
              <Text style={styles.routeText}>To: {trip.delivery.recipient_name}</Text>
              {!!trip.delivery.pickup_code && !trip.delivery.picked_up_at && (
                <Text style={styles.routeText}>
                  Pickup code <Text style={{ fontWeight: "800", fontSize: 20, letterSpacing: 3 }}>{trip.delivery.pickup_code}</Text>
                  {"\n"}Show this to the driver when they collect the package.
                </Text>
              )}
              {!!trip.delivery.dropoff_code && trip.status !== "completed" && (
                <Text style={styles.routeText}>
                  Drop-off code <Text style={{ fontWeight: "800", fontSize: 20, letterSpacing: 3 }}>{trip.delivery.dropoff_code}</Text>
                  {"\n"}We've texted it to {trip.delivery.recipient_name}. The driver needs it to finish.
                </Text>
              )}
            </View>
          )}
          {Number(trip.fare_quote?.discount ?? 0) > 0 && (
            <Text style={styles.routeText}>{trip.fare_quote?.discount_reason || "Discount"}: −GH₵{trip.fare_quote?.discount}</Text>
          )}
          <Text style={styles.routeText}>
            Paying with {trip.payment_method === "organization" ? trip.organization_name
              : trip.payment_method === "voucher" ? `a voucher from ${trip.organization_name}`
              : trip.payment_method === "bundle" ? "your ride bundle" : "cash to driver"}
          </Text>
          <Text style={styles.fareText}>
            {trip.fare_final ? `GH₵${trip.fare_final}` : trip.fare_quote ? `GH₵${trip.fare_quote.total} est.` : "—"}
          </Text>
        </Card>

        {["matched", "driver_arriving", "in_progress"].includes(trip.status) && <SOSButton tripId={trip.id} />}
        {["matching", "matched", "driver_arriving", "in_progress"].includes(trip.status) && (
          <ShareTripButtons tripId={trip.id} />
        )}

        {canCancel && (
          <Button title={cancelling ? "Cancelling…" : "Cancel ride"} onPress={cancelTrip} variant="danger" loading={cancelling} />
        )}

        {error && <ErrorBanner message={error} />}

        {trip.status === "no_drivers_found" && (
          <Button title="Try again" onPress={() => navigation.goBack()} variant="primary" />
        )}

        {trip.status === "completed" && <PostTripCheckin tripId={trip.id} />}

        {trip.status === "completed" && ["cash", "momo", undefined].includes(trip.payment_method) && (
          <PaymentStep tripId={trip.id} fare={trip.fare_final || trip.fare_quote?.total || ""} />
        )}

        {trip.fare_quote && (
          <Button title="Ask about this fare" variant="ghost" onPress={() => navigation.navigate("Assistant", {
            tripId: trip.id, label: `${trip.pickup_label || "Pickup"} to ${trip.destination_label || "destination"}`,
            message: "Can you explain how this trip's fare was worked out?" })} />
        )}

        {trip.status === "completed" && !ratingSubmitted && !trip.rated_by_me && (
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

        {["completed", "cancelled", "no_drivers_found"].includes(trip.status) && <SupportCard tripId={trip.id} />}

        {((trip.status === "completed" && (ratingSubmitted || trip.rated_by_me)) || trip.status === "cancelled") && (
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
