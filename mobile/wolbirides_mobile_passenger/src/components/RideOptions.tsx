import { useEffect, useRef, useState } from "react";
import { StyleSheet, Switch, Text, TouchableOpacity, View } from "react-native";
import { api, type Vendor } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { realPhone } from "../phone";
import { colors, radii, spacing, typography } from "../theme";
import { Button, Card, FieldLabel, TextField } from "./ui";

export type DeliverySubtype = "parcel" | "errand" | "vendor_order";

export interface RideOptionsValue {
  kind: "ride" | "delivery";
  direction: "send" | "receive"; // UI framing only for a parcel — never sent to the server
  delivery_subtype: DeliverySubtype;
  // Sender = who hands the item to the courier; recipient = who takes it. Whichever side the
  // booker is on is filled in from their account, and stays editable.
  sender_name: string;
  sender_phone: string;
  recipient_name: string;
  recipient_phone: string;
  package_description: string;
  package_size: "small" | "medium" | "large";
  // Errand / vendor order: what the courier should buy or collect, and how much of the
  // requester's money they're allowed to spend/float while doing it.
  task_description: string;
  spend_limit: string;
  // Vendor order: an existing Vendor picked from the search results (vendor_id set), or a
  // first-time vendor typed freeform (vendor_id blank, vendor_name carries the new name).
  vendor_id: string;
  vendor_name: string;
  vendor_location: string;
  vendor_phone: string;
  no_prohibited_items: boolean;
  preferences: Record<string, boolean | string>;
  shareable: boolean;
  payment: string; // "auto" | "cash" | "org:<id>" | "voucher:<id>" | "bundle:<id>" | "momo" | "hubtel"
  promo_code: string;
  promo_discount: number;
}

export const DEFAULT_RIDE_OPTIONS: RideOptionsValue = {
  kind: "ride", direction: "send", delivery_subtype: "parcel",
  sender_name: "", sender_phone: "", recipient_name: "", recipient_phone: "", package_description: "", package_size: "small",
  task_description: "", spend_limit: "", vendor_id: "", vendor_name: "", vendor_location: "", vendor_phone: "",
  no_prohibited_items: false, shareable: false, payment: "auto", promo_code: "", promo_discount: 0,
  preferences: { preferred_driver_gender: "", prefer_previous_drivers: false, quiet_ride: false,
    needs_luggage_space: false, needs_accessibility_help: false },
};

// Same wording and order as the passenger web app and the driver's "What you offer", so what a passenger can
// ask for is exactly what a driver can say they offer. "Drivers I've ridden with" is passenger-only: last.
const SOFT_LABELS: Record<string, string> = {
  quiet_ride: "Quiet ride",
  needs_luggage_space: "Space for luggage",
  needs_accessibility_help: "Help getting in and out",
  prefer_previous_drivers: "Riders I've ridden with",
};

const SUBTYPE_LABELS: Record<DeliverySubtype, string> = {
  parcel: "Parcel", errand: "Errand", vendor_order: "From a vendor",
};

export function rideOptionsToRequest(o: RideOptionsValue) {
  const body: Record<string, unknown> = { trip_type: o.kind, preferences: o.preferences };
  if (o.kind === "ride" && o.shareable) body.shareable = true;
  if (o.kind === "delivery") {
    Object.assign(body, {
      delivery_subtype: o.delivery_subtype, no_prohibited_items: o.no_prohibited_items,
      sender_name: o.sender_name.trim(), sender_phone: o.sender_phone.trim(),
      recipient_name: o.recipient_name.trim(), recipient_phone: o.recipient_phone.trim(),
    });
    if (o.delivery_subtype === "parcel") {
      Object.assign(body, { package_description: o.package_description.trim(), package_size: o.package_size });
    } else {
      body.task_description = o.task_description.trim();
      if (o.spend_limit.trim()) body.spend_limit = o.spend_limit.trim();
      if (o.delivery_subtype === "vendor_order") {
        if (o.vendor_id) {
          body.vendor_id = o.vendor_id;
        } else {
          // A first-time vendor is created from what the requester typed; the contact fields are the vendor's.
          body.vendor_name = o.vendor_name.trim();
          if (o.vendor_location.trim()) body.vendor_location = o.vendor_location.trim();
          if (o.sender_phone.trim()) body.vendor_phone = o.sender_phone.trim();
        }
      }
    }
  }
  const [kind, id] = o.payment.split(":");
  if (kind === "org") Object.assign(body, { payment_method: "organization", organization_id: id });
  else if (kind === "voucher") Object.assign(body, { payment_method: "voucher", voucher_id: id });
  else if (kind === "bundle") Object.assign(body, { payment_method: "bundle", bundle_id: id });
  else if (kind === "cash") body.payment_method = "cash";
  else if (kind === "momo") body.payment_method = "momo";
  else if (kind === "hubtel") body.payment_method = "hubtel";
  if (o.promo_code.trim() && ["cash", "auto", "momo", "hubtel"].includes(o.payment)) body.promo_code = o.promo_code.trim();
  return body;
}

export function deliveryIsComplete(o: RideOptionsValue) {
  if (o.kind === "ride") return true;
  if (!o.no_prohibited_items) return false;
  const recipientOk = !!o.recipient_name.trim() && !!o.recipient_phone.trim();
  if (o.delivery_subtype === "parcel") {
    return recipientOk && !!o.sender_name.trim() && !!o.sender_phone.trim() && !!o.package_description.trim();
  }
  if (o.delivery_subtype === "errand") return recipientOk && !!o.sender_name.trim() && !!o.task_description.trim();
  // vendor_order: the vendor is the sender, so it needs a vendor (picked or typed) and what to order.
  return recipientOk && !!o.task_description.trim() && (!!o.vendor_id || !!o.vendor_name.trim()) && !!o.sender_name.trim();
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

export default function RideOptions({ value, onChange, fareEstimate, destination }: {
  value: RideOptionsValue; onChange: (v: RideOptionsValue) => void; fareEstimate: number | null;
  destination?: { lat: number; lng: number } | null;
}) {
  const { user } = useAuth();
  const [payOpts, setPayOpts] = useState<PaymentOptions>({ organizations: [], vouchers: [], bundles: [] });
  const [promoMsg, setPromoMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [voucherCode, setVoucherCode] = useState("");
  const [voucherMsg, setVoucherMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [vendorResults, setVendorResults] = useState<Vendor[]>([]);
  const vendorSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const set = (patch: Partial<RideOptionsValue>) => onChange({ ...value, ...patch });
  const prefs = value.preferences;
  const setPref = (patch: Record<string, boolean | string>) => set({ preferences: { ...prefs, ...patch } });

  const me = { name: user?.name ?? "", phone: realPhone(user) };

  /** Puts the booker's own details on whichever side they are, and clears the other, so the form
   * opens ready to fill in and never sends a stranger's details as if they were the booker's. */
  function partiesFor(subtype: DeliverySubtype, direction: "send" | "receive") {
    const blank = { sender_name: "", sender_phone: "", recipient_name: "", recipient_phone: "" };
    if (subtype === "parcel" && direction === "send") return { ...blank, sender_name: me.name, sender_phone: me.phone };
    return { ...blank, recipient_name: me.name, recipient_phone: me.phone }; // receiving a parcel, an errand, or a vendor order
  }

  function setDirection(direction: "send" | "receive") {
    set({ direction, ...partiesFor("parcel", direction) });
  }

  function setSubtype(delivery_subtype: DeliverySubtype) {
    set({ delivery_subtype, task_description: "", spend_limit: "", vendor_id: "", vendor_name: "", vendor_location: "",
      vendor_phone: "", ...partiesFor(delivery_subtype, value.direction) });
    setVendorResults([]);
  }

  function searchVendors(query: string) {
    if (vendorSearchTimer.current) clearTimeout(vendorSearchTimer.current);
    if (!query.trim()) { setVendorResults([]); return; }
    vendorSearchTimer.current = setTimeout(() => {
      api.get<Vendor[]>(`/vendors?q=${encodeURIComponent(query.trim())}`)
        .then(({ data }) => setVendorResults(data))
        .catch(() => setVendorResults([]));
    }, 300);
  }

  function typeVendorName(name: string) {
    // Typing invalidates a previously picked vendor — a fresh name might match a different
    // one, or none at all (in which case the server creates a new Vendor on submit).
    // The vendor is the sender, so their contact name follows what's typed until it's edited by hand.
    set({ vendor_name: name, vendor_id: "", ...(value.sender_name === value.vendor_name ? { sender_name: name } : {}) });
    searchVendors(name);
  }

  function pickVendor(v: Vendor) {
    set({ vendor_id: v.id, vendor_name: v.name, vendor_location: v.location_label, vendor_phone: v.phone,
      sender_name: v.name, sender_phone: v.phone });
    setVendorResults([]);
  }

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
      const { data } = await api.post("/promos/check", {
        code: value.promo_code, fare: fareEstimate.toFixed(2),
        destination_lat: destination?.lat.toFixed(6), destination_lng: destination?.lng.toFixed(6),
      });
      set({ promo_discount: data.valid ? Number(data.discount) : 0 });
      setPromoMsg(data.valid ? { ok: true, text: `GH₵${data.discount} off${data.partner ? ` with ${data.partner}` : ""}` }
        : { ok: false, text: data.detail });
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
  const isDelivery = value.kind === "delivery";
  const hasBundle = payOpts.bundles.length > 0;
  const canPromo = ["cash", "auto", "momo", "hubtel"].includes(value.payment);
  const payChoices = [
    { key: "auto", label: isRide && hasBundle ? "My bundle, else cash" : "Cash" },
    ...(isRide && hasBundle ? [{ key: "cash", label: "Cash" }] : []),
    { key: "momo", label: "MTN MoMo" },
    { key: "hubtel", label: "Hubtel" },
    ...payOpts.organizations.map((o) => ({ key: `org:${o.id}`, label: `Bill ${o.name}` })),
    ...payOpts.vouchers.map((v) => ({ key: `voucher:${v.id}`,
      label: `${v.organization} voucher (${v.kind === "rides" ? `${v.rides_remaining} left` : `GH₵${v.value_remaining}`})` })),
    ...(isRide ? payOpts.bundles.map((b) => ({ key: `bundle:${b.id}`, label: `${b.name} (${b.rides_remaining} left)` })) : []),
  ];

  useEffect(() => {
    // Opening the delivery form with nothing filled in: put the booker's own details on their side.
    if (isDelivery && !value.sender_name && !value.sender_phone && !value.recipient_name && !value.recipient_phone) {
      set(partiesFor(value.delivery_subtype, value.direction));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once, when the delivery form first shows
  }, [isDelivery]);

  /** One person's name + phone. The phone is optional only where there may not be one (a market stall). */
  function party(who: "sender" | "recipient", title: string, phoneOptional = false) {
    const name = who === "sender" ? value.sender_name : value.recipient_name;
    const phone = who === "sender" ? value.sender_phone : value.recipient_phone;
    const patch = (field: "name" | "phone", v: string): Partial<RideOptionsValue> =>
      who === "sender" ? (field === "name" ? { sender_name: v } : { sender_phone: v })
        : (field === "name" ? { recipient_name: v } : { recipient_phone: v });
    return (
      <View style={{ marginTop: spacing.xs }}>
        <Text style={styles.partyTitle}>{title}</Text>
        <FieldLabel>Name</FieldLabel>
        <TextField value={name} onChangeText={(t) => set(patch("name", t))} autoCorrect={false} />
        <FieldLabel>{phoneOptional ? "Phone (optional)" : "Phone"}</FieldLabel>
        <TextField value={phone} onChangeText={(t) => set(patch("phone", t))} keyboardType="phone-pad" placeholder="024 123 4567" />
      </View>
    );
  }

  return (
    <Card style={{ marginBottom: spacing.md }}>
      {isDelivery && (
        <>
          <Text style={styles.label}>What kind of delivery?</Text>
          <Chips items={(["parcel", "errand", "vendor_order"] as const).map((s) => ({ key: s, label: SUBTYPE_LABELS[s] }))}
            selected={(k) => value.delivery_subtype === k} onSelect={(k) => setSubtype(k as DeliverySubtype)} />
        </>
      )}

      {isDelivery && value.delivery_subtype === "parcel" && (
        <>
          <View style={styles.toggle}>
            {(["send", "receive"] as const).map((d) => (
              <TouchableOpacity key={d} style={[styles.tab, value.direction === d && styles.tabOn]}
                onPress={() => setDirection(d)} accessibilityRole="tab" accessibilityState={{ selected: value.direction === d }}>
                <Text style={[styles.tabText, value.direction === d && styles.tabTextOn]}>{d === "send" ? "I'm sending" : "I'm receiving"}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {party("sender", "Sender")}
          {party("recipient", "Recipient")}
          <FieldLabel>What is being sent?</FieldLabel>
          <TextField value={value.package_description} onChangeText={(t) => set({ package_description: t })} placeholder="e.g. Textbook in a bag" />
          <Text style={styles.label}>Size</Text>
          <Chips items={[{ key: "small", label: "Small" }, { key: "medium", label: "Medium" }, { key: "large", label: "Large" }]}
            selected={(k) => value.package_size === k} onSelect={(k) => set({ package_size: k as RideOptionsValue["package_size"] })} />
        </>
      )}

      {isDelivery && value.delivery_subtype === "errand" && (
        <>
          {party("sender", "Collect from", true)}
          {party("recipient", "Deliver to")}
          <FieldLabel>What do you need done?</FieldLabel>
          <TextField value={value.task_description} onChangeText={(t) => set({ task_description: t })} multiline
            placeholder="e.g. Buy 2 yards of kente from Stall 14, Aboabo side" />
          <FieldLabel>Spending limit (optional)</FieldLabel>
          <TextField value={value.spend_limit} onChangeText={(t) => set({ spend_limit: t.replace(/[^0-9.]/g, "") })}
            keyboardType="decimal-pad" placeholder="e.g. 150" />
          <Text style={typography.muted}>The courier floats this and you settle up when they're back — cap it to whatever you're comfortable with.</Text>
        </>
      )}

      {isDelivery && value.delivery_subtype === "vendor_order" && (
        <>
          <FieldLabel>Which vendor?</FieldLabel>
          <TextField value={value.vendor_name} onChangeText={typeVendorName} placeholder="Start typing a name…" autoCapitalize="words" />
          {vendorResults.length > 0 && (
            <View style={styles.vendorList}>
              {vendorResults.map((v) => (
                <TouchableOpacity key={v.id} style={styles.vendorOption} onPress={() => pickVendor(v)}>
                  <Text style={styles.vendorName}>{v.name}</Text>
                  {!!v.location_label && <Text style={typography.muted}>{v.location_label}</Text>}
                </TouchableOpacity>
              ))}
            </View>
          )}
          {!value.vendor_id && value.vendor_name.trim() !== "" && (
            <>
              <FieldLabel>Where is it? (optional)</FieldLabel>
              <TextField value={value.vendor_location} onChangeText={(t) => set({ vendor_location: t })} placeholder="e.g. Stall 14, Aboabo side" />
            </>
          )}
          {party("sender", "Vendor contact", true)}
          {party("recipient", "Deliver to")}
          <FieldLabel>What should the courier order?</FieldLabel>
          <TextField value={value.task_description} onChangeText={(t) => set({ task_description: t })} multiline
            placeholder="e.g. 2x jollof with chicken, no salad" />
          <FieldLabel>Spending limit (optional)</FieldLabel>
          <TextField value={value.spend_limit} onChangeText={(t) => set({ spend_limit: t.replace(/[^0-9.]/g, "") })}
            keyboardType="decimal-pad" placeholder="e.g. 60" />
        </>
      )}

      {isDelivery && (
        <View style={styles.checkRow}>
          <Switch value={value.no_prohibited_items} onValueChange={(v) => set({ no_prohibited_items: v })} trackColor={{ true: colors.success }} />
          <Text style={[typography.muted, { flex: 1 }]}>No cash, weapons, drugs or animals in this package</Text>
        </View>
      )}

      {isRide && (
        <>
          <View style={styles.poolBox}>
            <View style={styles.checkRow}>
              <Switch value={value.shareable} onValueChange={(v) => set({ shareable: v })} trackColor={{ true: colors.success }} />
              <Text style={{ flex: 1, fontWeight: "600", color: colors.ink }}>Share this ride</Text>
            </View>
          </View>
          <Text style={styles.label}>Rider preference (optional)</Text>
          <Chips items={[{ key: "", label: "No preference" }, { key: "female", label: "Female rider" }, { key: "male", label: "Male rider" }]}
            selected={(k) => (prefs.preferred_driver_gender || "") === k} onSelect={(k) => setPref({ preferred_driver_gender: k })} />
          <Chips items={Object.keys(SOFT_LABELS).map((k) => ({ key: k, label: SOFT_LABELS[k] }))}
            selected={(k) => !!prefs[k]} onSelect={(k) => setPref({ [k]: !prefs[k] })} />
        </>
      )}

      <Text style={styles.label}>Pay with</Text>
      <Chips items={payChoices} selected={(k) => value.payment === k} onSelect={(k) => set({ payment: k })} />

      <View style={{ flexDirection: "row", gap: spacing.sm, alignItems: "flex-start", marginTop: spacing.sm }}>
        <View style={{ flex: 1 }}>
          <TextField value={voucherCode} autoCapitalize="characters" placeholder="Voucher code"
            onChangeText={(t) => setVoucherCode(t.toUpperCase())} />
        </View>
        <Button title="Redeem" variant="ghost" onPress={redeemVoucher} disabled={!voucherCode.trim()} />
      </View>
      {voucherMsg && <Text style={{ color: voucherMsg.ok ? colors.success : colors.danger, fontSize: 13 }}>{voucherMsg.text}</Text>}

      {canPromo && (
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
  vendorList: { borderWidth: 1, borderColor: colors.line, borderRadius: radii.sm, marginTop: -4, marginBottom: spacing.sm, overflow: "hidden" },
  vendorOption: { paddingVertical: 8, paddingHorizontal: 10, borderBottomWidth: 1, borderBottomColor: colors.line },
  vendorName: { fontSize: 14, fontWeight: "600", color: colors.ink },
  partyTitle: { fontSize: 12, fontWeight: "700", letterSpacing: 0.5, textTransform: "uppercase", color: colors.inkMuted, marginTop: spacing.sm },
});
