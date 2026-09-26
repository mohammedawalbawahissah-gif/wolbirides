import { useEffect, useState } from "react";
import { api } from "../api/client";
import "./RideOptions.css";

export interface RidePreferences {
  preferred_driver_gender: "" | "female" | "male";
  prefer_previous_drivers: boolean;
  quiet_ride: boolean;
  needs_luggage_space: boolean;
  needs_accessibility_help: boolean;
}

export interface RideOptionsValue {
  kind: "ride" | "delivery";
  recipient_name: string;
  recipient_phone: string;
  package_description: string;
  package_size: "small" | "medium" | "large";
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
  kind: "ride", recipient_name: "", recipient_phone: "", package_description: "", package_size: "small",
  no_prohibited_items: false, preferences: DEFAULT_PREFERENCES, shareable: false,
  payment: "auto", promo_code: "", promo_discount: 0,
};

interface PaymentOptions {
  organizations: { id: string; name: string; remaining_this_month: string | null }[];
  vouchers: { id: string; organization: string; kind: "value" | "rides"; value_remaining: string | null; rides_remaining: number | null }[];
  bundles: { id: string; name: string; rides_remaining: number; max_fare_per_ride: string }[];
}

const SOFT_LABELS: Record<"quiet_ride" | "needs_luggage_space" | "needs_accessibility_help" | "prefer_previous_drivers", string> = {
  prefer_previous_drivers: "Drivers I've ridden with",
  quiet_ride: "Quiet ride",
  needs_luggage_space: "Space for luggage",
  needs_accessibility_help: "Help getting in and out",
};

/** Turns the panel's state into the extra fields POST /api/trips expects. */
// eslint-disable-next-line react/only-export-components -- exports this module's hook/helpers next to its component (standard pattern); only affects dev hot-reload
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
  // "auto": the server uses a ride bundle if one covers the trip, otherwise pay per trip.
  if (o.promo_code.trim() && (o.payment === "cash" || o.payment === "auto")) body.promo_code = o.promo_code.trim();
  return body;
}

// eslint-disable-next-line react/only-export-components -- exports this module's hook/helpers next to its component (standard pattern); only affects dev hot-reload
export function deliveryIsComplete(o: RideOptionsValue) {
  return o.kind === "ride" || (!!o.recipient_name.trim() && !!o.recipient_phone.trim() &&
    !!o.package_description.trim() && o.no_prohibited_items);
}

export default function RideOptions({
  value, onChange, fareEstimate, destination, zoneBaseFare,
}: {
  value: RideOptionsValue;
  onChange: (v: RideOptionsValue) => void;
  fareEstimate: number | null;
  destination: { lat: number; lng: number } | null;
  zoneBaseFare?: number;
}) {
  const [payOpts, setPayOpts] = useState<PaymentOptions>({ organizations: [], vouchers: [], bundles: [] });
  const [promoMsg, setPromoMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [checking, setChecking] = useState(false);
  const [voucherCode, setVoucherCode] = useState("");
  const [voucherMsg, setVoucherMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const set = (patch: Partial<RideOptionsValue>) => onChange({ ...value, ...patch });

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
  const hasBundle = payOpts.bundles.length > 0;
  const canPromo = value.payment === "cash" || value.payment === "auto";
  const prefs = value.preferences;
  const setPref = (patch: Partial<RidePreferences>) => set({ preferences: { ...prefs, ...patch } });

  return (
    <div className="ride-options">
      <div className="kind-toggle" role="tablist" aria-label="What are you booking?">
        {(["ride", "delivery"] as const).map((k) => (
          <button key={k} role="tab" aria-selected={value.kind === k}
            className={"kind-tab" + (value.kind === k ? " kind-tab-on" : "")}
            onClick={() => set({ kind: k, shareable: k === "ride" && value.shareable,
              payment: k === "delivery" && value.payment.startsWith("bundle:") ? "auto" : value.payment })}>
            {k === "ride" ? "Ride" : "Send a package"}
          </button>
        ))}
      </div>

      {value.kind === "delivery" && (
        <div className="opt-group">
          <label className="field-label" htmlFor="rcpt-name">Recipient's name</label>
          <input id="rcpt-name" className="field-input" value={value.recipient_name}
            onChange={(e) => set({ recipient_name: e.target.value })} />
          <label className="field-label" htmlFor="rcpt-phone">Recipient's phone</label>
          <input id="rcpt-phone" className="field-input" inputMode="tel" placeholder="024 123 4567"
            value={value.recipient_phone} onChange={(e) => set({ recipient_phone: e.target.value })} />
          <label className="field-label" htmlFor="pkg">What are you sending?</label>
          <input id="pkg" className="field-input" placeholder="e.g. Textbook in a bag" value={value.package_description}
            onChange={(e) => set({ package_description: e.target.value })} />
          <label className="field-label" htmlFor="pkg-size">Size</label>
          <select id="pkg-size" className="field-input" value={value.package_size}
            onChange={(e) => set({ package_size: e.target.value as RideOptionsValue["package_size"] })}>
            <option value="small">Small: fits in a bag</option>
            <option value="medium">Medium: a box on the lap</option>
            <option value="large">Large: needs the rear space</option>
          </select>
          <label className="opt-check">
            <input type="checkbox" checked={value.no_prohibited_items}
              onChange={(e) => set({ no_prohibited_items: e.target.checked })} />
            No cash, weapons, drugs or animals in this package
          </label>
          <p className="opt-note">
            You'll get a pickup code to show the driver. The recipient gets a drop-off code by SMS; the driver needs it to finish.
          </p>
        </div>
      )}

      {isRide && (
        <div className="opt-group pool-box">
          <label className="opt-check">
            <input type="checkbox" checked={value.shareable} onChange={(e) => set({ shareable: e.target.checked })} />
            <span><strong>Share this ride</strong><br />
              If someone nearby is going your way, you'll ride together and split the base fare
              {zoneBaseFare ? ` (save up to GH₵${(zoneBaseFare / 2).toFixed(2)})` : ""}. You never pay more than riding alone.
            </span>
          </label>
        </div>
      )}

      {isRide && (
        <div className="opt-group">
          <label className="field-label" htmlFor="gender-pref">Driver preference (optional)</label>
          <select id="gender-pref" className="field-input" value={prefs.preferred_driver_gender}
            onChange={(e) => setPref({ preferred_driver_gender: e.target.value as RidePreferences["preferred_driver_gender"] })}>
            <option value="">No preference</option>
            <option value="female">Female driver</option>
            <option value="male">Male driver</option>
          </select>
          <div className="pref-chips">
            {(Object.keys(SOFT_LABELS) as (keyof typeof SOFT_LABELS)[]).map((k) => (
              <button key={k} type="button" aria-pressed={prefs[k]}
                className={"pref-chip" + (prefs[k] ? " pref-chip-on" : "")} onClick={() => setPref({ [k]: !prefs[k] })}>
                {SOFT_LABELS[k]}
              </button>
            ))}
          </div>
          <p className="opt-note">
            Only our matching uses these; drivers never see them. If no matching driver is free, we'll ask before
            sending anyone else.
          </p>
        </div>
      )}

      <div className="opt-group">
        <label className="field-label" htmlFor="pay">Pay with</label>
        <select id="pay" className="field-input" value={value.payment} onChange={(e) => set({ payment: e.target.value })}>
          <option value="auto">{isRide && hasBundle ? "My ride bundle (used first), else cash" : "Cash to driver"}</option>
          {isRide && hasBundle && <option value="cash">Cash to driver</option>}
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
        {value.payment === "auto" && isRide && hasBundle && (
          <p className="opt-note">This ride will use one ride from your bundle if it's within the bundle's fare limit.</p>
        )}
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
          {value.promo_code.trim() && value.payment === "auto" && hasBundle && isRide && (
            <p className="opt-note">With a promo code, this ride is paid per trip rather than from your bundle.</p>
          )}
        </div>
      )}
    </div>
  );
}
