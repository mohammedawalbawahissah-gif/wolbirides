import { useAuth } from "../auth/AuthContext";
import { useDriverContext } from "../components/DriverGate";
import FileDrop from "../components/FileDrop";
import { useToast } from "../components/Toast";

export default function Profile() {
  const { user, updateProfilePhoto } = useAuth();
  const { driver } = useDriverContext();
  const toast = useToast();

  async function handlePhotoChange(url: string | null) {
    if (!url) return;
    try {
      await updateProfilePhoto(url);
      toast.show("Profile photo updated.", "success");
    } catch {
      toast.show("Couldn't save your photo — try again.", "error");
    }
  }

  return (
    <div>
      <div className="page-heading">
        <h1>Profile</h1>
        <p>{user?.email || user?.phone}</p>
      </div>

      <div className="card" style={{ maxWidth: 420 }}>
        <FileDrop
          kind="profile_photo"
          label="Profile photo"
          hint="Riders see this when you're matched — a clear headshot builds trust."
          value={user?.profile_photo || null}
          onChange={handlePhotoChange}
        />

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
