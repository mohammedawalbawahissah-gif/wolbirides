import { useState, type FormEvent } from "react";
import { api } from "../api/client";

export default function Apply({ onApplied }: { onApplied: () => void }) {
  const [licenceNumber, setLicenceNumber] = useState("");
  const [licenceExpiry, setLicenceExpiry] = useState("");
  const [plateNumber, setPlateNumber] = useState("");
  const [emergencyName, setEmergencyName] = useState("");
  const [emergencyPhone, setEmergencyPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/drivers/apply", {
        licence_number: licenceNumber,
        licence_expiry: licenceExpiry || undefined,
        plate_number: plateNumber,
        emergency_contact_name: emergencyName,
        emergency_contact_phone: emergencyPhone,
      });
      onApplied();
    } catch {
      setError("Couldn't submit your application. Check the details and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="screen">
      <h1 className="screen-title">Apply to drive</h1>
      <p className="screen-subtitle">
        Founding drivers get priority ride access and reduced platform fees (WR-07.1). An
        ops team member reviews your documents before you can go online.
      </p>

      <form onSubmit={handleSubmit}>
        <label className="field-label" htmlFor="licence">Commercial rider licence number</label>
        <input
          id="licence"
          className="field-input"
          value={licenceNumber}
          onChange={(e) => setLicenceNumber(e.target.value)}
          required
        />

        <label className="field-label" htmlFor="expiry">Licence expiry (optional)</label>
        <input
          id="expiry"
          type="date"
          className="field-input"
          value={licenceExpiry}
          onChange={(e) => setLicenceExpiry(e.target.value)}
        />

        <label className="field-label" htmlFor="plate">Vehicle plate number</label>
        <input
          id="plate"
          className="field-input"
          value={plateNumber}
          onChange={(e) => setPlateNumber(e.target.value)}
          placeholder="GT-1234-24"
          required
        />

        <label className="field-label" htmlFor="ename">Emergency contact name</label>
        <input
          id="ename"
          className="field-input"
          value={emergencyName}
          onChange={(e) => setEmergencyName(e.target.value)}
        />

        <label className="field-label" htmlFor="ephone">Emergency contact phone</label>
        <input
          id="ephone"
          className="field-input"
          value={emergencyPhone}
          onChange={(e) => setEmergencyPhone(e.target.value)}
        />

        {error && (
          <div style={{ background: "var(--danger-bg)", color: "var(--danger)", padding: "10px 12px", borderRadius: 8, fontSize: 13.5, marginBottom: 12 }}>
            {error}
          </div>
        )}

        <button className="btn btn-gold btn-block" type="submit" disabled={busy}>
          {busy ? "Submitting…" : "Submit application"}
        </button>
      </form>

      <p style={{ fontSize: 12, color: "var(--ink-muted)", marginTop: 12 }}>
        Vehicle photo and document upload aren't wired up yet in this build — ops can attach
        those via the admin dashboard once Cloudinary is configured.
      </p>
    </div>
  );
}
