import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Badge, Card } from "../components/ui";
import { colors, spacing, typography } from "../theme";

export default function PendingScreen({ licenceNumber }: { licenceNumber: string }) {
  return (
    <SafeAreaView style={styles.safeArea} edges={["top"]}>
      <View style={styles.content}>
        <Text style={typography.h1}>Application received</Text>
        <Text style={[typography.muted, styles.subtitle]}>
          Your documents are being reviewed against the WR-07.2 compliance checklist (licence,
          vehicle registration, and required documentation).
        </Text>

        <Card>
          <Text style={styles.label}>Licence number</Text>
          <Text style={styles.licence}>{licenceNumber}</Text>
          <View style={styles.badgeRow}>
            <Badge label="Pending review" tone="warning" />
          </View>
        </Card>

        <Text style={styles.footnote}>
          You'll be able to go online as soon as ops approves your application. This usually
          happens quickly during the founding-driver pilot — check back soon.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.paper },
  content: { padding: spacing.lg },
  subtitle: { marginBottom: spacing.lg, lineHeight: 19 },
  label: { fontSize: 13, color: colors.inkMuted, marginBottom: 4 },
  licence: { fontWeight: "700", fontSize: 16, color: colors.ink, fontFamily: "monospace" },
  badgeRow: { marginTop: spacing.md },
  footnote: { fontSize: 13, color: colors.inkMuted, marginTop: spacing.lg, lineHeight: 18 },
});
