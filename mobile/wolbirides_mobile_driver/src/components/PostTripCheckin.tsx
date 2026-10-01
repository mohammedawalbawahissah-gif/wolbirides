import { useState } from "react";
import { Text, View } from "react-native";
import { api } from "../api/client";
import { colors, spacing, typography } from "../theme";
import { Button, Card, TextField } from "./ui";

/** WR-18: drivers face harassment too. Same post-trip check-in as passengers, separate from ratings. */
export default function PostTripCheckin({ tripId }: { tripId: string }) {
  const [state, setState] = useState<"ask" | "details" | "done">("ask");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);

  async function send(response: "fine" | "something_off") {
    setBusy(true);
    try {
      await api.post(`/trips/${tripId}/checkin`, { response, details: details.trim() });
      setState("done");
    } finally {
      setBusy(false);
    }
  }

  if (state === "done") return null;
  return (
    <Card style={{ marginTop: spacing.md, borderLeftWidth: 4, borderLeftColor: colors.navyInk, gap: spacing.sm }}>
      <Text style={typography.h2}>Safety check: did anything feel off?</Text>
      {state === "ask" ? (
        <View style={{ flexDirection: "row", gap: spacing.sm }}>
          <Button title="No, all fine" variant="ghost" onPress={() => send("fine")} disabled={busy} style={{ flex: 1 }} />
          <Button title="Something felt off" variant="ghost" onPress={() => setState("details")} style={{ flex: 1 }} />
        </View>
      ) : (
        <>
          <TextField value={details} onChangeText={setDetails} placeholder="What happened? (optional)" multiline />
          <Button title="Send to safety team" variant="primary" onPress={() => send("something_off")} loading={busy} />
          <Text style={typography.muted}>In danger now? Use SOS or call 112.</Text>
        </>
      )}
    </Card>
  );
}
