import { useState } from "react";
import { Image, KeyboardAvoidingView, Platform, ScrollView, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import PasswordField from "../components/PasswordField";
import { Button, ErrorBanner, FieldLabel, TextField } from "../components/ui";
import type { AuthStackScreenProps } from "../navigation/types";
import { typography } from "../theme";
import { authStyles as styles } from "./SignInScreen";

/** Same two steps as the web page: email → code + new password. Signs you in; signs out other devices. */
export default function ForgotPasswordScreen({ navigation }: AuthStackScreenProps<"ForgotPassword">) {
  const { resetPassword } = useAuth();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function sendCode() {
    setBusy(true);
    setError(null);
    try {
      const { data } = await api.post("/auth/password/reset/request", { email: email.trim().toLowerCase() });
      setInfo(data.detail);
      setStep("code");
    } catch (err: any) {
      setError(err?.response?.status === 429 ? "Too many requests. Wait a few minutes and try again."
        : err?.response?.data?.detail || "Couldn't send a code right now.");
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    setBusy(true);
    setError(null);
    try {
      await resetPassword(email.trim().toLowerCase(), code.trim(), password);
      // RootNavigator switches to the signed-in app once the user is stored.
    } catch (err: any) {
      setError(err?.response?.data?.detail || "That didn't work. Check the code and try again.");
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
          {step === "email" ? (
            <>
              <FieldLabel>Email you signed up with</FieldLabel>
              <TextField value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none"
                autoComplete="email" autoFocus />
              {error && <ErrorBanner message={error} />}
              <Button title={busy ? "Sending…" : "Send reset code"} variant="primary" onPress={sendCode} loading={busy}
                disabled={!email.includes("@")} />
            </>
          ) : (
            <>
              <Text style={[typography.muted, { marginBottom: 12 }]}>{info}</Text>
              <FieldLabel>Code from the email</FieldLabel>
              <TextField value={code} onChangeText={(t) => setCode(t.replace(/\D/g, ""))} keyboardType="number-pad"
                maxLength={6} autoComplete="one-time-code" autoFocus />
              <FieldLabel>New password</FieldLabel>
              <PasswordField value={password} onChangeText={setPassword} autoComplete="new-password" />
              {error && <ErrorBanner message={error} />}
              <Button title={busy ? "Saving…" : "Set new password and sign in"} variant="primary" onPress={reset} loading={busy}
                disabled={code.length !== 6 || password.length < 8} />
              <TouchableOpacity onPress={sendCode} disabled={busy} style={styles.backLink}>
                <Text style={styles.backLinkText}>Send a new code</Text>
              </TouchableOpacity>
            </>
          )}
          <View style={styles.switchRow}>
            <Text style={styles.switchText}>Remembered it? </Text>
            <TouchableOpacity onPress={() => navigation.navigate("SignIn")}><Text style={styles.switchLink}>Sign in</Text></TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
