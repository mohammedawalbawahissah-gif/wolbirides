import { useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "../api/client";
import { APP_ROLE } from "../appConfig";

// Shared between both apps, so compare as a plain string.
const ROLE: string = APP_ROLE;
import { Button, TextField } from "../components/ui";
import { colors, radii, spacing, typography } from "../theme";

interface DraftTrip {
  pickup_label: string; pickup_lat: number; pickup_lng: number;
  destination_label: string; destination_lat: number; destination_lng: number;
}
interface ChatMessage { role: "user" | "assistant"; content: string; draft?: DraftTrip }

const GREETING = ROLE === "driver"
  ? "Hi! Ask me about going online, payouts, deliveries, or anything about driving with WolbiRides."
  : "Hi! Ask me about fares, your trips, or say where you want to go and I'll set up the ride for you.";

/**
 * Mobile counterpart of the web assistant panel (WR-15). Opened from a trip,
 * it carries that trip_id so fare questions get the real breakdown.
 * Riders get the same "Book this ride" drafts; booking uses the normal
 * POST /trips, so fares and checks are identical to booking from the map.
 */
export default function AssistantScreen({ navigation, route }: any) {
  const params = route?.params as { tripId?: string; label?: string; message?: string } | undefined;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [trip, setTrip] = useState<{ id: string; label: string } | null>(
    params?.tripId ? { id: params.tripId, label: params.label || "this trip" } : null);
  const scroll = useRef<ScrollView>(null);

  useEffect(() => {
    if (params?.message) send(params.message);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function send(text: string) {
    if (!text.trim() || busy) return;
    setError(null);
    const history = messages.map(({ role, content }) => ({ role, content }));
    setMessages((prev) => [...prev, { role: "user", content: text.trim() }]);
    setInput("");
    setBusy(true);
    try {
      const { data } = await api.post<{ reply: string; draft_trip?: DraftTrip }>("/assistant/chat", {
        message: text.trim(), history, ...(trip ? { trip_id: trip.id } : {}),
      });
      setMessages((prev) => [...prev, { role: "assistant", content: data.reply, draft: data.draft_trip }]);
    } catch (err: any) {
      setError(err?.response?.data?.detail || "The assistant couldn't respond right now.");
    } finally {
      setBusy(false);
      setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 50);
    }
  }

  async function book(draft: DraftTrip) {
    setBusy(true);
    try {
      const { data: zones } = await api.get<{ id: string }[]>("/zones");
      const { data } = await api.post("/trips", {
        zone_id: zones[0].id,
        pickup_lat: draft.pickup_lat.toFixed(6), pickup_lng: draft.pickup_lng.toFixed(6), pickup_label: draft.pickup_label,
        destination_lat: draft.destination_lat.toFixed(6), destination_lng: draft.destination_lng.toFixed(6),
        destination_label: draft.destination_label,
      });
      navigation.replace("TripStatus", { tripId: data.id });
    } catch {
      setError("Couldn't book that ride. Try again, or book from the map.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={navigation.goBack} accessibilityLabel="Close assistant"><Text style={styles.close}>✕</Text></TouchableOpacity>
        <Text style={typography.h2}>WolbiRides Assistant</Text>
        <View style={{ width: 24 }} />
      </View>
      {trip && (
        <View style={styles.context}>
          <Text style={{ flex: 1, fontSize: 13 }}>About your trip: {trip.label}</Text>
          <TouchableOpacity onPress={() => setTrip(null)} accessibilityLabel="Stop asking about this trip"><Text>✕</Text></TouchableOpacity>
        </View>
      )}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView ref={scroll} contentContainerStyle={{ padding: spacing.md, gap: spacing.sm }}>
          <View style={[styles.bubble, styles.assistant]}><Text style={styles.text}>{GREETING}</Text></View>
          {messages.map((m, i) => (
            <View key={i} style={{ gap: 6 }}>
              {!!m.content && (
                <View style={[styles.bubble, m.role === "user" ? styles.user : styles.assistant]}>
                  <Text style={[styles.text, m.role === "user" && { color: "#fff" }]}>{m.content}</Text>
                </View>
              )}
              {m.draft && ROLE === "passenger" && (
                <View style={styles.draft}>
                  <Text style={styles.text}>● {m.draft.pickup_label}</Text>
                  <Text style={styles.text}>■ {m.draft.destination_label}</Text>
                  <Button title={busy ? "Booking…" : "Book this ride"} variant="gold" onPress={() => book(m.draft!)} disabled={busy} />
                </View>
              )}
            </View>
          ))}
          {busy && <Text style={typography.muted}>Thinking…</Text>}
          {error && <Text style={{ color: colors.danger }}>{error}</Text>}
        </ScrollView>
        <View style={styles.inputRow}>
          <View style={{ flex: 1 }}>
            <TextField value={input} onChangeText={setInput} placeholder="Ask a question…" onSubmitEditing={() => send(input)} returnKeyType="send" />
          </View>
          <Button title="Send" variant="primary" onPress={() => send(input)} disabled={!input.trim() || busy} />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: spacing.md },
  close: { fontSize: 20, color: colors.inkMuted },
  context: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: spacing.md, paddingVertical: 6,
    backgroundColor: colors.paperRaised, borderBottomWidth: 1, borderBottomColor: colors.line },
  bubble: { maxWidth: "85%", padding: spacing.sm, borderRadius: radii.md },
  assistant: { alignSelf: "flex-start", backgroundColor: colors.paperRaised },
  user: { alignSelf: "flex-end", backgroundColor: colors.navyInk },
  text: { fontSize: 15, color: colors.ink, lineHeight: 20 },
  draft: { alignSelf: "flex-start", width: "85%", borderWidth: 1, borderColor: colors.gold, borderRadius: radii.md, padding: spacing.sm, gap: 6 },
  inputRow: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start", padding: spacing.sm, borderTopWidth: 1, borderTopColor: colors.line },
});
