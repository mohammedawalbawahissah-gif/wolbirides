import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import AuthLayout from "../components/AuthLayout";
import PasswordField from "../components/PasswordField";
import "../components/authForm.css";

export default function SignUp() {
  const { requestSignupCode, requestAccess } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState<"details" | "code" | "pending">("details");
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
      const { granted } = await requestAccess(email, code, password, name.trim());
      if (granted) {
        navigate("/");
      } else {
        setStep("pending");
      }
    } catch (err: any) {
      setError(err?.response?.data?.detail || "That code didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (step === "pending") {
    return (
      <AuthLayout tagline="Account created.">
        <h2>Almost there</h2>
        <p className="auth-subtitle">
          Your account is verified, but it doesn't have ops dashboard access yet. Ask an
          existing admin to promote your account to <strong>admin</strong> or{" "}
          <strong>support</strong> — then sign in again.
        </p>
        <Link to="/signin" className="btn btn-primary btn-block" style={{ display: "block", textAlign: "center", textDecoration: "none" }}>
          Back to sign in
        </Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout tagline="Request ops access.">
      {step === "details" ? (
        <>
          <h2>Create your account</h2>
          <p className="auth-subtitle">
            This creates a verified account. An existing admin still needs to grant you
            dashboard access — this isn't self-serve sign-up for the ops console itself.
          </p>
          <form onSubmit={handleRequestCode}>
            <label htmlFor="name">Full name</label>
            <input id="name" type="text" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
            <label htmlFor="email">Email address</label>
            <input
              id="email"
              type="email"
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
          <h2>Enter your code</h2>
          <p className="auth-subtitle">We sent a 6-digit code to {email}.</p>
          <form onSubmit={handleVerify}>
            <label htmlFor="code">Verification code</label>
            <input
              id="code"
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
              autoFocus
            />
            {error && <div className="auth-error">{error}</div>}
            <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
              {busy ? "Verifying…" : "Create account"}
            </button>
          </form>
          <button type="button" className="auth-back-link" onClick={() => { setStep("details"); setError(null); }}>
            Edit details
          </button>
        </>
      )}
      <div className="auth-switch">
        Already have access? <Link to="/signin">Sign in</Link>
      </div>
    </AuthLayout>
  );
}
