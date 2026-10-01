import { useState } from "react";
import { Image, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { API_BASE_URL, requestErrorMessage } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { COPY } from "../appConfig";
import PasswordField from "../components/PasswordField";
import { Button, ErrorBanner, FieldLabel, TextField } from "../components/ui";
import { colors, spacing } from "../theme";
import type { AuthStackScreenProps } from "../navigation/types";

export default function SignInScreen({ navigation }: AuthStackScreenProps<"SignIn">) {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSignIn() {
    setError(null);
    setBusy(true);
    try {
      await login(email.trim().toLowerCase(), password);
      // RootNavigator swaps to the main stack once `user` is set.
    } catch (err: any) {
      setError(requestErrorMessage(err, "That email and password don't match. Try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={["top"]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <View style={styles.hero}>
          <Image source={require("../../assets/logo-mark.png")} style={styles.logoMark} />
          <Text style={styles.heroName}>WolbiRides</Text>
        </View>

        <ScrollView contentContainerStyle={styles.formArea} keyboardShouldPersistTaps="handled">
          <FieldLabel>Email</FieldLabel>
          <TextField value={email} onChangeText={setEmail} placeholder="you@example.com" keyboardType="email-address"
            autoCapitalize="none" autoComplete="email" autoFocus />
          <FieldLabel>Password</FieldLabel>
          <PasswordField value={password} onChangeText={setPassword} placeholder="Your password"
            autoComplete="password" />
          <TouchableOpacity onPress={() => navigation.navigate("ForgotPassword")} style={{ alignSelf: "flex-end", marginBottom: spacing.sm }}>
            <Text style={styles.switchLink}>Forgot password?</Text>
          </TouchableOpacity>
          {error && <ErrorBanner message={error} />}
          <Button title={busy ? "Signing in…" : "Sign in"} onPress={handleSignIn} variant="primary" loading={busy}
            disabled={!email.trim() || !password} />

          <View style={styles.switchRow}>
            <Text style={styles.switchText}>New to WolbiRides? </Text>
            <TouchableOpacity onPress={() => navigation.navigate("SignUp")}>
              <Text style={styles.switchLink}>Create an account</Text>
            </TouchableOpacity>
          </View>
          {/* Developers only: which backend this build is talking to, the first thing to check when sign-in fails. */}
          {__DEV__ && <Text style={styles.devServer}>Server: {API_BASE_URL}</Text>}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export const authStyles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.paper },
  hero: {
    backgroundColor: colors.navyInk,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.lg,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
    alignItems: "center",
  },
  logoMark: {
    width: 72, height: 72, borderRadius: 18, marginBottom: spacing.md,
  },
  heroName: { color: "#FFFFFF", fontSize: 22, fontWeight: "700", letterSpacing: -0.3 },
  formArea: { padding: spacing.lg },
  backLink: { paddingVertical: spacing.sm },
  backLinkText: { color: colors.inkMuted, fontSize: 13.5, textDecorationLine: "underline" },
  switchRow: { flexDirection: "row", justifyContent: "center", marginTop: spacing.lg },
  devServer: { marginTop: spacing.lg, textAlign: "center", fontSize: 12, color: colors.inkMuted },
  switchText: { fontSize: 13.5, color: colors.inkMuted },
  switchLink: { fontSize: 13.5, color: colors.navyInk, fontWeight: "700", textDecorationLine: "underline" },
});
const styles = authStyles;
