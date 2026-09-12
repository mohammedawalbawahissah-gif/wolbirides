import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useAuth } from "../auth/AuthContext";
import { Button, Card, FieldLabel, TextField } from "../components/ui";
import { colors, spacing, typography } from "../theme";

export default function ProfileScreen() {
  const { user, updateName, logout } = useAuth();
  const [name, setName] = useState(user?.name || "");
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    await updateName(name);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={typography.h1}>Profile</Text>
      <Text style={[typography.muted, styles.subtitle]}>{user?.phone}</Text>

      <Card style={styles.card}>
        <FieldLabel>Name</FieldLabel>
        <TextField value={name} onChangeText={setName} placeholder="Your name" />
        <Button title={saved ? "Saved ✓" : "Save changes"} onPress={handleSave} variant="primary" />
      </Card>

      <View style={styles.spacer} />

      <Button title="Log out" onPress={logout} variant="ghost" />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  content: { padding: spacing.lg },
  subtitle: { marginBottom: spacing.lg },
  card: { marginBottom: spacing.md },
  spacer: { height: spacing.lg },
});
