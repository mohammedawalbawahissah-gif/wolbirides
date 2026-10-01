import * as Location from "expo-location";
import { useState } from "react";
import { Linking, Modal, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { type SOSResult } from "../api/client";
import { sendSOSWithRetry } from "../sosQueue";
import { useAuth } from "../auth/AuthContext";
import { colors, radii, spacing, typography } from "../theme";
import { Button, Card, ErrorBanner, FieldLabel, TextField } from "./ui";

async function currentPosition(): Promise<{ lat: string; lng: string } | null> {
  try {
    const { status } = await Location.getForegroundPermissionsAsync();
    if (status !== "granted") {
      const asked = await Location.requestForegroundPermissionsAsync();
      if (asked.status !== "granted") return null;
    }
    // Last known first (instant), fresh fix second, never block the alert for long.
    const known = await Location.getLastKnownPositionAsync({ maxAge: 60000 });
    const pos =
      known ??
      (await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000)),
      ]));
    return pos ? { lat: pos.coords.latitude.toFixed(6), lng: pos.coords.longitude.toFixed(6) } : null;
  } catch {
    return null;
  }
}

/**
 * WR-18 SOS. Two taps on purpose: the first opens a confirm sheet, the
 * second sends. Location is attached when available; the alert goes out regardless.
 */
export function SOSButton({ tripId }: { tripId: string }) {
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<SOSResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setSending(true);
    setError(null);
    const pos = await currentPosition();
    // Queued on the phone first, then retried until it lands (poor connectivity guardrail).
    const data = await sendSOSWithRetry(
      { tripId, lat: pos?.lat, lng: pos?.lng, queuedAt: Date.now() },
      () => setError("No connection. Your alert is saved and we're still trying to send it. Call 112 if you can."),
    );
    if (data) {
      setResult(data);
      setError(null);
    } else {
      setError("Your alert is saved on this phone and will send as soon as you're back online. Call 112 now.");
    }
    setSending(false);
  }

  const call = (n: string) => Linking.openURL(`tel:${n}`);

  return (
    <>
      <TouchableOpacity style={styles.trigger} onPress={() => setOpen(true)} accessibilityRole="button"
        accessibilityLabel="SOS: get emergency help">
        <Text style={styles.triggerText}>SOS</Text>
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => !sending && setOpen(false)}>
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            {result ? (
              <>
                <Text style={styles.title}>Help is on the way</Text>
                <Text style={styles.body}>
                  The WolbiRides team has your alert{result.contact_notified ? " and your emergency contact has been texted" : ""}.
                  If you're in immediate danger, call emergency services.
                </Text>
                <Button title={`Call ${result.emergency_number}`} variant="danger" onPress={() => call(result.emergency_number)} />
                <Button title="Close" variant="ghost" onPress={() => setOpen(false)} />
              </>
            ) : (
              <>
                <Text style={styles.title}>Send an SOS alert?</Text>
                <Text style={styles.body}>
                  We'll alert the WolbiRides safety team with your location and text your emergency contact if you've set one.
                </Text>
                {error && <ErrorBanner message={error} />}
                <Button title={sending ? (error ? "Retrying…" : "Sending alert…") : "Send SOS alert"} variant="danger" onPress={send} loading={sending} />
                <Button title="Call 112 instead" variant="ghost" onPress={() => call("112")} />
                <TouchableOpacity onPress={() => setOpen(false)} disabled={sending} style={styles.cancel}>
                  <Text style={typography.muted}>Cancel</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </Modal>
    </>
  );
}

/** WR-18: the one person we text if you press SOS. */
export function EmergencyContactCard() {
  const { user, updateProfile } = useAuth();
  const [name, setName] = useState(user?.emergency_contact_name || "");
  const [phone, setPhone] = useState(user?.emergency_contact_phone || "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await updateProfile({ emergency_contact_name: name.trim(), emergency_contact_phone: phone.trim() });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err: any) {
      setError(err?.response?.data?.emergency_contact_phone?.[0] || "Couldn't save your emergency contact.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card style={{ marginBottom: spacing.md }}>
      <Text style={typography.h2}>Emergency contact</Text>
      <FieldLabel>Name</FieldLabel>
      <TextField value={name} onChangeText={setName} placeholder="e.g. Mum" />
      <FieldLabel>Phone number</FieldLabel>
      <TextField value={phone} onChangeText={setPhone} placeholder="024 123 4567" keyboardType="phone-pad" />
      {error && <ErrorBanner message={error} />}
      <Button title={saved ? "Saved ✓" : "Save contact"} onPress={save} variant="gold" loading={saving} />
    </Card>
  );
}

const styles = StyleSheet.create({
  trigger: {
    marginTop: spacing.md,
    paddingVertical: 14,
    borderRadius: radii.md,
    borderWidth: 2,
    borderColor: colors.danger,
    backgroundColor: colors.dangerBg,
    alignItems: "center",
  },
  triggerText: { color: colors.danger, fontWeight: "800", fontSize: 17, letterSpacing: 1 },
  overlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(22,35,63,0.55)" },
  sheet: {
    backgroundColor: colors.paperRaised,
    borderTopWidth: 6,
    borderTopColor: colors.danger,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    padding: spacing.lg,
    paddingBottom: spacing.xl,
    gap: spacing.sm,
  },
  title: { fontSize: 21, fontWeight: "700", color: colors.danger },
  body: { fontSize: 15, lineHeight: 21, color: colors.ink, marginBottom: spacing.sm },
  cancel: { alignItems: "center", paddingVertical: spacing.sm },
});
