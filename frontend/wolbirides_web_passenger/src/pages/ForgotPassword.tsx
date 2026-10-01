import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import AuthLayout from "../components/AuthLayout";
import PasswordField from "../components/PasswordField";

/**
 * Two steps, same as the mobile apps: email → code from the email + new password.
 * A successful reset signs you in here and signs you out on every other device.
 */
export default function ForgotPassword() {
  const { resetPassword } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function sendCode(e?: FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { data } = await api.post("/auth/password/reset/request", { email: email.trim().toLowerCase() });
      setInfo(data.detail);
      setStep("code");
    } catch (err: any) {
      setError(err?.response?.status === 429 ? "Too many requests. Wait a few minutes and try again."
        : err?.response?.data?.detail || "Couldn't send a code right now.");
    } finally {
      setBusy(false);
    }
  }

  async function reset(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await resetPassword(email.trim().toLowerCase(), code.trim(), password);
      navigate("/", { replace: true });
    } catch (err: any) {
      setError(err?.response?.data?.detail || err?.message || "That didn't work. Check the code and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout tagline="Get back into your account.">
      <h2>Reset your password</h2>
      {step === "email" ? (
        <form onSubmit={sendCode}>
          <label htmlFor="email">Email address</label>
          <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
            autoComplete="email" required autoFocus />
          {error && <div className="auth-error">{error}</div>}
          <button className="btn btn-primary btn-block" type="submit" disabled={busy || !email.includes("@")}>
            {busy ? "Sending…" : "Send reset code"}
          </button>
        </form>
      ) : (
        <form onSubmit={reset}>
          <p className="auth-subtitle">{info}</p>
          <label htmlFor="code">Code from the email</label>
          <input id="code" inputMode="numeric" maxLength={6} value={code} autoComplete="one-time-code"
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} required autoFocus />
          <label htmlFor="new-password">New password</label>
          <PasswordField id="new-password" value={password} onChange={setPassword} autoComplete="new-password" />
          {error && <div className="auth-error">{error}</div>}
          <button className="btn btn-primary btn-block" type="submit" disabled={busy || code.length !== 6 || password.length < 8}>
            {busy ? "Saving…" : "Set new password and sign in"}
          </button>
          <button className="btn btn-ghost btn-block" type="button" disabled={busy} onClick={() => sendCode()}>
            Send a new code
          </button>
        </form>
      )}
      <div className="auth-switch">
        Remembered it? <Link to="/signin">Sign in</Link>
      </div>
    </AuthLayout>
  );
}
