import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { useDriverContext } from "../components/DriverGate";

export default function Profile() {
  const { user, logout } = useAuth();
  const { driver } = useDriverContext();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate("/login");
  }

  return (
    <div className="screen">
      <h1 className="screen-title">Profile</h1>
      <p className="screen-subtitle">{user?.phone}</p>

      {driver && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
            <span style={{ fontSize: 13, color: "var(--ink-muted)" }}>Licence</span>
            <span style={{ fontWeight: 600, fontFamily: "monospace" }}>{driver.licence_number}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
            <span style={{ fontSize: 13, color: "var(--ink-muted)" }}>Vehicle</span>
            <span style={{ fontWeight: 600 }}>{driver.vehicles[0]?.plate_number || "—"}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ fontSize: 13, color: "var(--ink-muted)" }}>Status</span>
            <span className={"badge " + (driver.verification_status === "verified" ? "badge-success" : "badge-warning")}>
              {driver.verification_status}
            </span>
          </div>
        </div>
      )}

      <button className="btn btn-ghost btn-block" onClick={handleLogout}>
        Log out
      </button>
    </div>
  );
}
