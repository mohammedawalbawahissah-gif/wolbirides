import type { TripDriverBrief } from "../api/client";
import "./DriverCard.css";

const VEHICLE_LABEL: Record<string, string> = {
  yellow_yellow: "Yellow-Yellow",
};

export default function DriverCard({ driver, eta }: { driver: TripDriverBrief; eta?: string }) {
  const initials = driver.name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="driver-card">
      <div className="driver-card-photo">
        {driver.profile_photo || driver.vehicle?.photo ? (
          <img src={driver.profile_photo || driver.vehicle?.photo} alt="" />
        ) : (
          <span className="driver-card-initials">{initials || "WR"}</span>
        )}
        {driver.verification_status === "verified" && (
          <span className="driver-card-verified" title="Verified driver">✓</span>
        )}
      </div>

      <div className="driver-card-body">
        <div className="driver-card-name-row">
          <span className="driver-card-name">{driver.name || "Your driver"}</span>
          <span className="driver-card-rating">★ {Number(driver.rating).toFixed(1)}</span>
        </div>
        <div className="driver-card-vehicle">
          {driver.vehicle
            ? `${VEHICLE_LABEL[driver.vehicle.vehicle_type] || driver.vehicle.vehicle_type} · ${driver.vehicle.plate_number}`
            : "Vehicle details pending"}
        </div>
        {eta && <div className="driver-card-eta">{eta}</div>}
      </div>

      {driver.phone && (
        <a className="driver-card-call" href={`tel:${driver.phone}`} aria-label="Call driver">
          ☎
        </a>
      )}
    </div>
  );
}
