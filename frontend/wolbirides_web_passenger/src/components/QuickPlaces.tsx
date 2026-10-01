import { useEffect, useState } from "react";
import { api, type SavedAddress, type ServiceZone } from "../api/client";
import "./QuickPlaces.css";

export interface PickedPlace {
  lat: number;
  lng: number;
  label: string;
  savedAddressId?: string;
}

/**
 * One-tap pickup/destination shortcuts: campus pickup points (sponsored ones
 * labelled, WR-24) and the passenger's saved places. A dropdown rather than a row
 * of chips, so it stays usable as the list grows — a chip row scrolls
 * sideways and gets cumbersome past a handful of entries; a dropdown doesn't.
 * Choosing a saved place sends its id with the request, which is what feeds
 * "Book my usual" (WR-13).
 */
export default function QuickPlaces({ zone, onPick }: {
  zone: ServiceZone;
  onPick: (which: "pickup" | "destination", place: PickedPlace) => void;
}) {
  const [saved, setSaved] = useState<SavedAddress[]>([]);

  useEffect(() => {
    api.get<SavedAddress[]>("/passengers/me/addresses").then(({ data }) => setSaved(data)).catch(() => {});
  }, []);

  const points = zone.pickup_points ?? [];
  if (points.length === 0 && saved.length === 0) return null;

  function pick(which: "pickup" | "destination", key: string) {
    if (!key) return;
    const [type, id] = key.split(":");
    if (type === "point") {
      const p = points.find((p) => p.id === id);
      if (p) onPick(which, { lat: Number(p.latitude), lng: Number(p.longitude), label: p.name });
    } else {
      const a = saved.find((a) => a.id === id);
      if (a) onPick(which, { lat: Number(a.lat), lng: Number(a.lng), label: a.label, savedAddressId: a.id });
    }
  }

  return (
    <div className="qp">
      <div className="qp-row">
        <label className="qp-label" htmlFor="qp-pickup">Pick up at</label>
        {/* Always shows the placeholder — the chosen pickup is displayed by the button below this,
            not by the dropdown itself — so picking again from the same list works every time. */}
        <select id="qp-pickup" className="field-input qp-select" value=""
          onChange={(e) => pick("pickup", e.target.value)}>
          <option value="" disabled>Choose a place…</option>
          {points.map((p) => (
            <option key={`point:${p.id}`} value={`point:${p.id}`}>
              {p.name}{p.sponsor_name ? ` — Sponsored by ${p.sponsor_name}` : ""}
            </option>
          ))}
          {saved.map((a) => (
            <option key={`saved:${a.id}`} value={`saved:${a.id}`}>{a.label}</option>
          ))}
        </select>
      </div>
      {saved.length > 0 && (
        <div className="qp-row">
          <label className="qp-label" htmlFor="qp-destination">Going to</label>
          <select id="qp-destination" className="field-input qp-select" value=""
            onChange={(e) => pick("destination", e.target.value)}>
            <option value="" disabled>Choose a place…</option>
            {saved.map((a) => (
              <option key={`saved:${a.id}`} value={`saved:${a.id}`}>{a.label}</option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
