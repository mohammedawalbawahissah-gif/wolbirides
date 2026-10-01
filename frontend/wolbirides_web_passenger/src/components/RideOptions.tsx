import { useEffect, useRef, useState } from "react";
import { api, type Vendor } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { realPhone } from "../phone";
import "./RideOptions.css";

export interface RidePreferences {
  preferred_driver_gender: "" | "female" | "male";
  prefer_previous_drivers: boolean;
  quiet_ride: boolean;
  needs_luggage_space: boolean;
  needs_accessibility_help: boolean;
}

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
  // Vendor order: an existing Vendor picked from the search dropdown (vendor_id set), or a
  // first-time vendor typed freeform (vendor_id blank, vendor_name carries the new name).
  vendor_id: string;
  vendor_name: string;
  vendor_location: string;
  vendor_phone: string;
  no_prohibited_items: boolean;
  preferences: RidePreferences;
  shareable: boolean;
  payment: string; // "auto" | "cash" | "org:<id>" | "voucher:<id>" | "bundle:<id>"
  promo_code: string;
  promo_discount: number; // preview only; the server recomputes on request
}

// eslint-disable-next-line react/only-export-components -- exports this module's hook/helpers next to its component (standard pattern); only affects dev hot-reload
export const DEFAULT_PREFERENCES: RidePreferences = {
  preferred_driver_gender: "", prefer_previous_drivers: false,
  quiet_ride: false, needs_luggage_space: false, needs_accessibility_help: false,
};

// eslint-disable-next-line react/only-export-components -- exports this module's hook/helpers next to its component (standard pattern); only affects dev hot-reload
export const DEFAULT_RIDE_OPTIONS: RideOptionsValue = {
  kind: "ride", direction: "send", delivery_subtype: "parcel",
  sender_name: "", sender_phone: "", recipient_name: "", recipient_phone: "", package_description: "", package_size: "small",
  task_description: "", spend_limit: "", vendor_id: "", vendor_name: "", vendor_location: "", vendor_phone: "",
  no_prohibited_items: false, preferences: DEFAULT_PREFERENCES, shareable: false,
  payment: "auto", promo_code: "", promo_discount: 0,
};

interface PaymentOptions {
  organizations: { id: string; name: string; remaining_this_month: string | null }[];
  vouchers: { id: string; organization: string; kind: "value" | "rides"; value_remaining: string | null; rides_remaining: number | null }[];
  bundles: { id: string; name: string; rides_remaining: number; max_fare_per_ride: string }[];
}

// Same wording and order as the driver's "What you offer" (drivers' profile), so a passenger asks for
// exactly what a driver can say they offer. "Drivers I've ridden with" is passenger-only, so it's last.
const SOFT_LABELS: Record<"quiet_ride" | "needs_luggage_space" | "needs_accessibility_help" | "prefer_previous_drivers", string> = {
  quiet_ride: "Quiet ride",
  needs_luggage_space: "Space for luggage",
  needs_accessibility_help: "Help getting in and out",
  prefer_previous_drivers: "Riders I've ridden with",
};

const SUBTYPE_LABELS: Record<DeliverySubtype, string> = {
  parcel: "Parcel", errand: "Errand", vendor_order: "From a vendor",
};

/** Turns the panel's state into the extra fields POST /api/trips expects. */
// eslint-disable-next-line react/only-export-components -- exports this module's hook/helpers next to its component (standard pattern); only affects dev hot-reload
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
  // "auto": the server uses a ride bundle if one covers the trip, otherwise pay per trip.
  if (o.promo_code.trim() && ["cash", "auto", "momo", "hubtel"].includes(o.payment)) body.promo_code = o.promo_code.trim();
  return body;
}

// eslint-disable-next-line react/only-export-components -- exports this module's hook/helpers next to its component (standard pattern); only affects dev hot-reload
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

export default function RideOptions({
  value, onChange, fareEstimate, destination,
}: {
  value: RideOptionsValue;
  onChange: (v: RideOptionsValue) => void;
  fareEstimate: number | null;
  destination: { lat: number; lng: number } | null;
}) {
  const { user } = useAuth();
  const [payOpts, setPayOpts] = useState<PaymentOptions>({ organizations: [], vouchers: [], bundles: [] });
  const [promoMsg, setPromoMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [checking, setChecking] = useState(false);
  const [voucherCode, setVoucherCode] = useState("");
  const [voucherMsg, setVoucherMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [vendorResults, setVendorResults] = useState<Vendor[]>([]);
  const [vendorDropdownOpen, setVendorDropdownOpen] = useState(false);
  const vendorSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const set = (patch: Partial<RideOptionsValue>) => onChange({ ...value, ...patch });

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
    setVendorDropdownOpen(false);
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
    setVendorDropdownOpen(true);
    searchVendors(name);
  }

  function pickVendor(v: Vendor) {
    set({ vendor_id: v.id, vendor_name: v.name, vendor_location: v.location_label, vendor_phone: v.phone,
      sender_name: v.name, sender_phone: v.phone });
    setVendorDropdownOpen(false);
  }

  function loadPaymentOptions() {
    api.get<PaymentOptions>("/passengers/me/payment-options").then(({ data }) => setPayOpts(data)).catch(() => {});
  }
  useEffect(() => {
    loadPaymentOptions();
    api.get("/passengers/me/ride-preferences")
      .then(({ data }) => set({ preferences: { ...DEFAULT_PREFERENCES, ...data } })).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (value.promo_discount) { set({ promo_discount: 0 }); setPromoMsg(null); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fareEstimate, destination?.lat, destination?.lng]);

  async function checkPromo() {
    if (!value.promo_code.trim() || fareEstimate == null) return;
    setChecking(true);
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
    } finally {
      setChecking(false);
    }
  }

  async function redeemVoucher() {
    setVoucherMsg(null);
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
  const prefs = value.preferences;
  const setPref = (patch: Partial<RidePreferences>) => set({ preferences: { ...prefs, ...patch } });

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
      <div className="party">
        <div className="party-title">{title}</div>
        <label className="field-label" htmlFor={`${who}-name`}>Name</label>
        <input id={`${who}-name`} className="field-input" autoComplete="off" value={name}
          onChange={(e) => set(patch("name", e.target.value))} />
        <label className="field-label" htmlFor={`${who}-phone`}>Phone{phoneOptional ? " (optional)" : ""}</label>
        <input id={`${who}-phone`} className="field-input" inputMode="tel" placeholder="024 123 4567" autoComplete="off"
          value={phone} onChange={(e) => set(patch("phone", e.target.value))} />
      </div>
    );
  }

  return (
    <div className="ride-options">
      {isDelivery && (
        <div className="kind-toggle kind-toggle-3" role="tablist" aria-label="What kind of delivery?">
          {(["parcel", "errand", "vendor_order"] as const).map((s) => (
            <button key={s} role="tab" aria-selected={value.delivery_subtype === s}
              className={"kind-tab" + (value.delivery_subtype === s ? " kind-tab-on" : "")}
              onClick={() => setSubtype(s)}>
              {SUBTYPE_LABELS[s]}
            </button>
          ))}
        </div>
      )}

      {isDelivery && value.delivery_subtype === "parcel" && (
        <div className="opt-group">
          <div className="kind-toggle" role="tablist" aria-label="Sending or receiving?">
            <button role="tab" aria-selected={value.direction === "send"}
              className={"kind-tab" + (value.direction === "send" ? " kind-tab-on" : "")}
              onClick={() => setDirection("send")}>I'm sending</button>
            <button role="tab" aria-selected={value.direction === "receive"}
              className={"kind-tab" + (value.direction === "receive" ? " kind-tab-on" : "")}
              onClick={() => setDirection("receive")}>I'm receiving</button>
          </div>
          {party("sender", "Sender")}
          {party("recipient", "Recipient")}
          <label className="field-label" htmlFor="pkg">What is being sent?</label>
          <input id="pkg" className="field-input" placeholder="e.g. Textbook in a bag" value={value.package_description}
            onChange={(e) => set({ package_description: e.target.value })} />
          <label className="field-label" htmlFor="pkg-size">Size</label>
          <select id="pkg-size" className="field-input" value={value.package_size}
            onChange={(e) => set({ package_size: e.target.value as RideOptionsValue["package_size"] })}>
            <option value="small">Small: fits in a bag</option>
            <option value="medium">Medium: a box on the lap</option>
            <option value="large">Large: needs the rear space</option>
          </select>
        </div>
      )}

      {isDelivery && value.delivery_subtype === "errand" && (
        <div className="opt-group">
          {party("sender", "Collect from", true)}
          {party("recipient", "Deliver to")}
          <label className="field-label" htmlFor="task-desc">What do you need done?</label>
          <textarea id="task-desc" className="field-input field-textarea" rows={3}
            placeholder="e.g. Buy 2 yards of kente from Stall 14, Aboabo side"
            value={value.task_description} onChange={(e) => set({ task_description: e.target.value })} />
          <label className="field-label" htmlFor="spend-limit">Spending limit (optional)</label>
          <input id="spend-limit" className="field-input" inputMode="decimal" placeholder="e.g. 150"
            value={value.spend_limit} onChange={(e) => set({ spend_limit: e.target.value.replace(/[^0-9.]/g, "") })} />
          <p className="opt-note">The courier floats this and you settle up when they're back — cap it to whatever you're comfortable with.</p>
        </div>
      )}

      {isDelivery && value.delivery_subtype === "vendor_order" && (
        <div className="opt-group">
          <label className="field-label" htmlFor="vendor-name">Which vendor?</label>
          <div className="vendor-search">
            <input id="vendor-name" className="field-input" placeholder="Start typing a name…" autoComplete="off"
              value={value.vendor_name} onChange={(e) => typeVendorName(e.target.value)}
              onFocus={() => value.vendor_name.trim() && setVendorDropdownOpen(true)}
              onBlur={() => setTimeout(() => setVendorDropdownOpen(false), 150)} />
            {vendorDropdownOpen && vendorResults.length > 0 && (
              <ul className="vendor-dropdown">
                {vendorResults.map((v) => (
                  <li key={v.id}>
                    <button type="button" className="vendor-option" onMouseDown={() => pickVendor(v)}>
                      <strong>{v.name}</strong>
                      {v.location_label && <span>{v.location_label}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {!value.vendor_id && value.vendor_name.trim() && (
            <>
              <label className="field-label" htmlFor="vendor-location">Where is it? (optional)</label>
              <input id="vendor-location" className="field-input" placeholder="e.g. Stall 14, Aboabo side"
                value={value.vendor_location} onChange={(e) => set({ vendor_location: e.target.value })} />
            </>
          )}
          {party("sender", "Vendor contact", true)}
          {party("recipient", "Deliver to")}
          <label className="field-label" htmlFor="task-desc-vendor">What should the courier order?</label>
          <textarea id="task-desc-vendor" className="field-input field-textarea" rows={3}
            placeholder="e.g. 2x jollof with chicken, no salad" value={value.task_description}
            onChange={(e) => set({ task_description: e.target.value })} />
          <label className="field-label" htmlFor="spend-limit-vendor">Spending limit (optional)</label>
          <input id="spend-limit-vendor" className="field-input" inputMode="decimal" placeholder="e.g. 60"
            value={value.spend_limit} onChange={(e) => set({ spend_limit: e.target.value.replace(/[^0-9.]/g, "") })} />
        </div>
      )}

      {isDelivery && (
        <div className="opt-group">
          <label className="opt-check">
            <input type="checkbox" checked={value.no_prohibited_items}
              onChange={(e) => set({ no_prohibited_items: e.target.checked })} />
            No cash, weapons, drugs or animals in this package
          </label>
        </div>
      )}

      {isRide && (
        <div className="opt-group pool-box">
          <label className="opt-check">
            <input type="checkbox" checked={value.shareable} onChange={(e) => set({ shareable: e.target.checked })} />
            <span><strong>Share this ride</strong></span>
          </label>
        </div>
      )}

      {isRide && (
        <div className="opt-group">
          <label className="field-label" htmlFor="gender-pref">Rider preference (optional)</label>
          <select id="gender-pref" className="field-input" value={prefs.preferred_driver_gender}
            onChange={(e) => setPref({ preferred_driver_gender: e.target.value as RidePreferences["preferred_driver_gender"] })}>
            <option value="">No preference</option>
            <option value="female">Female rider</option>
            <option value="male">Male rider</option>
          </select>
          <div className="pref-chips">
            {(Object.keys(SOFT_LABELS) as (keyof typeof SOFT_LABELS)[]).map((k) => (
              <button key={k} type="button" aria-pressed={prefs[k]}
                className={"pref-chip" + (prefs[k] ? " pref-chip-on" : "")} onClick={() => setPref({ [k]: !prefs[k] })}>
                {SOFT_LABELS[k]}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="opt-group">
        <label className="field-label" htmlFor="pay">Pay with</label>
        <select id="pay" className="field-input" value={value.payment} onChange={(e) => set({ payment: e.target.value })}>
          <option value="auto">{isRide && hasBundle ? "My ride bundle (used first), else cash" : "Cash to rider"}</option>
          {isRide && hasBundle && <option value="cash">Cash to rider</option>}
          <option value="momo">MTN MoMo</option>
          <option value="hubtel">Hubtel</option>
          {payOpts.organizations.map((o) => (
            <option key={o.id} value={`org:${o.id}`}>
              Bill to {o.name}{o.remaining_this_month != null ? ` (GH₵${o.remaining_this_month} left)` : ""}
            </option>
          ))}
          {payOpts.vouchers.map((v) => (
            <option key={v.id} value={`voucher:${v.id}`}>
              Voucher from {v.organization}: {v.kind === "rides" ? `${v.rides_remaining} ride(s)` : `GH₵${v.value_remaining}`} left
            </option>
          ))}
          {isRide && payOpts.bundles.map((b) => (
            <option key={b.id} value={`bundle:${b.id}`}>
              {b.name}: {b.rides_remaining} ride{b.rides_remaining === 1 ? "" : "s"} left (up to GH₵{b.max_fare_per_ride})
            </option>
          ))}
        </select>
        <div className="promo-row" style={{ marginTop: 8 }}>
          <input className="field-input" value={voucherCode} placeholder="Have a voucher code?" aria-label="Voucher code"
            onChange={(e) => setVoucherCode(e.target.value.toUpperCase())} />
          <button className="btn btn-ghost" type="button" onClick={redeemVoucher} disabled={!voucherCode.trim()}>Redeem</button>
        </div>
        {voucherMsg && <p className={voucherMsg.ok ? "opt-ok" : "opt-err"}>{voucherMsg.text}</p>}
      </div>

      {canPromo && (
        <div className="opt-group">
          <label className="field-label" htmlFor="promo">Promo code</label>
          <div className="promo-row">
            <input id="promo" className="field-input" value={value.promo_code} placeholder="Optional"
              onChange={(e) => { set({ promo_code: e.target.value.toUpperCase(), promo_discount: 0 }); setPromoMsg(null); }} />
            <button className="btn btn-ghost" type="button" onClick={checkPromo}
              disabled={checking || !value.promo_code.trim() || fareEstimate == null}>
              {checking ? "Checking…" : "Apply"}
            </button>
          </div>
          {promoMsg && <p className={promoMsg.ok ? "opt-ok" : "opt-err"}>{promoMsg.text}</p>}
        </div>
      )}
    </div>
  );
}
