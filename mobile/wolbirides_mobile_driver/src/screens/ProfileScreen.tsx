import { ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useDriverContext } from "../components/DriverGate";
import { Badge, Button, Card } from "../components/ui";
import { EmergencyContactCard } from "../components/Safety";
import PhotoField from "../components/PhotoField";
import SupportCard from "../components/SupportCard";
import { colors, spacing, typography } from "../theme";

export default function ProfileScreen() {
  const { user, logout } = useAuth();
  const { driver, setDriver } = useDriverContext();

  async function toggle(field: string, value: boolean | string) {
    try {
      const { data } = await api.patch("/drivers/me", { [field]: value });
      setDriver(data);
    } catch {
      /* switch snaps back on next render */
    }
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={typography.h1}>Profile</Text>
      <Text style={[typography.muted, styles.subtitle]}>{user?.email || user?.phone}</Text>

      <Card style={styles.card}>
        <PhotoField />
        <View style={styles.row}>
          <Text style={typography.muted}>Licence</Text>
          <Text style={styles.mono}>{driver.licence_number}</Text>
        </View>
        <View style={styles.row}>
          <Text style={typography.muted}>Vehicle</Text>
          <Text style={styles.value}>{driver.vehicles[0]?.plate_number || "—"}</Text>
        </View>
        <View style={[styles.row, { borderBottomWidth: 0 }]}>
          <Text style={typography.muted}>Status</Text>
          <Badge label={driver.verification_status} tone={driver.verification_status === "verified" ? "success" : "warning"} />
        </View>
      </Card>

      <View style={styles.spacer} />

      <Card style={styles.card}>
        <Text style={typography.h2}>What you offer</Text>
        <Text style={[typography.muted, { marginBottom: spacing.sm }]}>
          Passengers who ask for these get matched with you first when you're about as close as other drivers.
        </Text>
        {([
          ["offers_quiet_ride", "Quiet rides"],
          ["has_luggage_space", "Luggage space"],
          ["accessibility_trained", "Accessibility help"],
          ["accepts_deliveries", "Deliveries (WolbiDeliver)"],
        ] as const).map(([field, label]) => (
          <View key={field} style={styles.row}>
            <Text style={styles.value}>{label}</Text>
            <Switch value={!!driver[field]} onValueChange={(v) => toggle(field, v)} trackColor={{ true: colors.success }} />
          </View>
        ))}
      </Card>

      <Card style={styles.card}>
        <Text style={typography.h2}>Gender (optional)</Text>
        <Text style={[typography.muted, { marginBottom: spacing.sm }]}>
          Only used to match riders who ask for it. It isn't shown to riders or on your profile.
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {([["", "Prefer not to say"], ["female", "Female"], ["male", "Male"]] as const).map(([value, label]) => (
            <Button key={value} title={label} variant={(driver.gender ?? "") === value ? "primary" : "ghost"}
              onPress={() => toggle("gender", value)} />
          ))}
        </View>
      </Card>

      <Card style={styles.card}>
        <Text style={typography.h2}>How rides are offered</Text>
        <Text style={[typography.body, { lineHeight: 21 }]}>
          Most rides go to the nearest free driver, because riders shouldn't wait longer than they need to. Now and then,
          among drivers who are about equally close, we offer a ride first to the driver who's had fewer rides this week,
          so the work stays reasonably shared. We never send you a ride that's much further away just for this.
        </Text>
      </Card>

      <EmergencyContactCard />
      <SupportCard />

      <Button title="Log out" onPress={logout} variant="ghost" />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  content: { padding: spacing.lg },
  subtitle: { marginBottom: spacing.lg },
  card: { marginBottom: spacing.md },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  mono: { fontFamily: "monospace", fontWeight: "700", color: colors.ink },
  value: { fontWeight: "700", color: colors.ink },
  spacer: { height: spacing.lg },
});
