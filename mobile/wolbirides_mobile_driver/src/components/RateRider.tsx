import { useState } from "react";
import { Text, TouchableOpacity, View } from "react-native";
import { api } from "../api/client";
import { colors, spacing, typography } from "../theme";
import { Button, Card } from "./ui";

/** Same as web: drivers rate riders once a trip is complete; once per trip. */
export default function RateRider({ tripId, alreadyRated }: { tripId: string; alreadyRated?: boolean }) {
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(!!alreadyRated);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      await api.post(`/trips/${tripId}/rating`, { score, issue_tags: [], comment: "" });
      setDone(true);
    } catch (err: any) {
      if (err?.response?.status === 409) setDone(true);
    } finally {
      setBusy(false);
    }
  }

  if (done) return null;
  return (
    <Card style={{ marginTop: spacing.md, gap: spacing.sm }}>
      <Text style={typography.h2}>How was this rider?</Text>
      <View style={{ flexDirection: "row", gap: 6 }} accessibilityRole="radiogroup">
        {[1, 2, 3, 4, 5].map((n) => (
          <TouchableOpacity key={n} onPress={() => setScore(n)} accessibilityRole="radio"
            accessibilityState={{ checked: score === n }} accessibilityLabel={`${n} star${n > 1 ? "s" : ""}`}>
            <Text style={{ fontSize: 30, color: n <= score ? colors.gold : colors.line }}>★</Text>
          </TouchableOpacity>
        ))}
      </View>
      <Button title="Submit rating" variant="primary" onPress={submit} disabled={!score || busy} />
    </Card>
  );
}
