import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import SupportCard from "../components/SupportCard";
import { colors, spacing, typography } from "../theme";
import type { RootStackScreenProps } from "../navigation/types";

/** General help, reachable from the Ride menu — not tied to any one trip. */
export default function SupportScreen({ navigation }: RootStackScreenProps<"Support">) {
  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={navigation.goBack} accessibilityLabel="Back"><Text style={styles.back}>‹ Back</Text></TouchableOpacity>
        <Text style={typography.h1}>Support & Help</Text>
        <View style={{ width: 60 }} />
      </View>
      <ScrollView contentContainerStyle={{ padding: spacing.md }}>
        <SupportCard />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  back: { color: colors.navyInk, fontSize: 16, width: 60 },
});
