import { useEffect, useState } from "react";
import { Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api, type Trip } from "../api/client";
import { useTripSocket } from "../hooks/useTripSocket";
import { Button, Card, ErrorBanner, FieldLabel, TextField } from "../components/ui";
import { SOSButton } from "../components/Safety";
import DriverPaymentPanel from "../components/DriverPaymentPanel";
import PostTripCheckin from "../components/PostTripCheckin";
import RateRider from "../components/RateRider";
import SupportCard from "../components/SupportCard";
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
    if (!trip?.pool_info?.open) return;
    const id = setInterval(load, 15000); // riders may join a shared ride until the first pickup
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip?.pool_info?.open, tripId]);
  useEffect(() => {
    if (lastMessage) load();
  }, [lastMessage]);

  useEffect(() => {
    if (trip && trip.status === "cancelled") {
      navigation.replace("MainTabs");
    }
  }, [trip, navigation]);

  const [code, setCode] = useState("");
  const isDelivery = trip?.trip_type === "delivery";

  // Rides: start/complete. Deliveries (WR-23): pickup confirmed with the sender's code,
  // drop-off with the recipient's. Neither code is ever sent to the driver's app.
  async function act(path: "start" | "complete" | "confirm-pickup" | "confirm-dropoff") {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/trips/${tripId}/${path}`, path.startsWith("confirm") ? { code: code.trim() } : {});
      setCode("");
      load(); // after completion, stay: the payment panel says whether to collect cash
    } catch (err: any) {
      setError(err?.response?.data?.detail || "That didn't work. Try again.");
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

        {trip.pool_info?.stops && trip.pool_info.stops.length > 2 && (
          <Card style={[styles.detailCard, { borderLeftWidth: 4, borderLeftColor: colors.gold }]}>
            <Text style={styles.routeText}>Shared ride: {trip.pool_info.rider_count} riders, in this order</Text>
            {trip.pool_info.stops.map((stop, i) => (
              <TouchableOpacity key={`${stop.type}-${stop.trip_id}`}
                onPress={() => stop.trip_id !== trip.id && navigation.replace("ActiveTrip", { tripId: stop.trip_id })}
                style={{ paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: colors.line }}>
                <Text style={{ color: stop.done ? colors.inkMuted : colors.ink, fontWeight: stop.trip_id === trip.id && !stop.done ? "700" : "500",
                  textDecorationLine: stop.done ? "line-through" : "none" }}>
                  {i + 1}. {stop.type === "pickup" ? "Pick up" : "Drop off"} {stop.first_name}
                </Text>
                <Text style={styles.payNote}>{stop.label || (stop.type === "pickup" ? "Pickup point" : "Destination")}</Text>
              </TouchableOpacity>
            ))}
          </Card>
        )}

        <Card style={styles.detailCard}>
          <View style={styles.routeRow}>
            <View style={[styles.dot, { backgroundColor: colors.gold }]} />
            <Text style={styles.routeText}>{trip.pickup_label || "Pickup"}</Text>
          </View>
          <View style={styles.routeRow}>
            <View style={[styles.dot, { backgroundColor: colors.navyInk }]} />
            <Text style={styles.routeText}>{trip.destination_label || "Destination"}</Text>
          </View>
          <Text style={styles.fareText}>{trip.fare_final ? `GH₵${trip.fare_final}` : trip.pool_seat_fare ? `GH₵${trip.pool_seat_fare}`
            : trip.fare_quote ? `GH₵${trip.fare_quote.total}` : "—"}</Text>
          <Text style={styles.payNote}>
            {trip.payment_method === "cash" || !trip.payment_method
              ? "Collect cash from the passenger"
              : "Already paid. Don't collect cash; it's in your weekly payout."}
          </Text>
        </Card>

        {trip.delivery && (
          <Card style={styles.detailCard}>
            <Text style={styles.routeText}>Package: {trip.delivery.package_description} ({trip.delivery.package_size})</Text>
            <Text style={styles.routeText} onPress={() => Linking.openURL(`tel:${trip.delivery!.recipient_phone}`)}>
              Deliver to {trip.delivery.recipient_name} ({trip.delivery.recipient_phone})
            </Text>
          </Card>
        )}

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

        {(trip.status === "matched" || trip.status === "driver_arriving") && !isDelivery && (
          <Button title={busy ? "Starting…" : "Start trip (rider on board)"} onPress={() => act("start")} variant="gold" loading={busy} />
        )}
        {(trip.status === "matched" || trip.status === "driver_arriving" || trip.status === "in_progress") && isDelivery && (
          <View style={{ marginBottom: spacing.sm }}>
            <FieldLabel>{trip.status === "in_progress" ? "Recipient's 4-digit code" : "Sender's 4-digit pickup code"}</FieldLabel>
            <TextField value={code} onChangeText={(t) => setCode(t.replace(/\D/g, ""))}
              keyboardType="number-pad" maxLength={4} placeholder="0000" />
            <Button title={busy ? "Confirming…" : trip.status === "in_progress" ? "Confirm drop-off" : "Confirm pickup"}
              onPress={() => act(trip.status === "in_progress" ? "confirm-dropoff" : "confirm-pickup")}
              variant={trip.status === "in_progress" ? "success" : "gold"} loading={busy} disabled={code.length !== 4} />
          </View>
        )}
        {trip.status === "in_progress" && !isDelivery && (
          <Button title={busy ? "Completing…" : "Complete trip"} onPress={() => act("complete")} variant="success" loading={busy} />
        )}

        <Button title="Cancel trip" onPress={cancelTrip} variant="dangerGhost" disabled={busy} />

        {["matched", "driver_arriving", "in_progress"].includes(trip.status) && <SOSButton tripId={trip.id} />}
        {trip.status === "completed" && <RateRider tripId={trip.id} alreadyRated={trip.rated_by_me} />}
        {trip.status === "completed" && <PostTripCheckin tripId={trip.id} />}
        {trip.status === "completed" && <SupportCard tripId={trip.id} />}
        {trip.status === "completed" && (
          <DriverPaymentPanel tripId={trip.id} fare={trip.fare_final || trip.fare_quote?.total || ""}
            paymentMethod={trip.payment_method} onDone={() => navigation.replace("MainTabs")} />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  payNote: { fontSize: 13, color: colors.inkMuted, marginTop: spacing.xs },
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
