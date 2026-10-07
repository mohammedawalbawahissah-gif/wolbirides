import { useState, type FormEvent } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useDriverContext } from "../components/DriverGate";
import FileDrop from "../components/FileDrop";
import SupportCard from "../components/SupportCard";
import { useToast } from "../components/Toast";

export default function Profile() {
  const { user, updateProfilePhoto } = useAuth();
  const { driver } = useDriverContext();
  const toast = useToast();

  async function handlePhotoChange(url: string | null) {
    if (!url) return;
    try {
      await updateProfilePhoto(url);
      toast.show("Profile photo updated.", "success");
    } catch {
      toast.show("Couldn't save your photo — try again.", "error");
    }
  }

  return (
    <div>
      <div className="page-heading">
        <h1>Profile</h1>
        <p>{user?.email || user?.phone}</p>
      </div>

      <div className="card" style={{ maxWidth: 420 }}>
        <FileDrop
          kind="profile_photo"
          label="Profile photo"
          value={user?.profile_photo || null}
          onChange={handlePhotoChange}
        />

        <div className="kv-row">
          <span>Licence</span>
          <strong style={{ fontFamily: "monospace" }}>{driver.licence_number}</strong>
        </div>
        <div className="kv-row">
          <span>Vehicle</span>
          <strong>{driver.vehicles[0]?.plate_number || "—"}</strong>
        </div>
        <div className="kv-row">
          <span>Status</span>
          <span className={"badge " + (driver.verification_status === "verified" ? "badge-success" : "badge-warning")}>
            {driver.verification_status}
          </span>
        </div>
      </div>

      <CommercialDetailsCard />
      <PayoutCard />
      <CapabilitiesCard />
      <HowRidesAreShared />
      <SupportCard />
      <EmergencyContactCard />
    </div>
  );
}

/** WR-18: texted with your location if you press SOS during a trip. */
function EmergencyContactCard() {
  const { user, refreshUser } = useAuth();
  const toast = useToast();
  const [name, setName] = useState(user?.emergency_contact_name || "");
  const [phone, setPhone] = useState(user?.emergency_contact_phone || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.patch("/passengers/me", { emergency_contact_name: name.trim(), emergency_contact_phone: phone.trim() });
      await refreshUser();
      toast.show(phone.trim() ? "Emergency contact saved." : "Emergency contact removed.", "success");
    } catch (err: any) {
      setError(err?.response?.data?.emergency_contact_phone?.[0] || "Couldn't save your emergency contact.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card" style={{ maxWidth: 420, marginTop: 16 }}>
      <h2 style={{ fontSize: 16, margin: "0 0 4px" }}>Emergency contact</h2>
      <form onSubmit={save}>
        <label className="field-label" htmlFor="ec-name">Name</label>
        <input id="ec-name" className="field-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Brother" />
        <label className="field-label" htmlFor="ec-phone">Phone number</label>
        <input id="ec-phone" className="field-input" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="024 123 4567" />
        {error && <p style={{ color: "var(--danger)", fontSize: 13.5 }}>{error}</p>}
        <button className="btn btn-gold" type="submit" disabled={saving}>{saving ? "Saving…" : "Save contact"}</button>
      </form>
    </div>
  );
}

/** Where payouts go — a rider's mobile money wallet is sometimes on a different number
 * from the one they signed up with, so this is never assumed from the account phone. */
function PayoutCard() {
  const { user } = useAuth();
  const { driver, setDriver } = useDriverContext();
  const toast = useToast();
  const [provider, setProvider] = useState(driver.payout_provider ?? "momo");
  const [phone, setPhone] = useState(driver.payout_phone ?? "");
  const [saving, setSaving] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const { data } = await api.patch("/drivers/me", { payout_provider: provider, payout_phone: phone.trim() });
      setDriver(data);
      toast.show("Payout details saved.", "success");
    } catch {
      toast.show("Couldn't save that. Try again.", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card" style={{ maxWidth: 420, marginTop: 16 }}>
      <h2 style={{ fontSize: 16, margin: "0 0 4px" }}>Get paid</h2>
      <form onSubmit={save}>
        <label className="field-label" htmlFor="payout-provider">Provider</label>
        <select id="payout-provider" className="field-input" value={provider}
          onChange={(e) => setProvider(e.target.value as "momo" | "hubtel")}>
          <option value="momo">MTN MoMo</option>
          <option value="hubtel">Hubtel</option>
        </select>
        <label className="field-label" htmlFor="payout-phone">Number</label>
        <input id="payout-phone" className="field-input" inputMode="tel" value={phone}
          placeholder={user?.phone || "Your account phone"} onChange={(e) => setPhone(e.target.value)} />
        <p className="opt-note">Leave blank to use your account phone.</p>
        <button className="btn btn-gold" type="submit" disabled={saving}>{saving ? "Saving…" : "Save payout details"}</button>
      </form>
    </div>
  );
}

/** WR-19/23: what this driver offers. Matching favours drivers who fit a passenger's needs. */
function CapabilitiesCard() {
  const { driver, setDriver } = useDriverContext();
  const toast = useToast();
  async function setGender(value: string) {
    try {
      const { data } = await api.patch("/drivers/me", { gender: value });
      setDriver(data);
    } catch {
      toast.show("Couldn't save that. Try again.", "error");
    }
  }

  // Same wording and order as the passenger's "Driver preference", so what a passenger can ask for is
  // exactly what a driver can say they offer. "Deliveries" is driver-only, so it's last.
  const ITEMS: [keyof typeof driver & string, string][] = [
    ["offers_quiet_ride", "Quiet ride"],
    ["has_luggage_space", "Space for luggage"],
    ["accessibility_trained", "Help getting in and out"],
    ["accepts_deliveries", "Deliveries (WolbiDeliver)"],
  ];

  async function toggle(field: string, value: boolean) {
    try {
      const { data } = await api.patch("/drivers/me", { [field]: value });
      setDriver(data);
    } catch {
      toast.show("Couldn't save that. Try again.", "error");
    }
  }

  return (
    <div className="card" style={{ maxWidth: 420, marginTop: 16 }}>
      <h2 style={{ fontSize: 16, margin: "0 0 4px" }}>What you offer</h2>
      <label className="field-label" htmlFor="drv-gender" style={{ marginTop: 8 }}>Rider gender (optional)</label>
      <select id="drv-gender" className="field-input" value={driver.gender ?? ""} onChange={(e) => setGender(e.target.value)}>
        <option value="">Prefer not to say</option>
        <option value="female">Female rider</option>
        <option value="male">Male rider</option>
      </select>
      <div className="pref-chips">
        {ITEMS.map(([field, label]) => (
          <button key={field} type="button" aria-pressed={!!(driver as any)[field]}
            className={"pref-chip" + ((driver as any)[field] ? " pref-chip-on" : "")}
            onClick={() => toggle(field, !(driver as any)[field])}>
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** WR-20: fairness is explained to drivers in plain terms, not discovered through suspicion. */
function HowRidesAreShared() {
  return (
    <div className="card" style={{ maxWidth: 420, marginTop: 16 }}>
      <h2 style={{ fontSize: 16, margin: "0 0 6px" }}>How rides are offered</h2>
      <p style={{ fontSize: 13.5, lineHeight: 1.55, margin: 0 }}>
        Most rides go to the nearest free rider, because passengers shouldn't wait longer than they need to. Now and
        then, among riders who are about equally close, we offer a ride first to the rider who's had fewer rides
        this week, so the work stays reasonably shared. We never send you a ride that's much further away just for
        this.
      </p>
    </div>
  );
}


const MISSING_LABELS: Record<string, string> = {
  licence_number: "licence number",
  ghana_card_number: "Ghana Card",
  transport_union: "transport union",
  union_membership_number: "union membership number",
  vehicle: "vehicle",
  roadworthy_expiry: "roadworthy expiry",
};

/** LI 2519 commercial rider details. Riders who applied before these were required fill them in here. */
function CommercialDetailsCard() {
  const { driver, setDriver } = useDriverContext();
  const toast = useToast();
  const vehicle = driver.vehicles.find((v) => v.active) || driver.vehicles[0];
  const [ghanaCard, setGhanaCard] = useState(driver.ghana_card_number || "");
  const [ghanaCardDoc, setGhanaCardDoc] = useState<string | null>(driver.ghana_card_document || null);
  const [union, setUnion] = useState(driver.transport_union || "");
  const [unionNumber, setUnionNumber] = useState(driver.union_membership_number || "");
  const [unionDoc, setUnionDoc] = useState<string | null>(driver.union_card_document || null);
  const [rwExpiry, setRwExpiry] = useState(vehicle?.roadworthy_expiry || "");
  const [rwDoc, setRwDoc] = useState<string | null>(vehicle?.roadworthy_certificate || null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const missing = driver.compliance_missing || [];

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const { data } = await api.patch("/drivers/me", {
        ...(ghanaCard.trim() ? { ghana_card_number: ghanaCard.trim() } : {}),
        ghana_card_document: ghanaCardDoc || "",
        transport_union: union.trim(),
        union_membership_number: unionNumber.trim(),
        union_card_document: unionDoc || "",
        ...(vehicle ? { roadworthy_expiry: rwExpiry || null, roadworthy_certificate: rwDoc || "" } : {}),
      });
      setDriver(data);
      toast.show("Details saved.", "success");
    } catch (err: any) {
      const d = err?.response?.data;
      const first = d && typeof d === "object" ? Object.values(d).flat()[0] : null;
      setError(typeof first === "string" ? first : "Couldn't save. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card" style={{ maxWidth: 420, marginTop: 16 }}>
      <h2 className="side-card-title">Commercial rider details</h2>
      {missing.length > 0 ? (
        <p className="opt-note">Still needed: {missing.map((m) => MISSING_LABELS[m] || m).join(", ")}.</p>
      ) : (
        <p className="opt-note">All required details are on file.</p>
      )}
      <form onSubmit={save}>
        <label className="field-label" htmlFor="pf-ghana">Ghana Card number</label>
        <input id="pf-ghana" className="field-input" placeholder="GHA-123456789-0" autoComplete="off"
          value={ghanaCard} onChange={(e) => setGhanaCard(e.target.value)} />
        <FileDrop kind="ghana_card_document" label="Photo of your Ghana Card" value={ghanaCardDoc} onChange={setGhanaCardDoc} />
        <label className="field-label" htmlFor="pf-union">Transport union (optional)</label>
        <input id="pf-union" className="field-input" placeholder="e.g. NUTO, Tamale branch"
          value={union} onChange={(e) => setUnion(e.target.value)} />
        <label className="field-label" htmlFor="pf-union-no">Union membership number (optional)</label>
        <input id="pf-union-no" className="field-input" value={unionNumber} onChange={(e) => setUnionNumber(e.target.value)} />
        <FileDrop kind="union_card_document" label="Photo of your union card (optional)" value={unionDoc} onChange={setUnionDoc} />
        {vehicle && (
          <>
            <label className="field-label" htmlFor="pf-rw">Roadworthy certificate expiry (optional)</label>
            <input id="pf-rw" type="date" className="field-input" value={rwExpiry} onChange={(e) => setRwExpiry(e.target.value)} />
            <FileDrop kind="roadworthy_certificate" label="Roadworthy certificate (optional)" value={rwDoc} onChange={setRwDoc} />
          </>
        )}
        {error && <div className="auth-error">{error}</div>}
        <button className="btn btn-gold btn-block" type="submit" disabled={saving}>{saving ? "Saving…" : "Save details"}</button>
      </form>
    </div>
  );
}
