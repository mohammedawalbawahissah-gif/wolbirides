import { useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { api } from "../api/client";
import { pickAndUpload, type UploadKind } from "../upload";
import { colors, spacing, typography } from "../theme";
import { useDriverContext } from "./DriverGate";
import { Button, Card, ErrorBanner, FieldLabel, TextField } from "./ui";

const MISSING_LABELS: Record<string, string> = {
  licence_number: "licence number",
  ghana_card_number: "Ghana Card",
  transport_union: "transport union",
  union_membership_number: "union membership number",
  vehicle: "vehicle",
  roadworthy_expiry: "roadworthy expiry",
};

/** LI 2519 commercial rider details. Riders who applied before these were required fill them in here. */
export default function CommercialDetailsCard() {
  const { driver, setDriver } = useDriverContext();
  const vehicle = driver.vehicles.find((v) => v.active) || driver.vehicles[0];
  const [ghanaCard, setGhanaCard] = useState(driver.ghana_card_number || "");
  const [union, setUnion] = useState(driver.transport_union || "");
  const [unionNumber, setUnionNumber] = useState(driver.union_membership_number || "");
  const [rwExpiry, setRwExpiry] = useState(vehicle?.roadworthy_expiry || "");
  const [docs, setDocs] = useState<Partial<Record<UploadKind, string>>>({
    ghana_card_document: driver.ghana_card_document || undefined,
    union_card_document: driver.union_card_document || undefined,
    roadworthy_certificate: vehicle?.roadworthy_certificate || undefined,
  });
  const [uploading, setUploading] = useState<UploadKind | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const missing = driver.compliance_missing || [];

  async function upload(kind: UploadKind) {
    setUploading(kind);
    setError(null);
    try {
      const url = await pickAndUpload(kind, "library");
      if (url) setDocs((d) => ({ ...d, [kind]: url }));
    } catch (err: any) {
      setError(err?.message === "permission" ? "Allow photo access in your phone's settings."
        : err?.response?.data?.detail || "That upload didn't work. Try a clear photo under 8 MB.");
    } finally {
      setUploading(null);
    }
  }

  async function save() {
    if (rwExpiry && !/^\d{4}-\d{2}-\d{2}$/.test(rwExpiry)) {
      setError("Roadworthy expiry must look like 2027-03-31.");
      return;
    }
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const { data } = await api.patch("/drivers/me", {
        ...(ghanaCard.trim() ? { ghana_card_number: ghanaCard.trim() } : {}),
        ghana_card_document: docs.ghana_card_document || "",
        transport_union: union.trim(),
        union_membership_number: unionNumber.trim(),
        union_card_document: docs.union_card_document || "",
        ...(vehicle ? { roadworthy_expiry: rwExpiry || null, roadworthy_certificate: docs.roadworthy_certificate || "" } : {}),
      });
      setDriver(data);
      setSaved(true);
    } catch (err: any) {
      const d = err?.response?.data;
      const first = d && typeof d === "object" ? Object.values(d).flat()[0] : null;
      setError(typeof first === "string" ? first : "Couldn't save. Try again.");
    } finally {
      setSaving(false);
    }
  }

  const docRow = (kind: UploadKind, label: string) => (
    <View style={styles.docRow}>
      <Text style={styles.docLabel}>{label}</Text>
      <TouchableOpacity disabled={!!uploading} onPress={() => upload(kind)}>
        <Text style={[styles.docLink, docs[kind] ? { color: colors.success } : null]}>
          {uploading === kind ? "Uploading…" : docs[kind] ? "Uploaded ✓ Replace" : "Add photo"}
        </Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <Card style={{ marginBottom: spacing.md }}>
      <Text style={typography.h2}>Commercial rider details</Text>
      <Text style={[typography.muted, { marginVertical: spacing.sm }]}>
        {missing.length > 0
          ? `Still needed: ${missing.map((m) => MISSING_LABELS[m] || m).join(", ")}.`
          : "All required details are on file."}
      </Text>
      <FieldLabel>Ghana Card number</FieldLabel>
      <TextField value={ghanaCard} onChangeText={setGhanaCard} placeholder="GHA-123456789-0" autoCapitalize="characters" autoCorrect={false} />
      {docRow("ghana_card_document", "Ghana Card photo")}
      <FieldLabel>Transport union (optional)</FieldLabel>
      <TextField value={union} onChangeText={setUnion} placeholder="e.g. NUTO, Tamale branch" />
      <FieldLabel>Union membership number (optional)</FieldLabel>
      <TextField value={unionNumber} onChangeText={setUnionNumber} autoCapitalize="characters" />
      {docRow("union_card_document", "Union card photo (optional)")}
      {vehicle && (
        <>
          <FieldLabel>Roadworthy certificate expiry, YYYY-MM-DD (optional)</FieldLabel>
          <TextField value={rwExpiry} onChangeText={setRwExpiry} placeholder="2027-03-31" keyboardType="numbers-and-punctuation" />
          {docRow("roadworthy_certificate", "Roadworthy certificate (optional)")}
        </>
      )}
      {error && <ErrorBanner message={error} />}
      {saved && !error && <Text style={[typography.muted, { color: colors.success }]}>Saved.</Text>}
      <Button title={saving ? "Saving…" : "Save details"} variant="gold" onPress={save} loading={saving} disabled={!!uploading} />
    </Card>
  );
}

const styles = StyleSheet.create({
  docRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: spacing.sm,
    marginBottom: spacing.sm, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.line },
  docLabel: { fontWeight: "600", color: colors.ink },
  docLink: { color: colors.navyInk, fontWeight: "700", textDecorationLine: "underline", fontSize: 13 },
});
