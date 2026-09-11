import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import "./Login.css";

export default function Login() {
  const { requestOtp, verifyOtp } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleRequestOtp(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await requestOtp(phone);
      setStep("code");
    } catch {
      setError("Couldn't send a code to that number. Check it and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleVerify(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await verifyOtp(phone, code);
      navigate("/");
    } catch (err: any) {
      setError(err?.response?.data?.detail || "That code didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-hero">
        <span className="login-mark">WR</span>
        <h1>WolbiRides Driver</h1>
        <p>Go online, accept rides, and get paid — built for founding drivers.</p>
      </div>

      <div className="login-form-area">
        {step === "phone" ? (
          <form onSubmit={handleRequestOtp}>
            <label htmlFor="phone">Phone number</label>
            <input
              id="phone"
              type="tel"
              placeholder="+233 XX XXX XXXX"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              required
              autoFocus
            />
            {error && <div className="login-error">{error}</div>}
            <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
              {busy ? "Sending…" : "Send code"}
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerify}>
            <label htmlFor="code">Enter the code sent to {phone}</label>
            <input
              id="code"
              type="text"
              inputMode="numeric"
              maxLength={6}
              placeholder="6-digit code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
              autoFocus
            />
            {error && <div className="login-error">{error}</div>}
            <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
              {busy ? "Verifying…" : "Verify & continue"}
            </button>
            <button
              type="button"
              className="login-back"
              onClick={() => {
                setStep("phone");
                setError(null);
              }}
            >
              Use a different number
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
