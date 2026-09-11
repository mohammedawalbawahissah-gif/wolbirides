import { useState } from "react";
import { useAuth } from "../auth/AuthContext";
import "./Profile.css";

export default function Profile() {
  const { user, updateName } = useAuth();
  const [name, setName] = useState(user?.name || "");
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    await updateName(name);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="profile-page">
      <div className="page-heading">
        <h1>Profile</h1>
        <p>{user?.phone}</p>
      </div>

      <div className="card profile-card">
        <label className="field-label" htmlFor="name">Name</label>
        <input
          id="name"
          className="field-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
        />
        <button className="btn btn-primary" onClick={handleSave}>
          {saved ? "Saved ✓" : "Save changes"}
        </button>
      </div>
    </div>
  );
}
