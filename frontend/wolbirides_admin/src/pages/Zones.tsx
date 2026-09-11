import { useEffect, useState } from "react";
import { api, type ServiceZone } from "../api/client";
import { EmptyState, LoadingState, PageHeader, StatusBadge } from "../components/ui";

export default function Zones() {
  const [zones, setZones] = useState<ServiceZone[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<ServiceZone[]>("/admin/zones")
      .then(({ data }) => setZones(data))
      .catch(() => setError("Couldn't load service zones."));
  }, []);

  return (
    <div>
      <PageHeader
        title="Service zones"
        subtitle="Fare configuration and pickup points per zone. Add new zones from Django admin until this gets a dedicated form."
      />

      {error && <EmptyState message={error} />}
      {!zones && !error && <LoadingState />}
      {zones && zones.length === 0 && <EmptyState message="No service zones configured yet." />}

      {zones?.map((zone) => (
        <div className="panel" key={zone.id}>
          <div className="panel-header">
            <h2>{zone.name}</h2>
            <StatusBadge status={zone.active ? "active" : "suspended"} />
          </div>
          <table className="data-table">
            <tbody>
              <tr>
                <th style={{ width: 180 }}>Base fare</th>
                <td>GH₵{zone.base_fare}</td>
              </tr>
              <tr>
                <th>Per-km rate</th>
                <td>GH₵{zone.per_km_rate} / km</td>
              </tr>
              <tr>
                <th>Pickup points</th>
                <td>
                  {zone.pickup_points.length > 0
                    ? zone.pickup_points.map((p) => p.name).join(", ")
                    : "None added yet"}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
