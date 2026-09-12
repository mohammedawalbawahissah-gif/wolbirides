import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { api, type ServiceZone } from "../api/client";
import { useDriverContext } from "../components/DriverGate";
import { useDriverDispatch } from "../hooks/useDriverDispatch";
import OfferModal from "../components/OfferModal";
import { Card, EmptyState, ErrorBanner } from "../components/ui";
import { colors, spacing, typography } from "../theme";
import type { MainTabScreenProps } from "../navigation/types";

export default function HomeScreen({ navigation }: MainTabScreenProps<"Drive">) {
  const { driver, setDriver } = useDriverContext();
  const [zone, setZone] = useState<ServiceZone | null>(null);
  const [toggling, setToggling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<ServiceZone[]>("/zones").then(({ data }) => {
      if (data.length > 0) setZone(data[0]);
    });
  }, []);

  useEffect(() => {
    api.get("/drivers/me/active-trip").then(({ data }) => {
      if (data) navigation.navigate("ActiveTrip", { tripId: data.id });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { connected, offer, locationError, backgroundModeActive, clearOffer } = useDriverDispatch(
    zone?.id ?? driver.current_zone,
    driver.is_online
  );

  async function toggleOnline() {
    if (!zone) return;
    setToggling(true);
    setError(null);
    try {
      const { data } = await api.patch("/drivers/me/status", { is_online: !driver.is_online, zone_id: zone.id });
      setDriver(data);
    } catch (err: any) {
      setError(err?.response?.data?.detail || "Couldn't update your status.");
    } finally {
      setToggling(false);
    }
  }

  async function acceptOffer(tripId: string) {
    try {
      await api.post(`/trips/${tripId}/accept`);
      clearOffer();
      navigation.navigate("ActiveTrip", { tripId });
    } catch {
      clearOffer();
    }
  }

  async function declineOffer(tripId: string) {
    try {
      await api.post(`/trips/${tripId}/decline`);
    } finally {
      clearOffer();
    }
  }

  if (driver.verification_status !== "verified") {
    return <EmptyState message="Your account isn't verified yet — you can't go online until ops approves your application." />;
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={typography.h1}>{driver.is_online ? "You're online" : "You're offline"}</Text>
      <Text style={[typography.muted, styles.subtitle]}>{zone ? zone.name : "Loading zone…"}</Text>

      <Card style={[styles.statusCard, driver.is_online && styles.statusCardOnline]}>
        <View style={{ flex: 1 }}>
          <Text style={styles.statusLabel}>
            {driver.is_online ? "Receiving ride requests" : "Not receiving requests"}
          </Text>
          {driver.is_online && (
            <Text style={styles.statusDetail}>
              {connected ? "Connected" : "Reconnecting…"}
              {backgroundModeActive ? " · Background tracking on" : ""}
            </Text>
          )}
        </View>
        <TouchableOpacity
          style={[styles.toggle, driver.is_online && styles.toggleOn]}
          onPress={toggleOnline}
          disabled={toggling || !zone}
        >
          <View style={[styles.toggleKnob, driver.is_online && styles.toggleKnobOn]} />
        </TouchableOpacity>
      </Card>

      {locationError && <ErrorBanner message={locationError} />}
      {error && <ErrorBanner message={error} />}

      {!driver.is_online && (
        <Card>
          <Text style={styles.hintTitle}>Ready to start earning?</Text>
          <Text style={styles.hintBody}>
            Go online to start receiving ride requests in {zone?.name ?? "your zone"}. For the
            most reliable location tracking, allow "Always" location access when prompted.
          </Text>
        </Card>
      )}

      <View style={styles.spacer} />

      <Card>
        <Text style={typography.h2}>Vehicle</Text>
        <View style={styles.kvRow}>
          <Text style={typography.muted}>Plate</Text>
          <Text style={styles.kvValue}>{driver.vehicles[0]?.plate_number || "—"}</Text>
        </View>
        <View style={styles.kvRow}>
          <Text style={typography.muted}>Rating</Text>
          <Text style={styles.kvValue}>★ {driver.quality_score}</Text>
        </View>
      </Card>

      {offer && (
        <OfferModal offer={offer} onAccept={() => acceptOffer(offer.trip_id)} onDecline={() => declineOffer(offer.trip_id)} />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  content: { padding: spacing.lg },
  subtitle: { marginBottom: spacing.lg },
  statusCard: { flexDirection: "row", alignItems: "center", marginBottom: spacing.md },
  statusCardOnline: { borderColor: colors.success, backgroundColor: colors.successBg },
  statusLabel: { fontSize: 16, fontWeight: "600", color: colors.ink },
  statusDetail: { fontSize: 12.5, color: colors.inkMuted, marginTop: 4 },
  toggle: { width: 52, height: 30, borderRadius: 999, backgroundColor: colors.line, justifyContent: "center" },
  toggleOn: { backgroundColor: colors.success },
  toggleKnob: {
    width: 24, height: 24, borderRadius: 12, backgroundColor: "#FFFFFF", marginLeft: 3,
    shadowColor: "#000", shadowOpacity: 0.3, shadowRadius: 2, elevation: 2,
  },
  toggleKnobOn: { marginLeft: 25 },
  hintTitle: { fontSize: 15, fontWeight: "700", marginBottom: spacing.xs, color: colors.ink },
  hintBody: { fontSize: 13.5, color: colors.inkMuted, lineHeight: 19 },
  spacer: { height: spacing.md },
  kvRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: spacing.xs },
  kvValue: { fontSize: 14, fontWeight: "700", color: colors.ink },
});
