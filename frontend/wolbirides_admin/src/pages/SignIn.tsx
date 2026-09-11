import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import AuthLayout from "../components/AuthLayout";
import "../components/authForm.css";

export default function SignIn() {
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
      const detail = err?.response?.data?.detail;
      setError(detail || "That code didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout tagline="Sign in to run the pilot.">
      {step === "phone" ? (
        <>
          <h2>Sign in</h2>
          <p className="auth-subtitle">For ops and support accounts only.</p>
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
            {error && <div className="auth-error">{error}</div>}
            <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
              {busy ? "Sending…" : "Send code"}
            </button>
          </form>
        </>
      ) : (
        <>
          <h2>Enter your code</h2>
          <p className="auth-subtitle">We sent a 6-digit code to {phone}.</p>
          <form onSubmit={handleVerify}>
            <label htmlFor="code">Verification code</label>
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
            {error && <div className="auth-error">{error}</div>}
            <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
              {busy ? "Verifying…" : "Sign in"}
            </button>
          </form>
          <button
            type="button"
            className="auth-back-link"
            onClick={() => {
              setStep("phone");
              setError(null);
            }}
          >
            Use a different number
          </button>
        </>
      )}
      <div className="auth-switch">
        Need an ops account? <Link to="/signup">Request access</Link>
      </div>
    </AuthLayout>
  );
}
