import { useEffect, useState, type FormEvent } from "react";
import { api, type ServiceZone } from "../api/client";
import { EmptyState, LoadingState, PageHeader, StatusBadge } from "../components/ui";

const emptyForm = {
  name: "",
  base_fare: "",
  per_km_rate: "",
  min_lat: "",
  max_lat: "",
  min_lng: "",
  max_lng: "",
};

export default function Zones() {
  const [zones, setZones] = useState<ServiceZone[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  function load() {
    api
      .get<ServiceZone[]>("/admin/zones")
      .then(({ data }) => setZones(data))
      .catch(() => setError("Couldn't load service zones."));
  }

  useEffect(load, []);

  function updateField(key: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSaving(true);
    try {
      await api.post("/admin/zones", {
        name: form.name,
        base_fare: form.base_fare,
        per_km_rate: form.per_km_rate,
        active: true,
        boundary: {
          min_lat: Number(form.min_lat),
          max_lat: Number(form.max_lat),
          min_lng: Number(form.min_lng),
          max_lng: Number(form.max_lng),
        },
      });
      setForm(emptyForm);
      setShowForm(false);
      load();
    } catch (err: any) {
      setFormError(err?.response?.data?.name?.[0] || "Couldn't create the zone — check the values and try again.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(zone: ServiceZone) {
    setZones((prev) => prev?.map((z) => (z.id === zone.id ? { ...z, active: !z.active } : z)) ?? prev);
    api.patch(`/admin/zones/${zone.id}`, { active: !zone.active }).catch(() => load());
  }

  async function deleteZone(zone: ServiceZone) {
    if (!confirm(`Delete "${zone.name}"? This can't be undone.`)) return;
    setZones((prev) => prev?.filter((z) => z.id !== zone.id) ?? prev);
    api.delete(`/admin/zones/${zone.id}`).catch(() => load());
  }

  return (
    <div>
      <PageHeader
        title="Service zones"
        subtitle="Fare configuration and pickup points per zone."
      />

      <div className="btn-row" style={{ marginBottom: 16 }}>
        <button className="btn btn-primary" onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Cancel" : "+ New zone"}
        </button>
      </div>

      {showForm && (
        <form className="panel" onSubmit={handleCreate} style={{ padding: 20, marginBottom: 20 }}>
          <div className="zone-form-grid">
            <label>
              Zone name
              <input required value={form.name} onChange={(e) => updateField("name", e.target.value)} />
            </label>
            <label>
              Base fare (GH₵)
              <input required type="number" step="0.01" value={form.base_fare} onChange={(e) => updateField("base_fare", e.target.value)} />
            </label>
            <label>
              Per-km rate (GH₵)
              <input required type="number" step="0.01" value={form.per_km_rate} onChange={(e) => updateField("per_km_rate", e.target.value)} />
            </label>
            <label>
              Min latitude
              <input required type="number" step="0.000001" value={form.min_lat} onChange={(e) => updateField("min_lat", e.target.value)} />
            </label>
            <label>
              Max latitude
              <input required type="number" step="0.000001" value={form.max_lat} onChange={(e) => updateField("max_lat", e.target.value)} />
            </label>
            <label>
              Min longitude
              <input required type="number" step="0.000001" value={form.min_lng} onChange={(e) => updateField("min_lng", e.target.value)} />
            </label>
            <label>
              Max longitude
              <input required type="number" step="0.000001" value={form.max_lng} onChange={(e) => updateField("max_lng", e.target.value)} />
            </label>
          </div>
          {formError && <div className="zone-form-error">{formError}</div>}
          <button className="btn btn-primary" type="submit" disabled={saving} style={{ marginTop: 12 }}>
            {saving ? "Creating…" : "Create zone"}
          </button>
        </form>
      )}

      {error && <EmptyState message={error} />}
      {!zones && !error && <LoadingState />}
      {zones && zones.length === 0 && <EmptyState message="No service zones configured yet." />}

      {zones?.map((zone) => (
        <div className="panel" key={zone.id}>
          <div className="panel-header">
            <h2>{zone.name}</h2>
            <div className="btn-row">
              <StatusBadge status={zone.active ? "active" : "suspended"} />
              <button className="btn btn-ghost" onClick={() => toggleActive(zone)}>
                {zone.active ? "Deactivate" : "Activate"}
              </button>
              <button className="btn btn-danger" onClick={() => deleteZone(zone)}>
                Delete
              </button>
            </div>
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
