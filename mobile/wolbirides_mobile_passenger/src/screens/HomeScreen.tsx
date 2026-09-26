import { useEffect, useState } from "react";
import { Linking, ScrollView, StyleSheet, Text, View } from "react-native";
import { api, type ServiceZone } from "../api/client";
import { Button, Card, EmptyState, ErrorBanner } from "../components/ui";
import PinPickerMap, { type LatLng } from "../components/PinPickerMap";
import { SuggestedRideCard, type SuggestedRide } from "../components/PassengerExtras";
import QuickPlaces, { type PickedPlace } from "../components/QuickPlaces";
import RideOptions, { DEFAULT_RIDE_OPTIONS, deliveryIsComplete, rideOptionsToRequest, type RideOptionsValue } from "../components/RideOptions";
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

export default function HomeScreen({ navigation, route }: MainTabScreenProps<"Ride">) {
  const [zone, setZone] = useState<ServiceZone | null>(null);
  const [pickup, setPickup] = useState<LatLng | null>(null);
  const [destination, setDestination] = useState<LatLng | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [options, setOptions] = useState<RideOptionsValue>(DEFAULT_RIDE_OPTIONS);
  const [labels, setLabels] = useState<{ pickup: string; destination: string }>({ pickup: "Pickup", destination: "Destination" });
  // Saved-place ids go with the request only while the pin is still that saved place.
  const [savedIds, setSavedIds] = useState<{ pickup?: string; destination?: string }>({});

  function pickPlace(which: "pickup" | "destination", place: PickedPlace) {
    if (which === "pickup") setPickup({ lat: place.lat, lng: place.lng });
    else setDestination({ lat: place.lat, lng: place.lng });
    setLabels((l) => ({ ...l, [which]: place.label }));
    setSavedIds((ids) => ({ ...ids, [which]: place.savedAddressId }));
  }

  function useSuggestion(s: SuggestedRide) {
    setPickup({ lat: Number(s.pickup_lat), lng: Number(s.pickup_lng) });
    setDestination({ lat: Number(s.destination_lat), lng: Number(s.destination_lng) });
    setLabels({ pickup: s.pickup_label, destination: s.destination_label });
  }

  useEffect(() => {
    api.get<ServiceZone[]>("/zones").then(({ data }) => {
      if (data.length > 0) setZone(data[0]);
    });
  }, []);

  const distanceKm = pickup && destination ? haversineKm(pickup, destination) : null;
  const baseEstimate =
    zone && distanceKm != null
      ? Number(zone.base_fare) + distanceKm * Number(zone.per_km_rate) +
        (options.kind === "delivery" ? Number(zone.delivery_surcharge ?? 0) : 0)
      : null;
  // Shared-ride prices are only known once someone pairs with you, so this is the most you'd pay.
  const fareEstimate = baseEstimate != null ? Math.max(baseEstimate - options.promo_discount, 0) : null;

  useEffect(() => {
    const rebook = route.params?.rebook;
    if (!rebook) return;
    setPickup({ lat: rebook.pickup.lat, lng: rebook.pickup.lng });
    setDestination({ lat: rebook.destination.lat, lng: rebook.destination.lng });
    setLabels({ pickup: rebook.pickup.label || "Pickup", destination: rebook.destination.label || "Destination" });
    navigation.setParams({ rebook: undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.params?.rebook]);

  // WR-24: the same sponsored placements for everyone in the zone, always labelled.
  const [placements, setPlacements] = useState<{ id: string; title: string; description: string; sponsor_name: string; link_url: string }[]>([]);
  useEffect(() => {
    if (zone) api.get(`/placements/active?zone_id=${zone.id}`).then(({ data }) => setPlacements(data)).catch(() => {});
  }, [zone]);

  async function requestRide() {
    if (!zone || !pickup || !destination || distanceKm == null) return;
    setRequesting(true);
    setError(null);
    try {
      const { data } = await api.post("/trips", {
        zone_id: zone.id,
        pickup_lat: pickup.lat,
        pickup_lng: pickup.lng,
        pickup_label: labels.pickup,
        destination_lat: destination.lat,
        destination_lng: destination.lng,
        destination_label: labels.destination,
        distance_km: distanceKm.toFixed(2),
        pickup_saved_address_id: savedIds.pickup,
        destination_saved_address_id: savedIds.destination,
        ...rideOptionsToRequest(options),
      });
      navigation.navigate("TripStatus", { tripId: data.id });
    } catch (err: any) {
      const d = err?.response?.data;
      setError(d?.detail || (d && typeof d === "object" ? String(Object.values(d)[0]) : null) ||
        "Couldn't request a ride right now. Try again in a moment.");
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

      {!pickup && !destination && <SuggestedRideCard onUse={useSuggestion} />}

      {zone && <QuickPlaces zone={zone} onPick={pickPlace} showPartners={!destination} />}
      <PinPickerMap center={mapCenter} value={pickup} onChange={(v) => { setPickup(v); setLabels((l) => ({ ...l, pickup: "Pickup" }));
        setSavedIds((ids) => ({ ...ids, pickup: undefined })); }} label="Pickup" />
      <PinPickerMap center={mapCenter} value={destination} onChange={(v) => { setDestination(v); setLabels((l) => ({ ...l, destination: "Destination" }));
        setSavedIds((ids) => ({ ...ids, destination: undefined })); }} label="Destination" />

      {placements.map((p) => (
        <Card key={p.id} style={{ marginBottom: spacing.md }}>
          <Text style={{ fontSize: 11, fontWeight: "700", color: colors.inkMuted, letterSpacing: 0.5 }}>SPONSORED</Text>
          <Text style={{ fontWeight: "700", fontSize: 15, color: colors.ink, marginTop: 2 }}>{p.title}</Text>
          {!!p.description && <Text style={typography.muted}>{p.description}</Text>}
          <Text style={[typography.muted, { fontSize: 12 }]} onPress={p.link_url ? () => Linking.openURL(p.link_url) : undefined}>
            {p.sponsor_name}{p.link_url ? " · Learn more" : ""}
          </Text>
        </Card>
      ))}

      <RideOptions value={options} onChange={setOptions} fareEstimate={baseEstimate} destination={destination}
        zoneBaseFare={zone ? Number(zone.base_fare) : undefined} />

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
        title={requesting ? "Requesting…" : options.kind === "delivery" ? "Book delivery" : "Request WolbiRide"}
        onPress={requestRide}
        variant="gold"
        disabled={!pickup || !destination || !deliveryIsComplete(options)}
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
