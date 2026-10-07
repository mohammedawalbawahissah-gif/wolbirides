import { useEffect, useState } from "react";
import { Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { api, requestErrorMessage, type ServiceZone } from "../api/client";
import { Button, Card, EmptyState, ErrorBanner } from "../components/ui";
import LocationPickerModal, { type LatLng } from "../components/LocationPickerModal";
import { PINNED_LABEL } from "../geocode";
import { SuggestedRideCard, type SuggestedRide } from "../components/PassengerExtras";
import QuickPlaces, { type PickedPlace } from "../components/QuickPlaces";
import RideOptions, { DEFAULT_RIDE_OPTIONS, deliveryIsComplete, rideOptionsToRequest, type RideOptionsValue } from "../components/RideOptions";
import { colors, radii, spacing, typography } from "../theme";
import type { RootStackScreenProps } from "../navigation/types";

function haversineKm(a: LatLng, b: LatLng) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Booking screen for both a ride and a delivery (opened from the Ride tab's
 * "Request a Ride" or "Delivery" card). Pickup and destination are set via the
 * full-screen search-and-map picker rather than two maps sitting on the page.
 */
export default function BookRideScreen({ navigation, route }: RootStackScreenProps<"BookRide">) {
  const [zone, setZone] = useState<ServiceZone | null>(null);
  const [zonesLoaded, setZonesLoaded] = useState(false);
  const [pickup, setPickup] = useState<LatLng | null>(null);
  const [destination, setDestination] = useState<LatLng | null>(null);
  const [picking, setPicking] = useState<"pickup" | "destination" | null>(null);
  const [savedIds, setSavedIds] = useState<{ pickup?: string; destination?: string }>({});
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<SuggestedRide | null>(null);
  const [options, setOptions] = useState<RideOptionsValue>(() => {
    const initialKind = route.params?.initialKind;
    return initialKind ? { ...DEFAULT_RIDE_OPTIONS, kind: initialKind } : DEFAULT_RIDE_OPTIONS;
  });
  const [placements, setPlacements] = useState<{ id: string; title: string; description: string; sponsor_name: string; link_url: string }[]>([]);

  function pickPlace(which: "pickup" | "destination", place: PickedPlace) {
    const point = { lat: place.lat, lng: place.lng, label: place.label };
    if (which === "pickup") setPickup(point); else setDestination(point);
    setSavedIds((ids) => ({ ...ids, [which]: place.savedAddressId }));
  }

  function confirmPicked(pos: LatLng) {
    if (picking === "pickup") { setPickup(pos); setSavedIds((ids) => ({ ...ids, pickup: undefined })); }
    else if (picking === "destination") { setDestination(pos); setSavedIds((ids) => ({ ...ids, destination: undefined })); }
    setPicking(null);
  }

  // WR-13: "Ride again" from history arrives here with the route pre-filled.
  useEffect(() => {
    const rebook = route.params?.rebook;
    if (!rebook) return;
    setPickup(rebook.pickup);
    setDestination(rebook.destination);
    navigation.setParams({ rebook: undefined } as any);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function useSuggestion() {
    if (!suggestion) return;
    setPickup({ lat: Number(suggestion.pickup_lat), lng: Number(suggestion.pickup_lng), label: suggestion.pickup_label });
    setDestination({ lat: Number(suggestion.destination_lat), lng: Number(suggestion.destination_lng), label: suggestion.destination_label });
    setSuggestion(null);
  }

  useEffect(() => {
    api.get<SuggestedRide | null>("/passengers/me/suggested-ride").then(({ data }) => setSuggestion(data || null)).catch(() => setSuggestion(null));
  }, []);

  const [zonesFailed, setZonesFailed] = useState<string | null>(null);
  const [zonesTry, setZonesTry] = useState(0);
  useEffect(() => {
    setZonesFailed(null);
    api.get<ServiceZone[]>("/zones").then(({ data }) => { if (data.length > 0) setZone(data[0]); })
      .catch((err) => setZonesFailed(requestErrorMessage(err, "Couldn't load service zones.")))
      .finally(() => setZonesLoaded(true));
  }, [zonesTry]);

  useEffect(() => {
    if (!zone) return;
    api.get(`/placements/active?zone_id=${zone.id}`).then(({ data }) => setPlacements(data)).catch(() => {});
  }, [zone]);

  const distanceKm = pickup && destination ? haversineKm(pickup, destination) : null;
  const baseEstimate = zone && distanceKm != null
    ? Number(zone.base_fare) + distanceKm * Number(zone.per_km_rate) + (options.kind === "delivery" ? Number(zone.delivery_surcharge ?? 0) : 0)
    : null;
  const fareEstimate = baseEstimate != null ? Math.max(baseEstimate - options.promo_discount, 0) : null;

  async function requestRide() {
    if (!zone || !pickup || !destination || distanceKm == null) return;
    setRequesting(true);
    setError(null);
    try {
      const { data } = await api.post("/trips", {
        zone_id: zone.id,
        pickup_lat: pickup.lat, pickup_lng: pickup.lng, pickup_label: pickup.label || PINNED_LABEL,
        destination_lat: destination.lat, destination_lng: destination.lng, destination_label: destination.label || PINNED_LABEL,
        distance_km: distanceKm.toFixed(2),
        pickup_saved_address_id: savedIds.pickup, destination_saved_address_id: savedIds.destination,
        ...rideOptionsToRequest(options),
      });
      navigation.replace("TripStatus", { tripId: data.id });
    } catch (err: any) {
      const d = err?.response?.data;
      setError(d?.detail || (d && typeof d === "object" ? String(Object.values(d)[0]) : null) ||
        "Couldn't request a ride right now. Try again in a moment.");
    } finally {
      setRequesting(false);
    }
  }

  if (!zonesLoaded) return null;
  // A failed request is not the same as "no zone": say which it is, and let the passenger try again.
  if (zonesFailed) {
    return (
      <View style={styles.screen}>
        <ErrorBanner message={zonesFailed} />
        <Button title="Try again" variant="primary" onPress={() => { setZonesLoaded(false); setZonesTry((n) => n + 1); }} />
      </View>
    );
  }
  if (!zone) return <EmptyState message="No active service zone yet — check back once the pilot zone is live." />;

  const mapCenter: LatLng = {
    lat: (zone.boundary.min_lat + zone.boundary.max_lat) / 2,
    lng: (zone.boundary.min_lng + zone.boundary.max_lng) / 2,
  };

  return (
    <>
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <Text style={typography.h1}>{options.kind === "delivery" ? "Send or receive a package" : "Where to?"}</Text>
        <Text style={[typography.muted, styles.subtitle]}>{zone.name}</Text>

        {suggestion && !pickup && !destination && <SuggestedRideCard onUse={useSuggestion} />}

        {zone && <QuickPlaces zone={zone} onPick={pickPlace} showPartners={!destination} />}

        <TouchableOpacity style={styles.locationButton} onPress={() => setPicking("pickup")}>
          <View style={[styles.dot, { backgroundColor: colors.gold }]} />
          <View style={{ flex: 1 }}>
            <Text style={styles.locationLabel}>{options.kind === "delivery" ? "Collect from" : "Pickup"}</Text>
            <Text style={styles.locationValue} numberOfLines={1}>{pickup ? (pickup.label || PINNED_LABEL) : "Tap to set"}</Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.locationButton} onPress={() => setPicking("destination")}>
          <View style={[styles.dot, { backgroundColor: colors.navyInk }]} />
          <View style={{ flex: 1 }}>
            <Text style={styles.locationLabel}>{options.kind === "delivery" ? "Deliver to" : "Destination"}</Text>
            <Text style={styles.locationValue} numberOfLines={1}>{destination ? (destination.label || PINNED_LABEL) : "Tap to set"}</Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </TouchableOpacity>

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

        <Text style={[typography.h2, { marginTop: spacing.sm }]}>{options.kind === "delivery" ? "Delivery Summary" : "Trip summary"}</Text>
        <RideOptions value={options} onChange={setOptions} fareEstimate={baseEstimate} destination={destination} />

        {fareEstimate != null && (
          <Card style={styles.fareCard}>
            <View>
              <Text style={styles.fareLabel}>{options.kind === "ride" && options.shareable ? "At most" : "Estimated fare"}</Text>
              <Text style={styles.fareValue}>GH₵{fareEstimate.toFixed(2)}</Text>
            </View>
            <Text style={styles.fareDistance}>{distanceKm!.toFixed(1)} km</Text>
          </Card>
        )}

        {error && <ErrorBanner message={error} />}

        <Button
          title={requesting ? "Requesting…" : options.kind === "delivery" ? "Book delivery" : "Request ride"}
          onPress={requestRide} variant="gold"
          disabled={!pickup || !destination || requesting || !deliveryIsComplete(options)} loading={requesting}
        />
      </ScrollView>

      <LocationPickerModal
        visible={!!picking}
        title={picking === "pickup" ? (options.kind === "delivery" ? "Collect from" : "Set pickup")
          : (options.kind === "delivery" ? "Deliver to" : "Set destination")}
        center={(picking === "pickup" ? pickup : destination) ?? mapCenter}
        zoneId={zone.id}
        value={picking === "pickup" ? pickup : destination}
        onConfirm={confirmPicked}
        onClose={() => setPicking(null)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  content: { padding: spacing.lg, paddingBottom: spacing.xl },
  subtitle: { marginBottom: spacing.lg },
  locationButton: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: 14, marginBottom: 10,
    borderWidth: 1, borderColor: colors.line, borderRadius: radii.md, backgroundColor: colors.paperRaised,
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  locationLabel: { fontSize: 11, fontWeight: "700", color: colors.inkMuted, textTransform: "uppercase", letterSpacing: 0.4 },
  locationValue: { fontSize: 15, color: colors.ink, marginTop: 2 },
  chevron: { fontSize: 20, color: colors.inkMuted },
  fareCard: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.md },
  fareLabel: { fontSize: 12.5, color: colors.inkMuted, fontWeight: "500" },
  fareValue: { fontSize: 22, fontWeight: "700", color: colors.navyInk },
  fareDistance: { fontSize: 13.5, color: colors.inkMuted, fontWeight: "600" },
});
