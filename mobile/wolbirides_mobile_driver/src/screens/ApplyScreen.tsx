import { useState } from "react";
import { Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "../api/client";
import { pickAndUpload, type UploadKind } from "../upload";
import { Button, Card, ErrorBanner, FieldLabel, TextField } from "../components/ui";
import { colors, spacing, typography } from "../theme";

export default function ApplyScreen({ onApplied }: { onApplied: () => void }) {
  const [licenceNumber, setLicenceNumber] = useState("");
  const [plateNumber, setPlateNumber] = useState("");
  const [emergencyName, setEmergencyName] = useState("");
  const [emergencyPhone, setEmergencyPhone] = useState("");
  // Same fields the web application collects; the documents are what ops verifies (WR-07.2).
  const [licenceExpiry, setLicenceExpiry] = useState("");
  const [docs, setDocs] = useState<Partial<Record<UploadKind, string>>>({});
  const [uploading, setUploading] = useState<UploadKind | null>(null);

  async function upload(kind: UploadKind, source: "camera" | "library" | "document") {
    setUploading(kind);
    setError(null);
    try {
      const url = await pickAndUpload(kind, source);
      if (url) setDocs((d) => ({ ...d, [kind]: url }));
    } catch (err: any) {
      setError(err?.message === "permission" ? "Allow camera or photo access in your phone's settings."
        : err?.response?.data?.detail || "That upload didn't work. Try a clear photo or a PDF under 8 MB.");
    } finally {
      setUploading(null);
    }
  }

  const expiryValid = !licenceExpiry || /^\d{4}-\d{2}-\d{2}$/.test(licenceExpiry);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setBusy(true);
    setError(null);
    try {
      await api.post("/drivers/apply", {
        licence_number: licenceNumber,
        licence_expiry: licenceExpiry || undefined,
        licence_document: docs.licence_document,
        plate_number: plateNumber,
        vehicle_photo: docs.vehicle_photo,
        vehicle_registration_document: docs.vehicle_registration_document,
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

          <FieldLabel>Licence expiry date (YYYY-MM-DD)</FieldLabel>
          <TextField value={licenceExpiry} onChangeText={setLicenceExpiry} placeholder="2027-06-30" keyboardType="numbers-and-punctuation" />
          <DocumentRow label="Photo of your licence" url={docs.licence_document} busy={uploading === "licence_document"}
            onPick={(src) => upload("licence_document", src)} allowPdf />

          <FieldLabel>Vehicle plate number</FieldLabel>
          <TextField value={plateNumber} onChangeText={setPlateNumber} placeholder="GT-1234-24" autoCapitalize="characters" />
          <DocumentRow label="Photo of your yellow-yellow" url={docs.vehicle_photo} busy={uploading === "vehicle_photo"}
            onPick={(src) => upload("vehicle_photo", src)} />
          <DocumentRow label="Vehicle registration document" url={docs.vehicle_registration_document}
            busy={uploading === "vehicle_registration_document"} onPick={(src) => upload("vehicle_registration_document", src)} allowPdf />

          <FieldLabel>Emergency contact name</FieldLabel>
          <TextField value={emergencyName} onChangeText={setEmergencyName} />

          <FieldLabel>Emergency contact phone</FieldLabel>
          <TextField value={emergencyPhone} onChangeText={setEmergencyPhone} keyboardType="phone-pad" />

          {error && <ErrorBanner message={error} />}

          <Button title={busy ? "Submitting…" : "Submit application"} onPress={handleSubmit} variant="gold" loading={busy}
            disabled={!!uploading || !licenceNumber.trim() || !plateNumber.trim() || !expiryValid} />
        </Card>

        <Text style={styles.footnote}>
          Documents go straight to WolbiRides ops for verification and aren't shown to riders.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function DocumentRow({ label, url, busy, onPick, allowPdf }: {
  label: string; url?: string; busy: boolean; onPick: (src: "camera" | "library" | "document") => void; allowPdf?: boolean;
}) {
  return (
    <View style={styles.docRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.docLabel}>{label}</Text>
        <Text style={[styles.docState, url ? { color: colors.success } : null]}>
          {busy ? "Uploading…" : url ? "Uploaded ✓" : "Not added yet"}
        </Text>
      </View>
      {url && !url.toLowerCase().endsWith(".pdf") && <Image source={{ uri: url }} style={styles.thumb} />}
      <View style={{ gap: 4 }}>
        <TouchableOpacity disabled={busy} onPress={() => onPick("camera")}><Text style={styles.docLink}>Camera</Text></TouchableOpacity>
        <TouchableOpacity disabled={busy} onPress={() => onPick("library")}><Text style={styles.docLink}>Photos</Text></TouchableOpacity>
        {allowPdf && <TouchableOpacity disabled={busy} onPress={() => onPick("document")}><Text style={styles.docLink}>PDF</Text></TouchableOpacity>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  docRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm, marginBottom: spacing.sm,
    borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.line },
  docLabel: { fontWeight: "600", color: colors.ink },
  docState: { fontSize: 12.5, color: colors.inkMuted },
  docLink: { color: colors.navyInk, fontWeight: "700", textDecorationLine: "underline", fontSize: 13 },
  thumb: { width: 44, height: 44, borderRadius: 6 },
  safeArea: { flex: 1, backgroundColor: colors.paper },
  content: { padding: spacing.lg },
  subtitle: { marginBottom: spacing.lg, lineHeight: 19 },
  footnote: { fontSize: 12, color: colors.inkMuted, marginTop: spacing.md, lineHeight: 17 },
});
