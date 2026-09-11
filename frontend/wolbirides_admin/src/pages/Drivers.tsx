import { useEffect, useState } from "react";
import { api, type Driver } from "../api/client";
import { EmptyState, LoadingState, PageHeader, StatusBadge } from "../components/ui";

export default function Drivers() {
  const [drivers, setDrivers] = useState<Driver[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);

  function load() {
    api
      .get<Driver[]>("/admin/drivers/pending")
      .then(({ data }) => setDrivers(data))
      .catch(() => setError("Couldn't load the driver verification queue."));
  }

  useEffect(load, []);

  async function act(driverId: string, action: "verify" | "reject" | "suspend") {
    setActingOn(driverId);
    try {
      await api.patch(`/admin/drivers/${driverId}/verify`, { action });
      load();
    } catch {
      setError(`Couldn't ${action} that driver. Try again.`);
    } finally {
      setActingOn(null);
    }
  }

  return (
    <div>
      <PageHeader
        title="Driver verification"
        subtitle="Founding drivers awaiting the WR-07.2 compliance check before they can go online."
      />

      {error && <EmptyState message={error} />}
      {!drivers && !error && <LoadingState />}

      {drivers && drivers.length === 0 && (
        <EmptyState message="No drivers waiting on review right now." />
      )}

      {drivers && drivers.length > 0 && (
        <div className="panel">
          <table className="data-table">
            <thead>
              <tr>
                <th>Driver</th>
                <th>Licence</th>
                <th>Vehicle</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {drivers.map((driver) => (
                <tr key={driver.id}>
                  <td>
                    <div>{driver.user?.name || "Unnamed"}</div>
                    <div className="mono">{driver.user?.phone}</div>
                  </td>
                  <td>
                    <div className="mono">{driver.licence_number}</div>
                    {driver.licence_expiry && (
                      <div className="mono">expires {driver.licence_expiry}</div>
                    )}
                  </td>
                  <td>
                    {driver.vehicles.length > 0
                      ? driver.vehicles.map((v) => v.plate_number).join(", ")
                      : "No vehicle on file"}
                  </td>
                  <td>
                    <StatusBadge status={driver.verification_status} />
                  </td>
                  <td>
                    <div className="btn-row">
                      <button
                        className="btn btn-success"
                        disabled={actingOn === driver.id}
                        onClick={() => act(driver.id, "verify")}
                      >
                        Verify
                      </button>
                      <button
                        className="btn btn-ghost"
                        disabled={actingOn === driver.id}
                        onClick={() => act(driver.id, "reject")}
                      >
                        Reject
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
