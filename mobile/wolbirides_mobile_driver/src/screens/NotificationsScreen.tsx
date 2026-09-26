import { useCallback, useEffect, useState } from "react";
import { FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "../api/client";
import { EmptyState } from "../components/ui";
import { openLink } from "../navigation/links";
import { colors, radii, spacing, typography } from "../theme";

export interface AppNotification {
  id: string; title: string; body: string; category: string; link: string; read: boolean; created_at: string;
}

function timeAgo(iso: string) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(iso).toLocaleDateString();
}

export async function fetchNotifications(): Promise<AppNotification[]> {
  const { data } = await api.get<{ results: AppNotification[] } | AppNotification[]>("/notifications");
  return Array.isArray(data) ? data : data.results;
}

/** Same list, read state and links as the web notification bell. */
export default function NotificationsScreen({ navigation }: { navigation: { goBack: () => void } }) {
  const [items, setItems] = useState<AppNotification[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems(await fetchNotifications());
    } catch {
      setItems([]);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  function open(item: AppNotification) {
    if (!item.read) {
      setItems((prev) => prev?.map((n) => (n.id === item.id ? { ...n, read: true } : n)) ?? prev);
      api.post(`/notifications/${item.id}/read`).catch(() => {});
    }
    if (item.link) openLink(item.link);
  }

  function readAll() {
    setItems((prev) => prev?.map((n) => ({ ...n, read: true })) ?? prev);
    api.post("/notifications/read-all").catch(() => {});
  }

  const unread = items?.filter((n) => !n.read).length ?? 0;
  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={navigation.goBack} accessibilityLabel="Back"><Text style={styles.back}>‹ Back</Text></TouchableOpacity>
        <Text style={typography.h1}>Notifications</Text>
        {unread > 0 ? (
          <TouchableOpacity onPress={readAll}><Text style={styles.readAll}>Mark all read</Text></TouchableOpacity>
        ) : <View style={{ width: 90 }} />}
      </View>
      <FlatList
        data={items ?? []}
        keyExtractor={(n) => n.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
        ListEmptyComponent={items ? <EmptyState message="You're all caught up." /> : null}
        contentContainerStyle={{ padding: spacing.md }}
        renderItem={({ item }) => (
          <TouchableOpacity onPress={() => open(item)} style={[styles.item, !item.read && styles.unread]}
            accessibilityRole="button" accessibilityState={{ selected: !item.read }}>
            <Text style={styles.title}>{item.title}</Text>
            {!!item.body && <Text style={typography.muted}>{item.body}</Text>}
            <Text style={styles.time}>{timeAgo(item.created_at)}</Text>
          </TouchableOpacity>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  back: { color: colors.navyInk, fontSize: 16, width: 90 },
  readAll: { color: colors.navyInk, fontSize: 13.5, fontWeight: "600", width: 90, textAlign: "right" },
  item: { backgroundColor: colors.paperRaised, borderRadius: radii.md, padding: spacing.md, marginBottom: spacing.sm, gap: 2 },
  unread: { borderLeftWidth: 4, borderLeftColor: colors.gold },
  title: { fontWeight: "700", color: colors.ink, fontSize: 15 },
  time: { fontSize: 12, color: colors.inkMuted, marginTop: 4 },
});
