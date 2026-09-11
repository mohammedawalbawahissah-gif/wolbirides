import { useAuth } from "../auth/AuthContext";
import { useDriverContext } from "../components/DriverGate";

export default function Profile() {
  const { user } = useAuth();
  const { driver } = useDriverContext();

  return (
    <div>
      <div className="page-heading">
        <h1>Profile</h1>
        <p>{user?.phone}</p>
      </div>

      <div className="card" style={{ maxWidth: 420 }}>
        <div className="kv-row">
          <span>Licence</span>
          <strong style={{ fontFamily: "monospace" }}>{driver.licence_number}</strong>
        </div>
        <div className="kv-row">
          <span>Vehicle</span>
          <strong>{driver.vehicles[0]?.plate_number || "—"}</strong>
        </div>
        <div className="kv-row">
          <span>Status</span>
          <span className={"badge " + (driver.verification_status === "verified" ? "badge-success" : "badge-warning")}>
            {driver.verification_status}
          </span>
        </div>
      </div>
    </div>
  );
}
