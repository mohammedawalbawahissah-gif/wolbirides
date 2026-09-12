import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import AuthLayout from "../components/AuthLayout";
import PasswordField from "../components/PasswordField";
import "../components/authForm.css";

export default function SignIn() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(email, password);
      navigate("/");
    } catch (err: any) {
      setError(err?.response?.data?.detail || "Incorrect email or password.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout tagline="Welcome back.">
      <h2>Sign in</h2>
      <p className="auth-subtitle">You'll stay signed in on this device until you sign out.</p>
      <form onSubmit={handleSubmit}>
        <label htmlFor="email">Email address</label>
        <input
          id="email"
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
          autoFocus
        />
        <label htmlFor="password">Password</label>
        <PasswordField id="password" value={password} onChange={setPassword} autoComplete="current-password" />
        {error && <div className="auth-error">{error}</div>}
        <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
      <div className="auth-switch">
        New to WolbiRides? <Link to="/signup">Create an account</Link>
      </div>
    </AuthLayout>
  );
}
