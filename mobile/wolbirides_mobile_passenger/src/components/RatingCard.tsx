import { useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { api } from "../api/client";
import { colors, spacing } from "../theme";
import { Button, Card } from "./ui";

/** Star rating for one completed trip. Used both right after a trip finishes and
 * from the standalone Rate Driver screen for a trip rated later. */
export default function RatingCard({ tripId, driverName, onDone }: { tripId: string; driverName?: string; onDone: () => void }) {
  const [rating, setRating] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (rating == null) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/trips/${tripId}/rating`, { score: rating, issue_tags: [], comment: "" });
      onDone();
    } catch {
      setError("Couldn't submit your rating.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card style={styles.card}>
      <Text style={styles.title}>{driverName ? `How was your ride with ${driverName}?` : "How was your ride?"}</Text>
      <View style={styles.stars}>
        {[1, 2, 3, 4, 5].map((n) => (
          <TouchableOpacity key={n} onPress={() => setRating(n)} accessibilityRole="button" accessibilityLabel={`${n} star${n > 1 ? "s" : ""}`}>
            <Text style={[styles.star, rating != null && n <= rating && styles.starFilled]}>★</Text>
          </TouchableOpacity>
        ))}
      </View>
      {error && <Text style={{ color: colors.danger, fontSize: 13, marginBottom: spacing.sm }}>{error}</Text>}
      <Button title={busy ? "Submitting…" : "Submit rating"} onPress={submit} variant="gold" disabled={rating == null || busy} />
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { alignItems: "center" },
  title: { fontSize: 15, fontWeight: "600", marginBottom: spacing.md, textAlign: "center" },
  stars: { flexDirection: "row", gap: 6, marginBottom: spacing.md },
  star: { fontSize: 30, color: colors.line },
  starFilled: { color: colors.gold },
});
