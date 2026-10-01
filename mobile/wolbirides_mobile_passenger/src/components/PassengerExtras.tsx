import * as Location from "expo-location";
import { useCallback, useEffect, useState } from "react";
import { Alert, Share, StyleSheet, Switch, Text, TouchableOpacity, View } from "react-native";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { colors, radii, spacing, typography } from "../theme";
import { Button, Card, ErrorBanner, TextField } from "./ui";

// ---------- types ----------
export interface SavedAddress { id: string; label: string; lat: string; lng: string; address_text: string }
export interface SuggestedRide {
  pickup_label: string; pickup_lat: string; pickup_lng: string;
  destination_label: string; destination_lat: string; destination_lng: string; trip_count: number;
}
interface RecurringRide {
  id: string; pickup_detail: SavedAddress; destination_detail: SavedAddress;
  days_of_week: number[]; time_of_day: string; active: boolean;
}
interface NotificationPref { category: string; label: string; enabled: boolean }

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// ---------- WR-13: suggested route on Home ----------
export function SuggestedRideCard({ onUse }: { onUse: (s: SuggestedRide) => void }) {
  const [suggestion, setSuggestion] = useState<SuggestedRide | null>(null);
  useEffect(() => {
    api.get<SuggestedRide | null>("/passengers/me/suggested-ride").then(({ data }) => setSuggestion(data || null)).catch(() => {});
  }, []);
  if (!suggestion) return null;
  return (
    <Card style={styles.suggest}>
      <Text style={styles.suggestTitle}>{suggestion.pickup_label} to {suggestion.destination_label}</Text>
      <Text style={typography.muted}>You've taken this ride {suggestion.trip_count} times this month</Text>
      <Button title="Use this route" variant="gold" onPress={() => { onUse(suggestion); setSuggestion(null); }}
        style={{ marginTop: spacing.sm }} />
    </Card>
  );
}

// ---------- WR-18: share + check-in on the trip screen ----------
export function ShareTripButtons({ tripId }: { tripId: string }) {
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function share(sendToContact: boolean) {
    setBusy(true);
    setNote(null);
    try {
      const { data } = await api.post<{ url: string; sent_to_contact: boolean }>(`/trips/${tripId}/share`, {
        send_to_contact: sendToContact,
      });
      setSharing(true);
      if (sendToContact) {
        setNote(data.sent_to_contact ? "Link texted to your emergency contact." : "Couldn't text the link. Use Share trip instead.");
      } else {
        await Share.share({ message: `Follow my WolbiRides trip live: ${data.url}` });
      }
    } catch {
      setNote("Couldn't create a share link right now.");
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    await api.delete(`/trips/${tripId}/share`).catch(() => {});
    setSharing(false);
    setNote("Sharing stopped. Old links no longer work.");
  }

  return (
    <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
      <Button title="Share trip" variant="ghost" onPress={() => share(false)} loading={busy} />
      {!!user?.emergency_contact_phone && (
        <Button title={`Text link to ${user.emergency_contact_name || "emergency contact"}`} variant="ghost"
          onPress={() => share(true)} disabled={busy} />
      )}
      {sharing && (
        <TouchableOpacity onPress={stop}><Text style={styles.stopLink}>Stop sharing</Text></TouchableOpacity>
      )}
      {note && <Text style={typography.muted}>{note}</Text>}
    </View>
  );
}

export function CheckInPrompt({ tripId, refreshKey }: { tripId: string; refreshKey: unknown }) {
  const [pending, setPending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.get(`/trips/${tripId}/safety-check`).then(({ data }) => setPending(!!data)).catch(() => {});
  }, [tripId]);
  useEffect(load, [load, refreshKey]);
  useEffect(() => {
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, [load]);

  async function answer(response: "ok" | "help") {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/trips/${tripId}/safety-check`, { response });
      setPending(false);
    } catch {
      setError("That didn't send. Try again, or use SOS.");
    } finally {
      setBusy(false);
    }
  }

  if (!pending) return null;
  return (
    <View style={styles.checkIn} accessibilityRole="alert">
      <Text style={styles.checkInTitle}>Are you OK?</Text>
      {error && <ErrorBanner message={error} />}
      <View style={{ flexDirection: "row", gap: spacing.sm }}>
        <Button title="I'm OK" variant="success" onPress={() => answer("ok")} disabled={busy} style={{ flex: 1 }} />
        <Button title="I need help" variant="danger" onPress={() => answer("help")} disabled={busy} style={{ flex: 1 }} />
      </View>
    </View>
  );
}

// ---------- Profile: saved places, regular rides, notifications ----------
export function SavedPlacesAndRegularRides() {
  const [places, setPlaces] = useState<SavedAddress[]>([]);
  const [rides, setRides] = useState<RecurringRide[] | null>(null);
  const [label, setLabel] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [days, setDays] = useState<number[]>([0, 1, 2, 3, 4]);
  const [time, setTime] = useState("07:30");

  useEffect(() => {
    api.get<SavedAddress[]>("/passengers/me/addresses").then(({ data }) => setPlaces(data)).catch(() => {});
    api.get<RecurringRide[]>("/passengers/me/recurring-rides").then(({ data }) => setRides(data)).catch(() => setRides([]));
  }, []);

  async function addCurrentLocation() {
    if (!label.trim()) return;
    setAdding(true);
    setError(null);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== "granted") throw new Error("denied");
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const { data } = await api.post<SavedAddress>("/passengers/me/addresses", {
        label: label.trim(), lat: pos.coords.latitude.toFixed(6), lng: pos.coords.longitude.toFixed(6),
        address_text: "Current location",
      });
      setPlaces((p) => [data, ...p]);
      setLabel("");
    } catch {
      setError("Couldn't get your location. Check location permission and try again.");
    } finally {
      setAdding(false);
    }
  }

  async function removePlace(id: string) {
    setPlaces((p) => p.filter((x) => x.id !== id));
    api.delete(`/passengers/me/addresses/${id}`).catch(() => {});
  }

  async function createRide() {
    setError(null);
    if (!/^\d{2}:\d{2}$/.test(time)) {
      setError("Enter the time as HH:MM, e.g. 07:30.");
      return;
    }
    try {
      const { data } = await api.post<RecurringRide>("/passengers/me/recurring-rides", {
        pickup: from, destination: to, days_of_week: days, time_of_day: time,
      });
      setRides((r) => [...(r ?? []), data]);
      setFormOpen(false);
    } catch {
      setError("Couldn't save that reminder. Try again.");
    }
  }

  function setActive(ride: RecurringRide, active: boolean) {
    setRides((r) => r?.map((x) => (x.id === ride.id ? { ...x, active } : x)) ?? r);
    api.patch(`/passengers/me/recurring-rides/${ride.id}`, { active }).catch(() => {});
  }

  function removeRide(id: string) {
    setRides((r) => r?.filter((x) => x.id !== id) ?? r);
    api.delete(`/passengers/me/recurring-rides/${id}`).catch(() => {});
  }

  return (
    <>
      <Card style={styles.section}>
        <Text style={typography.h2}>Saved places</Text>
        {places.length === 0 && <Text style={typography.muted}>Add your home or hostel for faster booking.</Text>}
        {places.map((p) => (
          <View key={p.id} style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{p.label}</Text>
              <Text style={typography.muted}>{p.address_text || `${p.lat}, ${p.lng}`}</Text>
            </View>
            <TouchableOpacity onPress={() => removePlace(p.id)} accessibilityLabel={`Remove ${p.label}`}>
              <Text style={styles.remove}>✕</Text>
            </TouchableOpacity>
          </View>
        ))}
        <TextField value={label} onChangeText={setLabel} placeholder="e.g. Home, Hostel" />
        <Button title="Save my current location" variant="ghost" onPress={addCurrentLocation} loading={adding}
          disabled={!label.trim()} />
      </Card>

      <Card style={styles.section}>
        <Text style={typography.h2}>Regular rides</Text>
        {rides?.map((r) => (
          <View key={r.id} style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{r.pickup_detail.label} to {r.destination_detail.label}</Text>
              <Text style={typography.muted}>{r.days_of_week.map((d) => DAYS[d]).join(", ")} at {r.time_of_day.slice(0, 5)}</Text>
            </View>
            <Switch value={r.active} onValueChange={(v) => setActive(r, v)} trackColor={{ true: colors.success }} />
            <TouchableOpacity onPress={() => removeRide(r.id)} accessibilityLabel="Remove reminder">
              <Text style={styles.remove}>✕</Text>
            </TouchableOpacity>
          </View>
        ))}
        {places.length < 2 ? (
          <Text style={typography.muted}>Save at least two places to set up a regular ride.</Text>
        ) : formOpen ? (
          <View style={{ marginTop: spacing.sm }}>
            <Text style={styles.label}>From</Text>
            <Chips items={places} selected={from} onSelect={setFrom} />
            <Text style={styles.label}>To</Text>
            <Chips items={places.filter((p) => p.id !== from)} selected={to} onSelect={setTo} />
            <Text style={styles.label}>Days</Text>
            <View style={styles.chips}>
              {DAYS.map((d, i) => {
                const on = days.includes(i);
                return (
                  <TouchableOpacity key={d} onPress={() => setDays((x) => (on ? x.filter((y) => y !== i) : [...x, i].sort()))}
                    style={[styles.chip, on && styles.chipOn]} accessibilityState={{ selected: on }}>
                    <Text style={[styles.chipText, on && styles.chipTextOn]}>{d}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <Text style={styles.label}>Time (HH:MM)</Text>
            <TextField value={time} onChangeText={setTime} placeholder="07:30" keyboardType="numbers-and-punctuation" />
            <Button title="Set reminder" variant="gold" onPress={createRide} disabled={!from || !to || days.length === 0} />
            <Button title="Cancel" variant="ghost" onPress={() => setFormOpen(false)} style={{ marginTop: spacing.sm }} />
          </View>
        ) : (
          <Button title="Add a regular ride" variant="ghost" onPress={() => setFormOpen(true)} />
        )}
        {error && <ErrorBanner message={error} />}
      </Card>
    </>
  );
}

function Chips({ items, selected, onSelect }: { items: SavedAddress[]; selected: string | null; onSelect: (id: string) => void }) {
  return (
    <View style={styles.chips}>
      {items.map((p) => (
        <TouchableOpacity key={p.id} onPress={() => onSelect(p.id)} style={[styles.chip, selected === p.id && styles.chipOn]}
          accessibilityState={{ selected: selected === p.id }}>
          <Text style={[styles.chipText, selected === p.id && styles.chipTextOn]}>{p.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

export function NotificationPrefsCard() {
  const [prefs, setPrefs] = useState<NotificationPref[] | null>(null);
  useEffect(() => {
    api.get<NotificationPref[]>("/notifications/preferences").then(({ data }) => setPrefs(data)).catch(() => setPrefs([]));
  }, []);

  async function toggle(pref: NotificationPref, enabled: boolean) {
    setPrefs((p) => p?.map((x) => (x.category === pref.category ? { ...x, enabled } : x)) ?? p);
    try {
      const { data } = await api.patch<NotificationPref[]>("/notifications/preferences", [{ category: pref.category, enabled }]);
      setPrefs(data);
    } catch {
      setPrefs((p) => p?.map((x) => (x.category === pref.category ? { ...x, enabled: !enabled } : x)) ?? p);
    }
  }

  return (
    <Card style={styles.section}>
      <Text style={typography.h2}>Notifications</Text>
      {prefs?.map((p) => (
        <View key={p.category} style={styles.row}>
          <Text style={[styles.rowTitle, { flex: 1 }]}>{p.label}</Text>
          <Switch value={p.enabled} onValueChange={(v) => toggle(p, v)} trackColor={{ true: colors.success }} />
        </View>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  suggest: { marginBottom: spacing.md, borderLeftWidth: 4, borderLeftColor: colors.gold },
  suggestTitle: { fontSize: 16, fontWeight: "700", color: colors.ink },
  stopLink: { color: colors.inkMuted, textDecorationLine: "underline", fontSize: 13.5, textAlign: "center" },
  checkIn: {
    marginBottom: spacing.md, padding: spacing.md, borderRadius: radii.md,
    borderWidth: 2, borderColor: colors.warning, backgroundColor: colors.warningBg, gap: spacing.sm,
  },
  checkInTitle: { fontSize: 19, fontWeight: "700", color: colors.navyInk },
  checkInBody: { fontSize: 14.5, lineHeight: 20, color: colors.ink },
  section: { marginBottom: spacing.md },
  row: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.line,
  },
  rowTitle: { fontSize: 15, fontWeight: "600", color: colors.ink },
  remove: { color: colors.inkMuted, fontSize: 16, padding: spacing.xs },
  label: { fontSize: 13, fontWeight: "600", color: colors.inkMuted, marginTop: spacing.sm, marginBottom: spacing.xs },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: spacing.sm },
  chip: { borderWidth: 1, borderColor: colors.line, borderRadius: radii.pill, paddingVertical: 6, paddingHorizontal: 12 },
  chipOn: { backgroundColor: colors.navyInk, borderColor: colors.navyInk },
  chipText: { fontSize: 13.5, color: colors.inkMuted },
  chipTextOn: { color: "#FFFFFF" },
});


/** WR-18 post-trip check-in, separate from the star rating. */
export function PostTripCheckin({ tripId }: { tripId: string }) {
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
    <Card style={[styles.section, { borderLeftWidth: 4, borderLeftColor: colors.navyInk }]}>
      <Text style={typography.h2}>Safety check: did anything feel off?</Text>
      {state === "ask" ? (
        <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm }}>
          <Button title="No, all fine" variant="ghost" onPress={() => send("fine")} disabled={busy} style={{ flex: 1 }} />
          <Button title="Something felt off" variant="ghost" onPress={() => setState("details")} style={{ flex: 1 }} />
        </View>
      ) : (
        <>
          <TextField value={details} onChangeText={setDetails} placeholder="What happened? (optional)" multiline />
          <Button title="Send to safety team" variant="primary" onPress={() => send("something_off")} loading={busy} />
          <Text style={[typography.muted, { marginTop: spacing.xs }]}>
            If you're in danger now, call 112.
          </Text>
        </>
      )}
    </Card>
  );
}

/** WR-19: no matching driver is free. The passenger decides; nobody is silently reassigned. */
export function PreferenceDecision({ tripId, status, onDecided }: { tripId: string; status?: string; onDecided: () => void }) {
  const [busy, setBusy] = useState(false);
  if (status !== "awaiting_passenger" && status !== "keep_waiting") return null;
  async function decide(decision: "any_driver" | "keep_waiting") {
    setBusy(true);
    try {
      await api.post(`/trips/${tripId}/preference-decision`, { decision });
      onDecided();
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={styles.checkIn} accessibilityRole="alert">
      <Text style={styles.checkInTitle}>
        {status === "keep_waiting" ? "Still looking for a matching rider" : "No matching rider is free right now"}
      </Text>
      <View style={{ flexDirection: "row", gap: spacing.sm }}>
        <Button title="Next available" variant="gold" onPress={() => decide("any_driver")} disabled={busy} style={{ flex: 1 }} />
        {status !== "keep_waiting" && (
          <Button title="Keep waiting" variant="ghost" onPress={() => decide("keep_waiting")} disabled={busy} style={{ flex: 1 }} />
        )}
      </View>
    </View>
  );
}

// ---------- WR-19: default ride preferences (same fields as web) ----------
const PREF_LABELS: Record<string, string> = {
  prefer_previous_drivers: "Prefer riders I've ridden with",
  quiet_ride: "Quiet ride",
  needs_luggage_space: "Space for luggage",
  needs_accessibility_help: "Help getting in and out",
};

export function RidePreferencesCard() {
  const [prefs, setPrefs] = useState<Record<string, boolean | string> | null>(null);
  useEffect(() => {
    api.get("/passengers/me/ride-preferences").then(({ data }) => setPrefs(data)).catch(() => setPrefs({}));
  }, []);

  async function save(patch: Record<string, boolean | string>) {
    const previous = prefs;
    const next = { ...prefs, ...patch };
    setPrefs(next);
    try {
      const { data } = await api.put("/passengers/me/ride-preferences", next);
      setPrefs(data);
    } catch {
      setPrefs(previous);
    }
  }

  if (!prefs) return null;
  return (
    <Card style={styles.section}>
      <Text style={typography.h2}>Ride preferences</Text>
      <Text style={styles.label}>Rider preference</Text>
      <View style={styles.chips}>
        {([["", "No preference"], ["female", "Female rider"], ["male", "Male rider"]] as const).map(([value, label]) => {
          const on = (prefs.preferred_driver_gender || "") === value;
          return (
            <TouchableOpacity key={value} style={[styles.chip, on && styles.chipOn]} onPress={() => save({ preferred_driver_gender: value })}
              accessibilityState={{ selected: on }}>
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {Object.keys(PREF_LABELS).map((k) => (
        <View key={k} style={styles.row}>
          <Text style={[styles.rowTitle, { flex: 1 }]}>{PREF_LABELS[k]}</Text>
          <Switch value={!!prefs[k]} onValueChange={(v) => save({ [k]: v })} trackColor={{ true: colors.success }} />
        </View>
      ))}
    </Card>
  );
}

// ---------- WR-22: ride bundles (same flow and expiry disclosure as web) ----------
interface Plan {
  id: string; name: string; ride_count: number; price: string; per_ride_price: string; max_fare_per_ride: string;
  valid_days: number | null; expires_before_term: boolean;
}
interface MyBundle { id: string; plan_name: string; rides_total: number; rides_remaining: number; status: string;
  expires_at: string | null; price_paid: string }

export function BundlesCard() {
  const { user } = useAuth();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [mine, setMine] = useState<MyBundle[]>([]);
  const [phone, setPhone] = useState(user?.phone || "");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(() => {
    api.get<Plan[]>("/bundles/plans").then(({ data }) => setPlans(data)).catch(() => {});
    api.get<MyBundle[]>("/passengers/me/ride-bundles").then(({ data }) => setMine(data)).catch(() => {});
  }, []);
  useEffect(load, [load]);

  function confirmThenBuy(plan: Plan, method: "momo" | "office") {
    if (!plan.expires_before_term) return buy(plan, method);
    Alert.alert("This bundle expires before the end of a term",
      `It expires ${plan.valid_days} days after you buy it. Unused rides are lost after that.`,
      [{ text: "Cancel", style: "cancel" }, { text: "Buy anyway", onPress: () => buy(plan, method) }]);
  }

  async function buy(plan: Plan, method: "momo" | "office") {
    setBusy(plan.id);
    setNote(null);
    try {
      const { data } = await api.post<MyBundle>("/ride-bundles/purchase", {
        plan_id: plan.id, payment_method: method, phone: phone.trim(), acknowledge_expiry: plan.expires_before_term });
      if (method === "momo") {
        setNote("Approve the MoMo prompt on your phone.");
        waitForPayment(data.id);
      } else {
        setNote("Bundle reserved. Pay at the WolbiRides desk and it'll be switched on.");
      }
      load();
    } catch (err: any) {
      setNote(err?.response?.data?.detail || "Couldn't start that purchase. Try again.");
    } finally {
      setBusy(null);
    }
  }

  function waitForPayment(id: string, attempt = 0) {
    if (attempt > 30) return;
    setTimeout(async () => {
      try {
        const { data } = await api.get<MyBundle>(`/bundles/${id}/payment-status`);
        if (data.status === "active") { setNote("Bundle paid and ready to use."); load(); return; }
      } catch { /* keep trying */ }
      waitForPayment(id, attempt + 1);
    }, 4000);
  }

  const visible = mine.filter((b) => ["pending_payment", "active"].includes(b.status));
  if (plans.length === 0 && visible.length === 0) return null;
  return (
    <Card style={styles.section}>
      <Text style={typography.h2}>Ride bundles</Text>
      {visible.map((b) => (
        <View key={b.id} style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>{b.plan_name}</Text>
            <Text style={typography.muted}>
              {b.status === "active"
                ? `${b.rides_remaining} of ${b.rides_total} rides left, ${b.expires_at ? `expires ${new Date(b.expires_at).toLocaleDateString()}` : "never expires"}`
                : `GH₵${b.price_paid}, waiting for payment`}
            </Text>
          </View>
        </View>
      ))}
      {plans.length > 0 && (
        <>
          <Text style={styles.label}>MoMo number for bundle payments</Text>
          <TextField value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
        </>
      )}
      {plans.map((p) => (
        <View key={p.id} style={[styles.row, { flexDirection: "column", alignItems: "stretch" }]}>
          <Text style={styles.rowTitle}>{p.name}: {p.ride_count} rides for GH₵{p.price} (GH₵{p.per_ride_price} each)</Text>
          <Text style={[typography.muted, p.expires_before_term && { color: colors.danger, fontWeight: "700" }]}>
            Rides up to GH₵{p.max_fare_per_ride} each. {p.valid_days == null ? "Never expires."
              : `Expires ${p.valid_days} days after purchase${p.expires_before_term ? ", before the end of a term" : ""}.`}
          </Text>
          <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.xs }}>
            <Button title={busy === p.id ? "Starting…" : "Pay with MoMo"} variant="gold" onPress={() => confirmThenBuy(p, "momo")}
              disabled={!!busy || phone.trim().length < 9} style={{ flex: 1 }} />
            <Button title="Pay at desk" variant="ghost" onPress={() => confirmThenBuy(p, "office")} disabled={!!busy} style={{ flex: 1 }} />
          </View>
        </View>
      ))}
      {note && <Text style={[typography.muted, { marginTop: spacing.sm }]}>{note}</Text>}
    </Card>
  );
}
