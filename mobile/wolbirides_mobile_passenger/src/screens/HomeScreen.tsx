import { ScrollView, StyleSheet, Text, TouchableOpacity } from "react-native";
import { useAuth } from "../auth/AuthContext";
import { colors, radii, spacing, typography } from "../theme";
import type { MainTabScreenProps } from "../navigation/types";

const CARDS = [
  { to: "BookRide" as const, params: { initialKind: "ride" as const }, icon: "🛺", title: "Request a Ride", blurb: "Book a yellow-yellow around campus and Tamale." },
  { to: "BookRide" as const, params: { initialKind: "delivery" as const }, icon: "📦", title: "Delivery", blurb: "Send or receive a package with WolbiDeliver." },
  { to: "RateDriver" as const, params: undefined, icon: "⭐", title: "Rate Rider", blurb: "Rate a completed trip you haven't rated yet." },
  { to: "Support" as const, params: undefined, icon: "🛟", title: "Support & Help", blurb: "Get help, or tell us about a problem." },
];

/** The Ride tab's landing menu, mirroring the web app's Home page. Each card opens its own screen. */
export default function HomeScreen({ navigation }: MainTabScreenProps<"Ride">) {
  const { user } = useAuth();
  const firstName = (user?.name || "").split(" ")[0];

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={typography.h1}>{firstName ? `Hi, ${firstName}` : "Welcome"}</Text>
      <Text style={[typography.muted, styles.subtitle]}>What would you like to do?</Text>

      {CARDS.map((c) => (
        <TouchableOpacity key={c.title} style={styles.card} onPress={() => navigation.navigate(c.to as any, c.params as any)}>
          <Text style={styles.icon}>{c.icon}</Text>
          <Text style={styles.title}>{c.title}</Text>
          <Text style={styles.blurb}>{c.blurb}</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  content: { padding: spacing.lg, paddingBottom: spacing.xl },
  subtitle: { marginBottom: spacing.lg },
  card: {
    padding: 22, marginBottom: spacing.md, borderWidth: 1, borderColor: colors.line, borderRadius: radii.md,
    backgroundColor: colors.paperRaised,
  },
  icon: { fontSize: 30, marginBottom: 6 },
  title: { fontSize: 17, fontWeight: "700", color: colors.ink, marginBottom: 4 },
  blurb: { fontSize: 13.5, color: colors.inkMuted },
});
