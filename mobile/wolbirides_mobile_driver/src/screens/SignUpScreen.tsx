import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "../auth/AuthContext";
import { COPY } from "../appConfig";
import { Button, ErrorBanner, FieldLabel, TextField } from "../components/ui";
import type { AuthStackScreenProps } from "../navigation/types";
import { authStyles as styles } from "./SignInScreen";

function firstError(data: any): string | null {
  if (!data) return null;
  if (typeof data.detail === "string") return data.detail;
  const first = Object.values(data)[0];
  return Array.isArray(first) ? String(first[0]) : null;
}

export default function SignUpScreen({ navigation }: AuthStackScreenProps<"SignUp">) {
  const { requestSignupCode, signup } = useAuth();
  const [step, setStep] = useState<"details" | "code">("details");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSendCode() {
    setError(null);
    if (password.length < 8) {
      setError("Use at least 8 characters for your password.");
      return;
    }
    setBusy(true);
    try {
      await requestSignupCode(email.trim().toLowerCase());
      setStep("code");
    } catch (err: any) {
      setError(firstError(err?.response?.data) || "Couldn't send a code to that email. Check it and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleCreate() {
    setError(null);
    setBusy(true);
    try {
      await signup(email.trim().toLowerCase(), code.trim(), password, name.trim());
    } catch (err: any) {
      setError(firstError(err?.response?.data) || "That code didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={["top"]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <View style={styles.hero}>
          <View style={styles.logoMark}><Text style={styles.logoMarkText}>WR</Text></View>
          <Text style={styles.heroTitle}>{COPY.signUpTitle}</Text>
          <Text style={styles.heroSubtitle}>{COPY.signUpSubtitle}</Text>
        </View>

        <ScrollView contentContainerStyle={styles.formArea} keyboardShouldPersistTaps="handled">
          {step === "details" ? (
            <>
              <FieldLabel>Full name</FieldLabel>
              <TextField value={name} onChangeText={setName} placeholder="e.g. Amina Yakubu" autoComplete="name" />
              <FieldLabel>Email</FieldLabel>
              <TextField value={email} onChangeText={setEmail} placeholder="you@example.com" keyboardType="email-address"
                autoCapitalize="none" autoComplete="email" />
              <FieldLabel>Password</FieldLabel>
              <TextField value={password} onChangeText={setPassword} placeholder="At least 8 characters" secureTextEntry
                autoComplete="new-password" />
              {error && <ErrorBanner message={error} />}
              <Button title={busy ? "Sending code…" : "Send verification code"} onPress={handleSendCode}
                variant="primary" loading={busy} disabled={!name.trim() || !email.trim() || !password} />
            </>
          ) : (
            <>
              <FieldLabel>{`Enter the code we emailed to ${email}`}</FieldLabel>
              <TextField value={code} onChangeText={setCode} placeholder="6-digit code" keyboardType="number-pad"
                maxLength={6} autoFocus />
              {error && <ErrorBanner message={error} />}
              <Button title={busy ? "Creating account…" : "Create account"} onPress={handleCreate} variant="primary"
                loading={busy} disabled={code.trim().length < 4} />
              <TouchableOpacity onPress={() => { setStep("details"); setError(null); }} style={styles.backLink}>
                <Text style={styles.backLinkText}>Change my details</Text>
              </TouchableOpacity>
            </>
          )}

          <View style={styles.switchRow}>
            <Text style={styles.switchText}>Already have an account? </Text>
            <TouchableOpacity onPress={() => navigation.navigate("SignIn")}>
              <Text style={styles.switchLink}>Sign in</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
