import { useNavigation } from "@react-navigation/native";
import * as Notifications from "expo-notifications";
import { useCallback, useEffect, useState } from "react";
import { AppState, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { fetchNotifications } from "../screens/NotificationsScreen";
import { colors } from "../theme";

/**
 * Mobile counterpart of the web header's notification bell (with unread count)
 * and the floating assistant button. Rendered over the tab screens.
 */
export default function FloatingActions() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const [unread, setUnread] = useState(0);

  const refresh = useCallback(() => {
    fetchNotifications().then((items) => setUnread(items.filter((n) => !n.read).length)).catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 25000); // same cadence as the web bell
    const received = Notifications.addNotificationReceivedListener(refresh);
    const appState = AppState.addEventListener("change", (s) => { if (s === "active") refresh(); });
    const focus = navigation.addListener("focus", refresh);
    return () => { clearInterval(timer); received.remove(); appState.remove(); focus(); };
  }, [refresh, navigation]);

  return (
    <>
      <View pointerEvents="box-none" style={[styles.top, { top: insets.top + 6 }]}>
        <TouchableOpacity style={styles.bell} onPress={() => navigation.navigate("Notifications")}
          accessibilityRole="button" accessibilityLabel={unread ? `Notifications, ${unread} unread` : "Notifications"}>
          <Text style={{ fontSize: 18 }}>🔔</Text>
          {unread > 0 && (
            <View style={styles.badge}><Text style={styles.badgeText}>{unread > 9 ? "9+" : unread}</Text></View>
          )}
        </TouchableOpacity>
      </View>
      <TouchableOpacity style={[styles.assistant, { bottom: 64 + insets.bottom }]}
        onPress={() => navigation.navigate("Assistant")} accessibilityRole="button" accessibilityLabel="Open assistant">
        <Text style={styles.assistantText}>Ask</Text>
      </TouchableOpacity>
    </>
  );
}

const styles = StyleSheet.create({
  top: { position: "absolute", right: 12 },
  bell: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.paperRaised, alignItems: "center", justifyContent: "center",
    shadowColor: "#000", shadowOpacity: 0.12, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 3 },
  badge: { position: "absolute", top: -2, right: -2, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: colors.danger,
    alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  badgeText: { color: "#fff", fontSize: 11, fontWeight: "700" },
  assistant: { position: "absolute", right: 16, height: 48, paddingHorizontal: 18, borderRadius: 24, backgroundColor: colors.navyInk,
    alignItems: "center", justifyContent: "center", elevation: 4, shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 6 },
  assistantText: { color: colors.gold, fontWeight: "800", fontSize: 15 },
});
