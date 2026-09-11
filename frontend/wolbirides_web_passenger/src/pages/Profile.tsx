import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

export default function Profile() {
  const { user, updateName, logout } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState(user?.name || "");
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    await updateName(name);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  function handleLogout() {
    logout();
    navigate("/login");
  }

  return (
    <div className="screen">
      <h1 className="screen-title">Profile</h1>
      <p className="screen-subtitle">{user?.phone}</p>

      <div className="card" style={{ marginBottom: 16 }}>
        <label style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-muted)", display: "block", marginBottom: 6 }}>
          Name
        </label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          style={{
            width: "100%", padding: "11px 12px", border: "1px solid var(--line)",
            borderRadius: 8, fontSize: 15, marginBottom: 10,
          }}
        />
        <button className="btn btn-primary btn-block" onClick={handleSave}>
          {saved ? "Saved ✓" : "Save"}
        </button>
      </div>

      <button className="btn btn-ghost btn-block" onClick={handleLogout}>
        Log out
      </button>
    </div>
  );
}
