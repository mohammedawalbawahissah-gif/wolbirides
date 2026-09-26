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
 * One-tap pickup/destination choices: campus pickup points (sponsored ones are
 * labelled, WR-24) and the rider's saved places. Choosing a saved place sends its
 * id with the request, which is what feeds "Book my usual" (WR-13).
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

  const savedChip = (which: "pickup" | "destination", a: SavedAddress) => (
    <button key={`${which}-${a.id}`} className="qp-chip" type="button"
      onClick={() => onPick(which, { lat: Number(a.lat), lng: Number(a.lng), label: a.label, savedAddressId: a.id })}>
      {a.label}
    </button>
  );

  return (
    <div className="qp">
      <div className="qp-row">
        <span className="qp-label">Pick up at</span>
        <div className="qp-chips">
          {points.map((p) => (
            <button key={p.id} className="qp-chip" type="button"
              onClick={() => onPick("pickup", { lat: Number(p.latitude), lng: Number(p.longitude), label: p.name })}>
              {p.name}
              {p.sponsor_name && <span className="qp-sponsor">Sponsored by {p.sponsor_name}</span>}
            </button>
          ))}
          {saved.map((a) => savedChip("pickup", a))}
        </div>
      </div>
      {saved.length > 0 && (
        <div className="qp-row">
          <span className="qp-label">Going to</span>
          <div className="qp-chips">{saved.map((a) => savedChip("destination", a))}</div>
        </div>
      )}
    </div>
  );
}
