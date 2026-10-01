import { useEffect, useState } from "react";
import { Linking, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api, type Trip } from "../api/client";
import { useTripSocket } from "../hooks/useTripSocket";
import { CheckInPrompt, PostTripCheckin, PreferenceDecision, ShareTripButtons } from "../components/PassengerExtras";
import { SOSButton } from "../components/Safety";
import { useAuth } from "../auth/AuthContext";
import PaymentStep from "../components/PaymentStep";
import { realPhone, samePhone } from "../phone";
import RatingCard from "../components/RatingCard";
import DriverCard from "../components/DriverCard";
import SupportCard from "../components/SupportCard";
import TripMapView from "../components/TripMapView";
import { Button, Card, EmptyState, ErrorBanner } from "../components/ui";
import { colors, spacing } from "../theme";
import type { RootStackScreenProps } from "../navigation/types";

/** A delivery a person on our team is arranging: what the passenger should expect. */
function arrangingText(reason: Trip["queue_reason"]) {
  switch (reason) {
    case "driver_withdrew":
    case "reassigned":
      return "Your courier can't make it, so we're finding you another. We'll tell you as soon as they're assigned.";
    case "no_courier_accepted":
      return "No rider nearby was free, so our team is finding you a courier. We'll tell you as soon as one is assigned.";
    default:
      return "Our team checks errands and vendor orders, then hands them to a courier. We'll tell you as soon as one is assigned.";
  }
}

/** Plain-words version of why a search found nobody (recorded by the server at the time). */
function noDriversText(reason: Trip["no_drivers_reason"]) {
  switch (reason) {
    case "none_online": return "No riders are online near you right now.";
    case "all_busy": return "Every nearby rider is on another trip right now.";
    case "no_delivery_couriers": return "No riders are taking deliveries right now.";
    default: return "Nearby riders didn't respond in time.";
  }
}

const STATUS_COPY: Record<Trip["status"], { label: string }> = {
  requested: { label: "Requesting" },
  matching: { label: "Finding a rider" },
  awaiting_assignment: { label: "Being arranged" },
  matched: { label: "Rider assigned" },
  driver_arriving: { label: "Rider arriving" },
  in_progress: { label: "On the way" },
  completed: { label: "Trip complete" },
  cancelled: { label: "Trip cancelled" },
  no_drivers_found: { label: "No riders available" },
};

export default function TripStatusScreen({ route, navigation }: RootStackScreenProps<"TripStatus">) {
  const { user } = useAuth();
  const { tripId } = route.params;
  const [trip, setTrip] = useState<Trip | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
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

  if (error && !trip) return <SafeAreaView style={styles.safeArea}><EmptyState message={error} /></SafeAreaView>;
  if (!trip) return <SafeAreaView style={styles.safeArea}><EmptyState message="Loading…" /></SafeAreaView>;

  const copy = STATUS_COPY[trip.status];
  const canCancel = ["requested", "matching", "awaiting_assignment", "matched", "driver_arriving"].includes(trip.status);

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.statusBanner}>
          <Text style={styles.statusLabel}>{copy.label}</Text>
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
          {trip.shareable && trip.pool_info && trip.pool_info.passenger_count > 1 && (
            <Text style={styles.routeText}>Shared ride: splitting the base fare with one other passenger.</Text>
          )}
          {trip.delivery && (
            <View style={{ marginTop: spacing.sm }}>
              {!!trip.delivery.external_courier && (
                <Text style={styles.routeText}
                  onPress={() => Linking.openURL(`tel:${trip.delivery!.external_courier!.phone}`)}>
                  Courier: {trip.delivery.external_courier.name} ({trip.delivery.external_courier.phone})
                </Text>
              )}
              {!!trip.delivery.sender_name && (
                <Text style={styles.routeText}>From: {trip.delivery.sender_name}{trip.delivery.sender_phone ? ` (${trip.delivery.sender_phone})` : ""}</Text>
              )}
              {!!trip.delivery.recipient_name && (
                <Text style={styles.routeText}>To: {trip.delivery.recipient_name}{trip.delivery.recipient_phone ? ` (${trip.delivery.recipient_phone})` : ""}</Text>
              )}
              {trip.delivery.delivery_subtype === "parcel" && (
                <Text style={styles.routeText}>Package: {trip.delivery.package_description} ({trip.delivery.package_size})</Text>
              )}
              {trip.delivery.delivery_subtype === "errand" && (
                <Text style={styles.routeText}>Task: {trip.delivery.task_description}</Text>
              )}
              {trip.delivery.delivery_subtype === "vendor_order" && (
                <>
                  {!!trip.delivery.vendor && (
                    <Text style={styles.routeText}>Vendor: {trip.delivery.vendor.name}{trip.delivery.vendor.location_label ? ` — ${trip.delivery.vendor.location_label}` : ""}</Text>
                  )}
                  <Text style={styles.routeText}>Order: {trip.delivery.task_description}</Text>
                </>
              )}
              {!!trip.delivery.spend_limit && <Text style={styles.routeText}>Spending limit: GH₵{trip.delivery.spend_limit}</Text>}
              {!!trip.delivery.pickup_code && !trip.delivery.picked_up_at && (
                <Text style={styles.routeText}>
                  Pickup code <Text style={{ fontWeight: "800", fontSize: 20, letterSpacing: 3 }}>{trip.delivery.pickup_code}</Text>
                  {"\n"}{trip.delivery.sender_phone && !samePhone(trip.delivery.sender_phone, realPhone(user))
                    ? `We've texted it to ${trip.delivery.sender_name}. The rider needs it to collect the item.`
                    : "Show the rider this code when they collect the item."}
                </Text>
              )}
              {!!trip.delivery.dropoff_code && trip.status !== "completed" && (
                <Text style={styles.routeText}>
                  Drop-off code <Text style={{ fontWeight: "800", fontSize: 20, letterSpacing: 3 }}>{trip.delivery.dropoff_code}</Text>
                  {"\n"}{trip.delivery.recipient_phone && !samePhone(trip.delivery.recipient_phone, realPhone(user))
                    ? `We've texted it to ${trip.delivery.recipient_name}. The rider needs it to finish.`
                    : "Give the rider this code when you receive it."}
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
              : trip.payment_method === "bundle" ? "your ride bundle" : "cash to rider"}
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
          <Button title={cancelling ? "Cancelling…" : trip.trip_type === "delivery" ? "Cancel delivery" : "Cancel ride"} onPress={cancelTrip} variant="danger" loading={cancelling} />
        )}

        {error && <ErrorBanner message={error} />}

        {trip.status === "awaiting_assignment" && (
          <Text style={styles.routeText}>{arrangingText(trip.queue_reason)}</Text>
        )}

        {trip.status === "no_drivers_found" && (
          <>
            <Text style={styles.routeText}>{noDriversText(trip.no_drivers_reason)}</Text>
            <Button title="Try again" onPress={() => navigation.goBack()} variant="primary" />
          </>
        )}

        {trip.status === "completed" && <PostTripCheckin tripId={trip.id} />}

        {trip.status === "completed" && !["organization", "voucher", "bundle"].includes(trip.payment_method ?? "") && (
          <PaymentStep tripId={trip.id} fare={trip.fare_final || trip.fare_quote?.total || ""}
            preferredMethod={trip.payment_method === "momo" || trip.payment_method === "hubtel" ? trip.payment_method : undefined} />
        )}

        {trip.fare_quote && (
          <Button title="Ask about this fare" variant="ghost" onPress={() => navigation.navigate("Assistant", {
            tripId: trip.id, label: `${trip.pickup_label || "Pickup"} to ${trip.destination_label || "destination"}`,
            message: "Can you explain how this trip's fare was worked out?" })} />
        )}

        {trip.status === "completed" && !ratingSubmitted && !trip.rated_by_me && (
          <RatingCard tripId={trip.id} driverName={trip.driver_detail?.name} onDone={() => setRatingSubmitted(true)} />
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
});
