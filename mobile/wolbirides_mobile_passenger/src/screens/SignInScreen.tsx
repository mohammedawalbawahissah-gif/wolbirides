import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "../auth/AuthContext";
import { Button, ErrorBanner, FieldLabel, TextField } from "../components/ui";
import { colors, spacing } from "../theme";
import type { AuthStackScreenProps } from "../navigation/types";

export default function SignInScreen({ navigation }: AuthStackScreenProps<"SignIn">) {
  const { requestOtp, verifyOtp } = useAuth();
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleRequestOtp() {
    setError(null);
    setBusy(true);
    try {
      await requestOtp(phone);
      setStep("code");
    } catch {
      setError("Couldn't send a code to that number. Check it and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleVerify() {
    setError(null);
    setBusy(true);
    try {
      await verifyOtp(phone, code);
      // RootNavigator swaps to the main stack automatically once `user` is set.
    } catch (err: any) {
      setError(err?.response?.data?.detail || "That code didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={["top"]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <View style={styles.hero}>
          <View style={styles.logoMark}><Text style={styles.logoMarkText}>WR</Text></View>
          <Text style={styles.heroTitle}>WolbiRides</Text>
          <Text style={styles.heroSubtitle}>Request a yellow-yellow, see it coming, ride with confidence.</Text>
        </View>

        <ScrollView contentContainerStyle={styles.formArea} keyboardShouldPersistTaps="handled">
          {step === "phone" ? (
            <>
              <FieldLabel>Phone number</FieldLabel>
              <TextField
                value={phone}
                onChangeText={setPhone}
                placeholder="+233 XX XXX XXXX"
                keyboardType="phone-pad"
                autoFocus
              />
              {error && <ErrorBanner message={error} />}
              <Button title={busy ? "Sending…" : "Send code"} onPress={handleRequestOtp} variant="primary" loading={busy} />
            </>
          ) : (
            <>
              <FieldLabel>{`Enter the code sent to ${phone}`}</FieldLabel>
              <TextField
                value={code}
                onChangeText={setCode}
                placeholder="6-digit code"
                keyboardType="number-pad"
                maxLength={6}
                autoFocus
              />
              {error && <ErrorBanner message={error} />}
              <Button title={busy ? "Verifying…" : "Sign in"} onPress={handleVerify} variant="primary" loading={busy} />
              <TouchableOpacity onPress={() => { setStep("phone"); setError(null); }} style={styles.backLink}>
                <Text style={styles.backLinkText}>Use a different number</Text>
              </TouchableOpacity>
            </>
          )}

          <View style={styles.switchRow}>
            <Text style={styles.switchText}>New to WolbiRides? </Text>
            <TouchableOpacity onPress={() => navigation.navigate("SignUp")}>
              <Text style={styles.switchLink}>Create an account</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.paper },
  hero: {
    backgroundColor: colors.navyInk,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.lg,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
  },
  logoMark: {
    width: 44, height: 44, borderRadius: 12, backgroundColor: colors.gold,
    alignItems: "center", justifyContent: "center", marginBottom: spacing.md,
  },
  logoMarkText: { color: colors.navyInk, fontWeight: "700", fontSize: 17 },
  heroTitle: { color: "#FFFFFF", fontSize: 26, fontWeight: "700", marginBottom: spacing.xs },
  heroSubtitle: { color: "#C7CCD8", fontSize: 14.5, lineHeight: 20 },
  formArea: { padding: spacing.lg },
  backLink: { paddingVertical: spacing.sm },
  backLinkText: { color: colors.inkMuted, fontSize: 13.5, textDecorationLine: "underline" },
  switchRow: { flexDirection: "row", justifyContent: "center", marginTop: spacing.lg },
  switchText: { fontSize: 13.5, color: colors.inkMuted },
  switchLink: { fontSize: 13.5, color: colors.navyInk, fontWeight: "700", textDecorationLine: "underline" },
});
