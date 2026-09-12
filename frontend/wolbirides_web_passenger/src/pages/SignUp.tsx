import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import AuthLayout from "../components/AuthLayout";
import PasswordField from "../components/PasswordField";
import "../components/authForm.css";

export default function SignUp() {
  const { requestSignupCode, signup } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState<"details" | "code">("details");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleRequestCode(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await requestSignupCode(email);
      setStep("code");
    } catch {
      setError("Couldn't send a code to that email. Check it and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleVerify(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await signup(email, code, password, name.trim());
      navigate("/");
    } catch (err: any) {
      setError(err?.response?.data?.detail || "That code didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout tagline="Move around UDS with more confidence.">
      {step === "details" ? (
        <>
          <h2>Create your account</h2>
          <p className="auth-subtitle">We'll email you a code to verify it's really you.</p>
          <form onSubmit={handleRequestCode}>
            <label htmlFor="name">Full name</label>
            <input
              id="name"
              type="text"
              placeholder="e.g. Ama Boateng"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoFocus
            />
            <label htmlFor="email">Email address</label>
            <input
              id="email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
            <label htmlFor="password">Password</label>
            <PasswordField
              id="password"
              value={password}
              onChange={setPassword}
              autoComplete="new-password"
              minLength={8}
              placeholder="At least 8 characters"
            />
            {error && <div className="auth-error">{error}</div>}
            <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
              {busy ? "Sending…" : "Send verification code"}
            </button>
          </form>
        </>
      ) : (
        <>
          <h2>Check your email</h2>
          <p className="auth-subtitle">We sent a 6-digit code to {email}.</p>
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
              {busy ? "Creating account…" : "Create account"}
            </button>
          </form>
          <button
            type="button"
            className="auth-back-link"
            onClick={() => {
              setStep("details");
              setError(null);
            }}
          >
            Edit details
          </button>
        </>
      )}
      <div className="auth-switch">
        Already have an account? <Link to="/signin">Sign in</Link>
      </div>
    </AuthLayout>
  );
}
