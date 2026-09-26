import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { api } from "../api/client";
import { colors, spacing, typography } from "../theme";
import { Badge, Button, Card, ErrorBanner, FieldLabel, TextField } from "./ui";

interface Ticket { id: string; status: string; subject: string; created_at: string }
const STATUS_LABEL: Record<string, string> = { open: "Open", in_progress: "Being handled", resolved: "Resolved" };
const CATEGORIES = [["trip_issue", "A trip"], ["payment", "Payment"], ["account", "My account"], ["other", "Something else"]] as const;

/** Same as web: "Help & support" with recent tickets, or (with tripId) "problem with this trip". */
export default function SupportCard({ tripId }: { tripId?: string }) {
  const [category, setCategory] = useState<string>(tripId ? "trip_issue" : "other");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tickets, setTickets] = useState<Ticket[]>([]);

  function load() {
    if (!tripId) api.get<Ticket[]>("/support/tickets").then(({ data }) => setTickets(data)).catch(() => {});
  }
  useEffect(load, [tripId]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api.post("/support/tickets", { category, subject: subject.trim(), description: description.trim(),
        ...(tripId ? { trip: tripId } : {}) });
      setSubject(""); setDescription(""); setSent(true);
      load();
    } catch {
      setError("Couldn't send that. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card style={{ marginBottom: spacing.md }}>
      <Text style={typography.h2}>{tripId ? "Report a problem with this trip" : "Help & support"}</Text>
      {sent && <Text style={{ color: colors.success, marginVertical: spacing.xs }}>Sent. Our support team will get back to you.</Text>}
      {!tripId && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginVertical: spacing.sm }}>
          {CATEGORIES.map(([value, label]) => (
            <Button key={value} title={label} variant={category === value ? "primary" : "ghost"} onPress={() => setCategory(value)} />
          ))}
        </View>
      )}
      <FieldLabel>Subject</FieldLabel>
      <TextField value={subject} onChangeText={setSubject} maxLength={200}
        placeholder={tripId ? "e.g. I was charged the wrong fare" : ""} />
      <FieldLabel>Details</FieldLabel>
      <TextField value={description} onChangeText={setDescription} multiline />
      {error && <ErrorBanner message={error} />}
      <Button title={busy ? "Sending…" : "Send to support"} variant="primary" onPress={submit} loading={busy} disabled={!subject.trim()} />
      {tickets.slice(0, 5).map((t) => (
        <View key={t.id} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center",
          paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: colors.line, marginTop: spacing.xs }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontWeight: "600", color: colors.ink }}>{t.subject}</Text>
            <Text style={typography.muted}>{new Date(t.created_at).toLocaleDateString()}</Text>
          </View>
          <Badge label={STATUS_LABEL[t.status] ?? t.status} tone={t.status === "resolved" ? "success" : "warning"} />
        </View>
      ))}
    </Card>
  );
}
