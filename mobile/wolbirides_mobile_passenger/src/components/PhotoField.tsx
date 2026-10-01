import { useState } from "react";
import { Alert, Image, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useAuth } from "../auth/AuthContext";
import { pickAndUpload } from "../upload";
import { colors, spacing, typography } from "../theme";

/** Profile photo, same upload endpoint and field as the web profile. */
export default function PhotoField() {
  const { user, updateProfile } = useAuth();
  const [busy, setBusy] = useState(false);

  async function choose(source: "camera" | "library") {
    setBusy(true);
    try {
      const url = await pickAndUpload("profile_photo", source);
      if (url) await updateProfile({ profile_photo: url });
    } catch (err: any) {
      Alert.alert("Couldn't update your photo", err?.message === "permission"
        ? "Allow camera or photo access in your phone's settings." : "Try a smaller image (under 8 MB).");
    } finally {
      setBusy(false);
    }
  }

  const initials = (user?.name || "WR").split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  return (
    <View style={styles.row}>
      {user?.profile_photo ? <Image source={{ uri: user.profile_photo }} style={styles.photo} accessibilityLabel="Your profile photo" />
        : <View style={[styles.photo, styles.placeholder]}><Text style={styles.initials}>{initials}</Text></View>}
      <View style={{ gap: 6 }}>
        {busy && <Text style={typography.muted}>Uploading…</Text>}
        <View style={{ flexDirection: "row", gap: 14 }}>
          <TouchableOpacity disabled={busy} onPress={() => choose("camera")}><Text style={styles.link}>Take photo</Text></TouchableOpacity>
          <TouchableOpacity disabled={busy} onPress={() => choose("library")}><Text style={styles.link}>Choose photo</Text></TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginBottom: spacing.md },
  photo: { width: 64, height: 64, borderRadius: 32 },
  placeholder: { backgroundColor: colors.navyInk, alignItems: "center", justifyContent: "center" },
  initials: { color: colors.gold, fontWeight: "800", fontSize: 20 },
  link: { color: colors.navyInk, fontWeight: "700", textDecorationLine: "underline" },
});
