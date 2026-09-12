import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { api, type ServiceZone } from "../api/client";
import { Button, Card, EmptyState, ErrorBanner } from "../components/ui";
import PinPickerMap, { type LatLng } from "../components/PinPickerMap";
import { colors, spacing, typography } from "../theme";
import type { MainTabScreenProps } from "../navigation/types";

function haversineKm(a: LatLng, b: LatLng) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export default function HomeScreen({ navigation }: MainTabScreenProps<"Ride">) {
  const [zone, setZone] = useState<ServiceZone | null>(null);
  const [pickup, setPickup] = useState<LatLng | null>(null);
  const [destination, setDestination] = useState<LatLng | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<ServiceZone[]>("/zones").then(({ data }) => {
      if (data.length > 0) setZone(data[0]);
    });
  }, []);

  const distanceKm = pickup && destination ? haversineKm(pickup, destination) : null;
  const fareEstimate =
    zone && distanceKm != null ? Number(zone.base_fare) + distanceKm * Number(zone.per_km_rate) : null;

  async function requestRide() {
    if (!zone || !pickup || !destination || distanceKm == null) return;
    setRequesting(true);
    setError(null);
    try {
      const { data } = await api.post("/trips", {
        zone_id: zone.id,
        pickup_lat: pickup.lat,
        pickup_lng: pickup.lng,
        pickup_label: "Pickup",
        destination_lat: destination.lat,
        destination_lng: destination.lng,
        destination_label: "Destination",
        distance_km: distanceKm.toFixed(2),
      });
      navigation.navigate("TripStatus", { tripId: data.id });
    } catch {
      setError("Couldn't request a ride right now. Try again in a moment.");
    } finally {
      setRequesting(false);
    }
  }

  if (!zone) {
    return <EmptyState message="No active service zone yet — check back once the pilot zone is live." />;
  }

  const mapCenter: LatLng = {
    lat: (zone.boundary.min_lat + zone.boundary.max_lat) / 2,
    lng: (zone.boundary.min_lng + zone.boundary.max_lng) / 2,
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={typography.h1}>Where to?</Text>
      <Text style={[typography.muted, styles.subtitle]}>{zone.name}</Text>

      <PinPickerMap center={mapCenter} value={pickup} onChange={setPickup} label="Pickup" />
      <PinPickerMap center={mapCenter} value={destination} onChange={setDestination} label="Destination" />

      {fareEstimate != null && (
        <Card style={styles.fareCard}>
          <View>
            <Text style={styles.fareLabel}>Estimated fare</Text>
            <Text style={styles.fareValue}>GH₵{fareEstimate.toFixed(2)}</Text>
          </View>
          <Text style={styles.fareDistance}>{distanceKm!.toFixed(1)} km</Text>
        </Card>
      )}

      {error && <ErrorBanner message={error} />}

      <Button
        title={requesting ? "Requesting…" : "Request WolbiRide"}
        onPress={requestRide}
        variant="gold"
        disabled={!pickup || !destination}
        loading={requesting}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  content: { padding: spacing.lg, paddingBottom: spacing.xl },
  subtitle: { marginBottom: spacing.lg },
  fareCard: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.md,
  },
  fareLabel: { fontSize: 12.5, color: colors.inkMuted, fontWeight: "500" },
  fareValue: { fontSize: 22, fontWeight: "700", color: colors.navyInk },
  fareDistance: { fontSize: 13.5, color: colors.inkMuted, fontWeight: "600" },
});
