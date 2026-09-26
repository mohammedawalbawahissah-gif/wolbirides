import { useEffect, useState, type FormEvent } from "react";
import { api, type ServiceZone } from "../api/client";
import { EmptyState, LoadingState, PageHeader } from "../components/ui";

interface Placement {
  id: string; zone: string | null; title: string; description: string; image_url: string; link_url: string;
  sponsor_name: string; active_from: string; active_to: string; price_paid: string;
}

const empty = { zone: "", title: "", description: "", image_url: "", link_url: "", sponsor_name: "",
  active_from: "", active_to: "", price_paid: "" };

/**
 * WR-24: sponsored placements, sold directly to local businesses and set up here.
 * Every rider in a zone sees the same ones, always labelled "Sponsored". There is
 * no targeting, by design: if a placement ever needed rider data, don't build it.
 */
export default function Placements() {
  const [items, setItems] = useState<Placement[] | null>(null);
  const [zones, setZones] = useState<ServiceZone[]>([]);
  const [form, setForm] = useState(empty);
  const [error, setError] = useState<string | null>(null);
  // Read the clock once per page load (for the "Live" badge), not on every render.
  const [now] = useState(() => Date.now());

  function load() {
    api.get<Placement[]>("/admin/placements").then(({ data }) => setItems(data)).catch(() => setError("Couldn't load placements."));
  }
  useEffect(() => {
    load();
    api.get<ServiceZone[]>("/admin/zones").then(({ data }) => setZones(data));
  }, []);

  async function create(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post("/admin/placements", {
        ...form, zone: form.zone || null, price_paid: form.price_paid || "0",
        active_from: new Date(form.active_from).toISOString(), active_to: new Date(form.active_to).toISOString(),
      });
      setForm(empty);
      load();
    } catch (err: any) {
      const d = err?.response?.data;
      setError(d ? Object.entries(d).map(([k, v]) => `${k}: ${v}`).join("; ") : "Couldn't save that placement.");
    }
  }

  async function remove(p: Placement) {
    if (!window.confirm(`Remove "${p.title}"?`)) return;
    await api.delete(`/admin/placements/${p.id}`);
    load();
  }

  return (
    <div>
      <PageHeader title="Sponsored placements"
        subtitle="Shown the same to every rider in a zone, always labelled Sponsored. No personal targeting, ever." />
      <form className="panel" onSubmit={create} style={{ padding: 20, marginBottom: 20 }}>
        <div className="zone-form-grid">
          <label>Sponsor name<input required value={form.sponsor_name} onChange={(e) => setForm({ ...form, sponsor_name: e.target.value })} /></label>
          <label>Title<input required maxLength={100} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
          <label>Description<input maxLength={240} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
          <label>Zone
            <select value={form.zone} onChange={(e) => setForm({ ...form, zone: e.target.value })}>
              <option value="">Every zone</option>
              {zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
            </select>
          </label>
          <label>Image URL<input type="url" value={form.image_url} onChange={(e) => setForm({ ...form, image_url: e.target.value })} /></label>
          <label>Link URL<input type="url" value={form.link_url} onChange={(e) => setForm({ ...form, link_url: e.target.value })} /></label>
          <label>Runs from<input required type="datetime-local" value={form.active_from} onChange={(e) => setForm({ ...form, active_from: e.target.value })} /></label>
          <label>Runs until<input required type="datetime-local" value={form.active_to} onChange={(e) => setForm({ ...form, active_to: e.target.value })} /></label>
          <label>Price paid GH₵<input inputMode="decimal" value={form.price_paid} onChange={(e) => setForm({ ...form, price_paid: e.target.value })} /></label>
        </div>
        {error && <div className="zone-form-error">{error}</div>}
        <button className="btn btn-primary" type="submit" style={{ marginTop: 12 }}>Add placement</button>
      </form>

      {!items && !error && <LoadingState />}
      {items && items.length === 0 && <EmptyState message="No placements yet." />}
      {items && items.length > 0 && (
        <div className="panel">
          <table className="data-table">
            <thead><tr><th>Sponsor</th><th>Title</th><th>Zone</th><th>Runs</th><th>Paid</th><th></th></tr></thead>
            <tbody>
              {items.map((p) => {
                const live = new Date(p.active_from).getTime() <= now && now <= new Date(p.active_to).getTime();
                return (
                  <tr key={p.id}>
                    <td>{p.sponsor_name}</td>
                    <td>{p.title}{live && <span className="badge badge-success" style={{ marginLeft: 6 }}>Live</span>}</td>
                    <td>{zones.find((z) => z.id === p.zone)?.name ?? "Every zone"}</td>
                    <td>{new Date(p.active_from).toLocaleDateString()} to {new Date(p.active_to).toLocaleDateString()}</td>
                    <td>GH₵{p.price_paid}</td>
                    <td><button className="btn btn-ghost" onClick={() => remove(p)}>Remove</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
