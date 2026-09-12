import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useAuth } from "../auth/AuthContext";
import { useDriverContext } from "../components/DriverGate";
import { Badge, Button, Card } from "../components/ui";
import { colors, spacing, typography } from "../theme";

export default function ProfileScreen() {
  const { user, logout } = useAuth();
  const { driver } = useDriverContext();

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={typography.h1}>Profile</Text>
      <Text style={[typography.muted, styles.subtitle]}>{user?.phone}</Text>

      <Card style={styles.card}>
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
