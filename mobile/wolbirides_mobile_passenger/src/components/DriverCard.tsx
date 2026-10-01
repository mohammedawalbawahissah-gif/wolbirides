import { Image, Linking, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import type { TripDriverBrief } from "../api/client";
import { colors, radii, spacing } from "../theme";

const VEHICLE_LABEL: Record<string, string> = { yellow_yellow: "Yellow-Yellow" };

/** "Know your driver": same details as the web DriverCard (photo, verified, rating, vehicle, plate, call). */
export default function DriverCard({ driver }: { driver: TripDriverBrief }) {
  const initials = (driver.name || "WR").split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  const photo = driver.profile_photo || driver.vehicle?.photo;
  return (
    <View style={styles.card} accessible accessibilityLabel={`Your rider ${driver.name}, ${driver.vehicle?.plate_number ?? ""}`}>
      <View>
        {photo ? <Image source={{ uri: photo }} style={styles.photo} /> : (
          <View style={[styles.photo, styles.placeholder]}><Text style={styles.initials}>{initials}</Text></View>
        )}
        {driver.verification_status === "verified" && <View style={styles.verified}><Text style={styles.verifiedText}>✓</Text></View>}
      </View>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <Text style={styles.name}>{driver.name || "Your rider"}</Text>
          <Text style={styles.rating}>★ {Number(driver.rating).toFixed(1)}</Text>
        </View>
        <Text style={styles.vehicle}>
          {driver.vehicle ? `${VEHICLE_LABEL[driver.vehicle.vehicle_type] || driver.vehicle.vehicle_type} · ` : "Vehicle details pending"}
          {driver.vehicle && <Text style={styles.plate}>{driver.vehicle.plate_number}</Text>}
        </Text>
      </View>
      {!!driver.phone && (
        <TouchableOpacity style={styles.call} onPress={() => Linking.openURL(`tel:${driver.phone}`)}
          accessibilityRole="button" accessibilityLabel="Call rider">
          <Text style={{ fontSize: 18 }}>☎</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.paperRaised,
    borderRadius: radii.md, padding: spacing.md },
  photo: { width: 56, height: 56, borderRadius: 28 },
  placeholder: { backgroundColor: colors.navyInk, alignItems: "center", justifyContent: "center" },
  initials: { color: colors.gold, fontWeight: "800", fontSize: 18 },
  verified: { position: "absolute", bottom: -2, right: -2, width: 20, height: 20, borderRadius: 10,
    backgroundColor: colors.success, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: colors.paperRaised },
  verifiedText: { color: "#fff", fontSize: 11, fontWeight: "800" },
  name: { fontWeight: "700", fontSize: 16, color: colors.ink },
  rating: { fontWeight: "700", color: colors.ink },
  vehicle: { color: colors.inkMuted, marginTop: 2 },
  plate: { fontWeight: "800", color: colors.ink, letterSpacing: 1 },
  call: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center" },
});
