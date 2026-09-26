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
          hint="Riders see this when you're matched — a clear headshot builds trust."
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
      <p style={{ fontSize: 13.5, color: "var(--ink-muted)", marginTop: 0 }}>
        If you press SOS during a trip, we'll text this person your location.
      </p>
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

  const ITEMS: [keyof typeof driver & string, string, string][] = [
    ["offers_quiet_ride", "Quiet rides", "Happy to keep music off and chat to a minimum"],
    ["has_luggage_space", "Luggage space", "Room for suitcases or boxes"],
    ["accessibility_trained", "Accessibility help", "Comfortable helping passengers with mobility needs"],
    ["accepts_deliveries", "Deliveries", "Carry packages for WolbiDeliver"],
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
      <p style={{ fontSize: 13.5, color: "var(--ink-muted)", marginTop: 0 }}>
        Passengers who ask for these get matched with you first when you're about as close as other drivers.
      </p>
      <label className="field-label" htmlFor="drv-gender" style={{ marginTop: 8 }}>Gender (optional)</label>
      <select id="drv-gender" className="field-input" value={driver.gender ?? ""} onChange={(e) => setGender(e.target.value)}>
        <option value="">Prefer not to say</option>
        <option value="female">Female</option>
        <option value="male">Male</option>
      </select>
      <p style={{ fontSize: 12.5, color: "var(--ink-muted)", marginTop: -4 }}>
        Only used to match riders who ask for it. It isn't shown to riders or on your profile.
      </p>
      {ITEMS.map(([field, label, hint]) => (
        <label key={field} style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "10px 0",
          borderTop: "1px solid var(--line)", cursor: "pointer" }}>
          <input type="checkbox" checked={!!(driver as any)[field]} onChange={(e) => toggle(field, e.target.checked)}
            style={{ marginTop: 3 }} />
          <span>
            <strong style={{ fontSize: 14 }}>{label}</strong>
            <span style={{ display: "block", fontSize: 12.5, color: "var(--ink-muted)" }}>{hint}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

/** WR-20: fairness is explained to drivers in plain terms, not discovered through suspicion. */
function HowRidesAreShared() {
  return (
    <div className="card" style={{ maxWidth: 420, marginTop: 16 }}>
      <h2 style={{ fontSize: 16, margin: "0 0 6px" }}>How rides are offered</h2>
      <p style={{ fontSize: 13.5, lineHeight: 1.55, margin: 0 }}>
        Most rides go to the nearest free driver, because riders shouldn't wait longer than they need to. Now and
        then, among drivers who are about equally close, we offer a ride first to the driver who's had fewer rides
        this week, so the work stays reasonably shared. We never send you a ride that's much further away just for
        this.
      </p>
    </div>
  );
}
