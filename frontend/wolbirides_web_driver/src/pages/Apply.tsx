import { useState, type FormEvent } from "react";
import { api } from "../api/client";
import FileDrop from "../components/FileDrop";
import OnboardingLayout from "../components/OnboardingLayout";
import OnboardingStepper from "../components/OnboardingStepper";
import { useToast } from "../components/Toast";
import "../components/authForm.css";
import "./Apply.css";

const STEPS = ["Licence", "Vehicle", "Contact & review"];

export default function Apply({ onApplied }: { onApplied: () => void }) {
  const toast = useToast();
  const [step, setStep] = useState(0);

  const [licenceNumber, setLicenceNumber] = useState("");
  const [licenceExpiry, setLicenceExpiry] = useState("");
  const [licenceDocument, setLicenceDocument] = useState<string | null>(null);

  const [plateNumber, setPlateNumber] = useState("");
  const [vehiclePhoto, setVehiclePhoto] = useState<string | null>(null);
  const [vehicleRegDocument, setVehicleRegDocument] = useState<string | null>(null);

  const [emergencyName, setEmergencyName] = useState("");
  const [emergencyPhone, setEmergencyPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const step1Valid = licenceNumber.trim().length > 0;
  const step2Valid = plateNumber.trim().length > 0;

  function next(e: FormEvent) {
    e.preventDefault();
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  function back() {
    setStep((s) => Math.max(s - 1, 0));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/drivers/apply", {
        licence_number: licenceNumber,
        licence_expiry: licenceExpiry || undefined,
        licence_document: licenceDocument || undefined,
        plate_number: plateNumber,
        vehicle_photo: vehiclePhoto || undefined,
        vehicle_registration_document: vehicleRegDocument || undefined,
        emergency_contact_name: emergencyName,
        emergency_contact_phone: emergencyPhone,
      });
      toast.show("Application submitted — ops will review your documents.", "success");
      onApplied();
    } catch {
      setError("Couldn't submit your application. Check the details and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <OnboardingLayout>
      <div className="page-heading">
        <h1>Apply to drive</h1>
        <p>
          Founding drivers get priority ride access and reduced platform fees (WR-07.1). Ops
          reviews your documents before you can go online.
        </p>
      </div>

      <OnboardingStepper steps={STEPS} current={step} />

      <div className="card apply-card">
        {step === 0 && (
          <form onSubmit={next}>
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

            <FileDrop
              kind="licence_document"
              label="Photo of your licence"
              hint="A clear photo or scan — ops uses this to verify you before your first ride."
              value={licenceDocument}
              onChange={setLicenceDocument}
            />

            <button className="btn btn-gold btn-block" type="submit" disabled={!step1Valid}>
              Continue
            </button>
          </form>
        )}

        {step === 1 && (
          <form onSubmit={next}>
            <label className="field-label" htmlFor="plate">Vehicle plate number</label>
            <input
              id="plate"
              className="field-input"
              value={plateNumber}
              onChange={(e) => setPlateNumber(e.target.value)}
              placeholder="GT-1234-24"
              required
            />

            <FileDrop
              kind="vehicle_photo"
              label="Vehicle photo"
              hint="A clear side-on photo showing the yellow-yellow paint and plate."
              value={vehiclePhoto}
              onChange={setVehiclePhoto}
            />

            <FileDrop
              kind="vehicle_registration_document"
              label="Vehicle registration document"
              value={vehicleRegDocument}
              onChange={setVehicleRegDocument}
            />

            <div className="apply-step-actions">
              <button type="button" className="btn btn-ghost" onClick={back}>Back</button>
              <button className="btn btn-gold" type="submit" disabled={!step2Valid}>Continue</button>
            </div>
          </form>
        )}

        {step === 2 && (
          <form onSubmit={handleSubmit}>
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

            <div className="apply-review">
              <div className="apply-review-row"><span>Licence</span><strong>{licenceNumber}</strong></div>
              <div className="apply-review-row"><span>Plate</span><strong>{plateNumber}</strong></div>
              <div className="apply-review-row">
                <span>Documents</span>
                <strong>
                  {[licenceDocument, vehiclePhoto, vehicleRegDocument].filter(Boolean).length} of 3 uploaded
                </strong>
              </div>
            </div>

            {error && <div className="auth-error">{error}</div>}

            <div className="apply-step-actions">
              <button type="button" className="btn btn-ghost" onClick={back}>Back</button>
              <button className="btn btn-gold" type="submit" disabled={busy}>
                {busy ? "Submitting…" : "Submit application"}
              </button>
            </div>
          </form>
        )}
      </div>
    </OnboardingLayout>
  );
}
