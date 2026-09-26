import { useEffect, useState } from "react";
import { StyleSheet, Switch, Text, TouchableOpacity, View } from "react-native";
import { api } from "../api/client";
import { colors, radii, spacing, typography } from "../theme";
import { Button, Card, FieldLabel, TextField } from "./ui";

export interface RideOptionsValue {
  kind: "ride" | "delivery";
  recipient_name: string;
  recipient_phone: string;
  package_description: string;
  package_size: "small" | "medium" | "large";
  no_prohibited_items: boolean;
  preferences: Record<string, boolean | string>;
  shareable: boolean;
  payment: string; // "auto" | "cash" | "org:<id>" | "voucher:<id>" | "bundle:<id>"
  promo_code: string;
  promo_discount: number;
}

export const DEFAULT_RIDE_OPTIONS: RideOptionsValue = {
  kind: "ride", recipient_name: "", recipient_phone: "", package_description: "", package_size: "small",
  no_prohibited_items: false, shareable: false, payment: "auto", promo_code: "", promo_discount: 0,
  preferences: { preferred_driver_gender: "", prefer_previous_drivers: false, quiet_ride: false,
    needs_luggage_space: false, needs_accessibility_help: false },
};

const SOFT_LABELS: Record<string, string> = {
  prefer_previous_drivers: "Drivers I've ridden with",
  quiet_ride: "Quiet ride",
  needs_luggage_space: "Luggage space",
  needs_accessibility_help: "Help getting in",
};

export function rideOptionsToRequest(o: RideOptionsValue) {
  const body: Record<string, unknown> = { trip_type: o.kind, preferences: o.preferences };
  if (o.kind === "ride" && o.shareable) body.shareable = true;
  if (o.kind === "delivery") {
    Object.assign(body, {
      recipient_name: o.recipient_name.trim(), recipient_phone: o.recipient_phone.trim(),
      package_description: o.package_description.trim(), package_size: o.package_size,
      no_prohibited_items: o.no_prohibited_items,
    });
  }
  const [kind, id] = o.payment.split(":");
  if (kind === "org") Object.assign(body, { payment_method: "organization", organization_id: id });
  else if (kind === "voucher") Object.assign(body, { payment_method: "voucher", voucher_id: id });
  else if (kind === "bundle") Object.assign(body, { payment_method: "bundle", bundle_id: id });
  else if (kind === "cash") body.payment_method = "cash";
  if (o.promo_code.trim() && (o.payment === "cash" || o.payment === "auto")) body.promo_code = o.promo_code.trim();
  return body;
}

export function deliveryIsComplete(o: RideOptionsValue) {
  return o.kind === "ride" || (!!o.recipient_name.trim() && !!o.recipient_phone.trim() &&
    !!o.package_description.trim() && o.no_prohibited_items);
}

interface PaymentOptions {
  organizations: { id: string; name: string }[];
  vouchers: { id: string; organization: string; kind: string; value_remaining: string | null; rides_remaining: number | null }[];
  bundles: { id: string; name: string; rides_remaining: number }[];
}

function Chips({ items, selected, onSelect }: {
  items: { key: string; label: string }[]; selected: (key: string) => boolean; onSelect: (key: string) => void;
}) {
  return (
    <View style={styles.chips}>
      {items.map((c) => (
        <TouchableOpacity key={c.key} style={[styles.chip, selected(c.key) && styles.chipOn]} onPress={() => onSelect(c.key)}
          accessibilityRole="button" accessibilityState={{ selected: selected(c.key) }}>
          <Text style={[styles.chipText, selected(c.key) && styles.chipTextOn]}>{c.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

export default function RideOptions({ value, onChange, fareEstimate, zoneBaseFare, destination }: {
  value: RideOptionsValue; onChange: (v: RideOptionsValue) => void; fareEstimate: number | null; zoneBaseFare?: number;
  destination?: { lat: number; lng: number } | null;
}) {
  const [payOpts, setPayOpts] = useState<PaymentOptions>({ organizations: [], vouchers: [], bundles: [] });
  const [promoMsg, setPromoMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [voucherCode, setVoucherCode] = useState("");
  const [voucherMsg, setVoucherMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const set = (patch: Partial<RideOptionsValue>) => onChange({ ...value, ...patch });
  const prefs = value.preferences;
  const setPref = (patch: Record<string, boolean | string>) => set({ preferences: { ...prefs, ...patch } });

  function loadPaymentOptions() {
    api.get<PaymentOptions>("/passengers/me/payment-options").then(({ data }) => setPayOpts(data)).catch(() => {});
  }
  useEffect(() => {
    loadPaymentOptions();
    api.get("/passengers/me/ride-preferences").then(({ data }) => set({ preferences: { ...prefs, ...data } })).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A promo checked against an older fare or destination has to be checked again (same as web).
  useEffect(() => {
    if (value.promo_discount) { set({ promo_discount: 0 }); setPromoMsg(null); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fareEstimate, destination?.lat, destination?.lng]);

  async function checkPromo() {
    if (fareEstimate == null) return;
    try {
      // Same body as web, including the destination, so "partner-only" codes preview correctly.
      const { data } = await api.post("/promos/check", {
        code: value.promo_code, fare: fareEstimate.toFixed(2),
        destination_lat: destination?.lat.toFixed(6), destination_lng: destination?.lng.toFixed(6),
      });
      set({ promo_discount: data.valid ? Number(data.discount) : 0 });
      setPromoMsg(data.valid ? { ok: true, text: `GH₵${data.discount} off` } : { ok: false, text: data.detail });
    } catch {
      setPromoMsg({ ok: false, text: "Couldn't check that code right now." });
    }
  }

  async function redeemVoucher() {
    try {
      const { data } = await api.post("/vouchers/redeem", { code: voucherCode.trim() });
      setVoucherCode("");
      setVoucherMsg({ ok: true, text: `Voucher from ${data.organization_name} added.` });
      loadPaymentOptions();
      set({ payment: `voucher:${data.id}` });
    } catch (err: any) {
      setVoucherMsg({ ok: false, text: err?.response?.data?.detail || "Couldn't redeem that code." });
    }
  }

  const isRide = value.kind === "ride";
  const hasBundle = payOpts.bundles.length > 0;
  const payChoices = [
    { key: "auto", label: isRide && hasBundle ? "My bundle, else cash" : "Cash" },
    ...(isRide && hasBundle ? [{ key: "cash", label: "Cash" }] : []),
    ...payOpts.organizations.map((o) => ({ key: `org:${o.id}`, label: `Bill ${o.name}` })),
    ...payOpts.vouchers.map((v) => ({ key: `voucher:${v.id}`,
      label: `${v.organization} voucher (${v.kind === "rides" ? `${v.rides_remaining} left` : `GH₵${v.value_remaining}`})` })),
    ...(isRide ? payOpts.bundles.map((b) => ({ key: `bundle:${b.id}`, label: `${b.name} (${b.rides_remaining} left)` })) : []),
  ];

  return (
    <Card style={{ marginBottom: spacing.md }}>
      <View style={styles.toggle}>
        {(["ride", "delivery"] as const).map((k) => (
          <TouchableOpacity key={k} style={[styles.tab, value.kind === k && styles.tabOn]}
            onPress={() => set({ kind: k, shareable: k === "ride" && value.shareable,
              payment: k === "delivery" && value.payment.startsWith("bundle:") ? "auto" : value.payment })}
            accessibilityRole="tab" accessibilityState={{ selected: value.kind === k }}>
            <Text style={[styles.tabText, value.kind === k && styles.tabTextOn]}>{k === "ride" ? "Ride" : "Send a package"}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {value.kind === "delivery" ? (
        <>
          <FieldLabel>Recipient's name</FieldLabel>
          <TextField value={value.recipient_name} onChangeText={(t) => set({ recipient_name: t })} />
          <FieldLabel>Recipient's phone</FieldLabel>
          <TextField value={value.recipient_phone} onChangeText={(t) => set({ recipient_phone: t })} keyboardType="phone-pad" placeholder="024 123 4567" />
          <FieldLabel>What are you sending?</FieldLabel>
          <TextField value={value.package_description} onChangeText={(t) => set({ package_description: t })} placeholder="e.g. Textbook in a bag" />
          <Text style={styles.label}>Size</Text>
          <Chips items={[{ key: "small", label: "Small" }, { key: "medium", label: "Medium" }, { key: "large", label: "Large" }]}
            selected={(k) => value.package_size === k} onSelect={(k) => set({ package_size: k as RideOptionsValue["package_size"] })} />
          <View style={styles.checkRow}>
            <Switch value={value.no_prohibited_items} onValueChange={(v) => set({ no_prohibited_items: v })} trackColor={{ true: colors.success }} />
            <Text style={[typography.muted, { flex: 1 }]}>No cash, weapons, drugs or animals in this package</Text>
          </View>
          <Text style={typography.muted}>You'll get a pickup code for the driver. The recipient gets a drop-off code by SMS.</Text>
        </>
      ) : (
        <>
          <View style={styles.poolBox}>
            <View style={styles.checkRow}>
              <Switch value={value.shareable} onValueChange={(v) => set({ shareable: v })} trackColor={{ true: colors.success }} />
              <Text style={{ flex: 1, fontWeight: "600", color: colors.ink }}>Share this ride</Text>
            </View>
            <Text style={typography.muted}>
              If someone nearby is going your way, you ride together and split the base fare
              {zoneBaseFare ? ` (save up to GH₵${(zoneBaseFare / 2).toFixed(2)})` : ""}. Never more than riding alone.
            </Text>
          </View>
          <Text style={styles.label}>Driver preference (optional)</Text>
          <Chips items={[{ key: "", label: "No preference" }, { key: "female", label: "Female driver" }, { key: "male", label: "Male driver" }]}
            selected={(k) => (prefs.preferred_driver_gender || "") === k} onSelect={(k) => setPref({ preferred_driver_gender: k })} />
          <Chips items={Object.keys(SOFT_LABELS).map((k) => ({ key: k, label: SOFT_LABELS[k] }))}
            selected={(k) => !!prefs[k]} onSelect={(k) => setPref({ [k]: !prefs[k] })} />
          <Text style={typography.muted}>Only our matching uses these; drivers never see them. If no match is free, we'll ask you first.</Text>
        </>
      )}

      <Text style={styles.label}>Pay with</Text>
      <Chips items={payChoices} selected={(k) => value.payment === k} onSelect={(k) => set({ payment: k })} />
      {value.payment === "auto" && isRide && hasBundle && (
        <Text style={typography.muted}>This ride uses one ride from your bundle if it's within the bundle's fare limit.</Text>
      )}
      <View style={{ flexDirection: "row", gap: spacing.sm, alignItems: "flex-start", marginTop: spacing.sm }}>
        <View style={{ flex: 1 }}>
          <TextField value={voucherCode} autoCapitalize="characters" placeholder="Voucher code"
            onChangeText={(t) => setVoucherCode(t.toUpperCase())} />
        </View>
        <Button title="Redeem" variant="ghost" onPress={redeemVoucher} disabled={!voucherCode.trim()} />
      </View>
      {voucherMsg && <Text style={{ color: voucherMsg.ok ? colors.success : colors.danger, fontSize: 13 }}>{voucherMsg.text}</Text>}

      {(value.payment === "cash" || value.payment === "auto") && (
        <>
          <FieldLabel>Promo code</FieldLabel>
          <View style={{ flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" }}>
            <View style={{ flex: 1 }}>
              <TextField value={value.promo_code} autoCapitalize="characters" placeholder="Optional"
                onChangeText={(t) => { set({ promo_code: t.toUpperCase(), promo_discount: 0 }); setPromoMsg(null); }} />
            </View>
            <Button title="Apply" variant="ghost" onPress={checkPromo} disabled={!value.promo_code.trim() || fareEstimate == null} />
          </View>
          {promoMsg && <Text style={{ color: promoMsg.ok ? colors.success : colors.danger, fontSize: 13 }}>{promoMsg.text}</Text>}
        </>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  toggle: { flexDirection: "row", backgroundColor: colors.paper, borderRadius: radii.md, padding: 4, marginBottom: spacing.md },
  tab: { flex: 1, paddingVertical: 8, borderRadius: radii.sm, alignItems: "center" },
  tabOn: { backgroundColor: colors.paperRaised },
  tabText: { fontWeight: "600", color: colors.inkMuted },
  tabTextOn: { color: colors.navyInk },
  label: { fontSize: 13, fontWeight: "600", color: colors.inkMuted, marginTop: spacing.sm, marginBottom: spacing.xs },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: spacing.sm },
  chip: { borderWidth: 1, borderColor: colors.line, borderRadius: radii.pill, paddingVertical: 6, paddingHorizontal: 12 },
  chipOn: { backgroundColor: colors.navyInk, borderColor: colors.navyInk },
  chipText: { fontSize: 13.5, color: colors.inkMuted },
  chipTextOn: { color: "#FFFFFF" },
  poolBox: { borderWidth: 1, borderStyle: "dashed", borderColor: colors.gold, borderRadius: radii.md, padding: spacing.sm, marginBottom: spacing.sm },
  checkRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.sm },
});
