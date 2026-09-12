import { useState } from "react";
import { ScrollView, StyleSheet, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "../api/client";
import { Button, Card, ErrorBanner, FieldLabel, TextField } from "../components/ui";
import { colors, spacing, typography } from "../theme";

export default function ApplyScreen({ onApplied }: { onApplied: () => void }) {
  const [licenceNumber, setLicenceNumber] = useState("");
  const [plateNumber, setPlateNumber] = useState("");
  const [emergencyName, setEmergencyName] = useState("");
  const [emergencyPhone, setEmergencyPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setBusy(true);
    setError(null);
    try {
      await api.post("/drivers/apply", {
        licence_number: licenceNumber,
        plate_number: plateNumber,
        emergency_contact_name: emergencyName,
        emergency_contact_phone: emergencyPhone,
      });
      onApplied();
    } catch {
      setError("Couldn't submit your application. Check the details and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={typography.h1}>Apply to drive</Text>
        <Text style={[typography.muted, styles.subtitle]}>
          Founding drivers get priority ride access and reduced platform fees (WR-07.1). Ops
          reviews your documents before you can go online.
        </Text>

        <Card>
          <FieldLabel>Commercial rider licence number</FieldLabel>
          <TextField value={licenceNumber} onChangeText={setLicenceNumber} autoCapitalize="characters" />

          <FieldLabel>Vehicle plate number</FieldLabel>
          <TextField value={plateNumber} onChangeText={setPlateNumber} placeholder="GT-1234-24" autoCapitalize="characters" />

          <FieldLabel>Emergency contact name</FieldLabel>
          <TextField value={emergencyName} onChangeText={setEmergencyName} />

          <FieldLabel>Emergency contact phone</FieldLabel>
          <TextField value={emergencyPhone} onChangeText={setEmergencyPhone} keyboardType="phone-pad" />

          {error && <ErrorBanner message={error} />}

          <Button title={busy ? "Submitting…" : "Submit application"} onPress={handleSubmit} variant="gold" loading={busy} />
        </Card>

        <Text style={styles.footnote}>
          Vehicle photo and document upload aren't wired up yet in this build — ops can attach
          those via the admin dashboard once Cloudinary is configured.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.paper },
  content: { padding: spacing.lg },
  subtitle: { marginBottom: spacing.lg, lineHeight: 19 },
  footnote: { fontSize: 12, color: colors.inkMuted, marginTop: spacing.md, lineHeight: 17 },
});
