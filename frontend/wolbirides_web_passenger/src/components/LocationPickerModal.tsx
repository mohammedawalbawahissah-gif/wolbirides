import { useEffect, useRef, useState } from "react";
import { MapContainer, Marker, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import { api } from "../api/client";
import BaseMap from "./BaseMap";
import { PINNED_LABEL, reverseGeocode, shortLabel } from "../geocode";
import "./LocationPickerModal.css";

// Default Leaflet marker icons reference image files by relative URL, which
// breaks under Vite's bundling — point them at a CDN instead of shipping
// asset-path config.
const icon = new L.Icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

export interface LatLng {
  lat: number;
  lng: number;
  label?: string;
}

export interface Bounds {
  min_lat: number;
  max_lat: number;
  min_lng: number;
  max_lng: number;
}

// Six decimal places is ~11cm of precision — plenty for ride-hailing, and it
// keeps the value within the backend's DecimalField(max_digits=9, decimal_places=6).
function round6(n: number) {
  return Math.round(n * 1e6) / 1e6;
}

/** One answer from GET /api/places/search. `place` and `pickup` are spots WolbiRides knows; `map` came from the outside map service. */
interface PlaceResult {
  id: string;
  name: string;
  label: string;
  lat: number;
  lng: number;
  source: "place" | "pickup" | "map";
}



function ClickCapture({ onPick }: { onPick: (pos: LatLng) => void }) {
  useMapEvents({
    click(e) {
      onPick({ lat: round6(e.latlng.lat), lng: round6(e.latlng.lng) });
    },
  });
  return null;
}

function FlyTo({ position }: { position: LatLng | null }) {
  const map = useMap();
  const positionKey = position ? `${position.lat},${position.lng}` : "";
  useEffect(() => {
    if (position) map.flyTo([position.lat, position.lng], 16, { duration: 0.6 });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on positionKey, the value of `position`
  }, [positionKey, map]);
  return null;
}

/**
 * Leaflet measures its container's size once, when the map is created. This
 * modal's map only exists while it's open, and its container's real height
 * comes from a flex layout that isn't necessarily settled on that very first
 * paint — when that happens Leaflet locks in a 0px (or too-small) size and
 * every tile after that renders blank. Forcing invalidateSize() a beat after
 * mount, and again on any later resize, makes it pick up the real size.
 */
function FixSize() {
  const map = useMap();
  useEffect(() => {
    const raf = requestAnimationFrame(() => map.invalidateSize());
    const timeout = window.setTimeout(() => map.invalidateSize(), 250);
    const onResize = () => map.invalidateSize();
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(timeout);
      window.removeEventListener("resize", onResize);
    };
  }, [map]);
  return null;
}

/**
 * Full-screen location picker: search by name (e.g. "Citadel Hostel") with an
 * explicit Search button, pick a result, or fine-tune by tapping the map.
 * Opened from a "Pickup"/"Destination" button rather than living inline on
 * the page, so the booking screen stays short until a location is actually
 * being chosen.
 *
 * Shows an OpenFreeMap vector map via Leaflet (BaseMap.tsx). Search results as you type come from the WolbiRides
 * backend (/places/search): places ops have added first, then an outside map service.
 */
export default function LocationPickerModal({
  title, center, zoneId, value, onConfirm, onClose,
}: {
  title: string;
  center: LatLng;
  zoneId?: string; // the service area to search in; the backend knows its boundary
  value: LatLng | null;
  onConfirm: (pos: LatLng) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState(value?.label && value.label !== PINNED_LABEL ? value.label : "");
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [draft, setDraft] = useState<LatLng | null>(value);
  const [resolving, setResolving] = useState(false);
  const lookupId = useRef(0);
  const searchId = useRef(0);
  const skipNextSearch = useRef(false); // the box was filled by picking a result or tapping the map, not by typing
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  async function runSearch() {
    const text = query.trim();
    if (text.length < 2) return;
    const id = ++searchId.current;
    setSearching(true);
    try {
      const params: Record<string, string | number> = { q: text, lat: center.lat, lng: center.lng };
      if (zoneId) params.zone = zoneId;
      const { data } = await api.get<{ results: PlaceResult[] }>("/places/search", { params });
      if (id !== searchId.current) return; // a newer search has started; this answer is out of date
      setResults(data.results ?? []);
    } catch {
      if (id !== searchId.current) return;
      setResults([]);
    } finally {
      if (id === searchId.current) {
        setSearching(false);
        setSearched(true);
      }
    }
  }

  // Search as the passenger types: wait for a short pause so a fast typist sends one request, not ten.
  useEffect(() => {
    if (skipNextSearch.current) { skipNextSearch.current = false; return; }
    const text = query.trim();
    if (text.length < 2) { searchId.current++; setResults([]); setSearching(false); setSearched(false); return; }
    const timer = setTimeout(runSearch, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  function pickResult(result: PlaceResult) {
    lookupId.current++; // a search result already has its name; drop any lookup still in flight
    searchId.current++;
    setResolving(false);
    const label = result.source === "map" ? shortLabel(result.label) : result.name;
    const picked: LatLng = { lat: round6(result.lat), lng: round6(result.lng), label };
    setDraft(picked);
    skipNextSearch.current = true;
    setQuery(result.name);
    setResults([]);
    setSearched(false);
  }

  async function handleMapPick(pos: LatLng) {
    const id = ++lookupId.current;
    setDraft(pos);
    setResults([]);
    searchId.current++;
    skipNextSearch.current = query !== "";
    setQuery("");
    setResolving(true);
    const name = await reverseGeocode(pos.lat, pos.lng);
    if (id !== lookupId.current) return; // the passenger tapped somewhere else meanwhile
    setResolving(false);
    const label = name ? shortLabel(name) : PINNED_LABEL;
    setDraft({ ...pos, label });
    skipNextSearch.current = (name ?? "") !== query;
    setQuery(name ?? "");
  }

  return (
    <div className="location-modal-overlay" role="dialog" aria-modal="true" aria-label={title}>
      <div className="location-modal">
        <div className="location-modal-header">
          <h2>{title}</h2>
          <button className="location-modal-close" onClick={onClose} aria-label="Cancel">✕</button>
        </div>

        <form className="location-modal-search" onSubmit={(e) => { e.preventDefault(); runSearch(); }}>
          <input ref={inputRef} type="text" value={query} placeholder="Search a place, e.g. Citadel Hostel"
            autoComplete="off" onChange={(e) => { setQuery(e.target.value); setSearched(false); }} />
          <button type="submit" className="btn btn-gold" disabled={searching || query.trim().length < 2}>
            {searching ? "Searching…" : "Search"}
          </button>
        </form>

        {results.length > 0 && (
          <div className="location-modal-results">
            {results.map((r, i) => (
              <button key={r.id + i} className="location-modal-result" onClick={() => pickResult(r)}>
                <span className="location-modal-result-name">{r.name}</span>
                {r.label && r.label !== r.name && (
                  <span className="location-modal-result-sub">{r.label.startsWith(r.name) ? r.label.slice(r.name.length).replace(/^,\s*/, "") : r.label}</span>
                )}
              </button>
            ))}
          </div>
        )}
        {searched && !searching && results.length === 0 && (
          <p className="location-modal-empty">No matches. Try a different name, or tap the map below.</p>
        )}

        <div className="location-modal-map">
          <MapContainer center={[center.lat, center.lng]} zoom={15} style={{ height: "100%", width: "100%" }}>
            <BaseMap />
            <ClickCapture onPick={handleMapPick} />
            <FlyTo position={draft} />
            <FixSize />
            {draft && <Marker position={[draft.lat, draft.lng]} icon={icon} />}
          </MapContainer>
        </div>

        <div className="location-modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-gold" disabled={!draft || resolving}
            onClick={() => draft && onConfirm({ ...draft, label: draft.label || PINNED_LABEL })}>
            {resolving ? "Finding place name…" : "Use this location"}
          </button>
        </div>
      </div>
    </div>
  );
}
