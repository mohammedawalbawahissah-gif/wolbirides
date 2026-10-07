import { useState } from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useDriverContext } from "../components/DriverGate";
import { Badge, Button, Card, ErrorBanner, FieldLabel, TextField } from "../components/ui";
import { EmergencyContactCard } from "../components/Safety";
import CommercialDetailsCard from "../components/CommercialDetailsCard";
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

      <CommercialDetailsCard />

      <Card style={styles.card}>
        <Text style={typography.h2}>What you offer</Text>
        <Text style={styles.chipLabel}>Rider gender (optional)</Text>
        <View style={styles.chips}>
          {([["", "Prefer not to say"], ["female", "Female rider"], ["male", "Male rider"]] as const).map(([value, label]) => {
            const on = (driver.gender ?? "") === value;
            return (
              <TouchableOpacity key={value} style={[styles.chip, on && styles.chipOn]} onPress={() => toggle("gender", value)}
                accessibilityRole="button" accessibilityState={{ selected: on }}>
                <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        {/* Same wording and order as the passenger's "Driver preference", so a passenger asks for exactly what a
            driver can say they offer. "Deliveries" is driver-only, so it's last. */}
        <View style={styles.chips}>
          {([
            ["offers_quiet_ride", "Quiet ride"],
            ["has_luggage_space", "Space for luggage"],
            ["accessibility_trained", "Help getting in and out"],
            ["accepts_deliveries", "Deliveries (WolbiDeliver)"],
          ] as const).map(([field, label]) => {
            const on = !!driver[field];
            return (
              <TouchableOpacity key={field} style={[styles.chip, on && styles.chipOn]} onPress={() => toggle(field, !on)}
                accessibilityRole="button" accessibilityState={{ selected: on }}>
                <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </Card>

      <Card style={styles.card}>
        <Text style={typography.h2}>How rides are offered</Text>
        <Text style={[typography.body, { lineHeight: 21 }]}>
          Most rides go to the nearest free rider, because passengers shouldn't wait longer than they need to. Now and then,
          among riders who are about equally close, we offer a ride first to the rider who's had fewer rides this week,
          so the work stays reasonably shared. We never send you a ride that's much further away just for this.
        </Text>
      </Card>

      <PayoutCard />
      <EmergencyContactCard />
      <SupportCard />

      <Button title="Log out" onPress={logout} variant="ghost" />
    </ScrollView>
  );
}

/** Where payouts go — a rider's mobile money wallet is sometimes on a different number from
 * the one they signed up with, so this is never assumed from the account phone. */
function PayoutCard() {
  const { user } = useAuth();
  const { driver, setDriver } = useDriverContext();
  const [provider, setProvider] = useState<"momo" | "hubtel">(driver.payout_provider ?? "momo");
  const [phone, setPhone] = useState(driver.payout_phone ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const { data } = await api.patch("/drivers/me", { payout_provider: provider, payout_phone: phone.trim() });
      setDriver(data);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      setError("Couldn't save that. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card style={styles.card}>
      <Text style={typography.h2}>Get paid</Text>
      <FieldLabel>Provider</FieldLabel>
      <View style={{ flexDirection: "row", gap: spacing.sm, marginBottom: spacing.sm }}>
        {(["momo", "hubtel"] as const).map((p) => (
          <TouchableOpacity key={p} style={[styles.chip, provider === p && styles.chipOn]} onPress={() => setProvider(p)}>
            <Text style={[styles.chipText, provider === p && styles.chipTextOn]}>{p === "momo" ? "MTN MoMo" : "Hubtel"}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <FieldLabel>Number</FieldLabel>
      <TextField value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder={user?.phone || "Your account phone"} />
      <Text style={[typography.muted, { marginTop: -4, marginBottom: spacing.sm }]}>Leave blank to use your account phone.</Text>
      {error && <ErrorBanner message={error} />}
      <Button title={saved ? "Saved ✓" : "Save payout details"} onPress={save} variant="gold" loading={saving} />
    </Card>
  );
}

const styles = StyleSheet.create({
  chipLabel: { fontSize: 13, fontWeight: "600", color: colors.inkMuted, marginTop: spacing.sm, marginBottom: spacing.xs },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: spacing.sm },
  chip: { borderWidth: 1, borderColor: colors.line, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12 },
  chipOn: { backgroundColor: colors.navyInk, borderColor: colors.navyInk },
  chipText: { fontSize: 13.5, color: colors.inkMuted },
  chipTextOn: { color: "#FFFFFF" },
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
