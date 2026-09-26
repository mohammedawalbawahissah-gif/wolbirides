import { useEffect, useRef, useState } from "react";
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "./PinPicker.css";

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

// Six decimal places is ~11cm of precision — plenty for ride-hailing, and
// it keeps the value within the backend's DecimalField(max_digits=9,
// decimal_places=6). A raw click/geolocation reading carries full
// double-precision noise (15+ significant digits), which blew past that
// limit and made every ride request fail with a 400.
function round6(n: number) {
  return Math.round(n * 1e6) / 1e6;
}

interface GeocodeResult {
  display_name: string;
  lat: string;
  lon: string;
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
  useEffect(() => {
    if (position) map.flyTo([position.lat, position.lng], 16, { duration: 0.6 });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fly only when the picked coordinates change; the map instance is stable
  }, [position?.lat, position?.lng]);
  return null;
}

/**
 * Uses OpenStreetMap tiles via Leaflet rather than Google Maps Platform —
 * WR-05.1 names Google Maps as the default, but that needs an API key
 * decision that hasn't been made yet (PRD Section 12). OSM tiles work
 * immediately with no key, which matters more for getting the MVP running
 * than matching the blueprint's default recommendation exactly. Address
 * search reuses OSM's own free Nominatim geocoder for the same reason.
 */
export default function PinPicker({
  center,
  bounds,
  value,
  onChange,
  label,
}: {
  center: LatLng;
  bounds?: Bounds;
  value: LatLng | null;
  onChange: (pos: LatLng) => void;
  label: string;
}) {
  const [zoom] = useState(15);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const debounceRef = useRef<number | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks-js/set-state-in-effect -- resets loading/error state as the effect starts a fetch or subscription
    if (value?.label) setQuery(value.label);
  }, [value?.label]);

  function handleQueryChange(next: string) {
    setQuery(next);
    setShowResults(true);
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    if (next.trim().length < 3) {
      setResults([]);
      return;
    }
    debounceRef.current = window.setTimeout(() => runSearch(next), 450);
  }

  async function runSearch(text: string) {
    setSearching(true);
    try {
      const params = new URLSearchParams({
        format: "json",
        q: text,
        limit: "5",
        addressdetails: "0",
      });
      if (bounds) {
        params.set("viewbox", `${bounds.min_lng},${bounds.max_lat},${bounds.max_lng},${bounds.min_lat}`);
        params.set("bounded", "1");
      }
      const res = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`);
      const data: GeocodeResult[] = await res.json();
      setResults(data);
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }

  function pickResult(result: GeocodeResult) {
    const picked: LatLng = {
      lat: round6(Number(result.lat)),
      lng: round6(Number(result.lon)),
      label: result.display_name,
    };
    onChange(picked);
    setQuery(result.display_name);
    setResults([]);
    setShowResults(false);
  }

  function handleMapPick(pos: LatLng) {
    onChange(pos);
    setQuery("");
  }

  return (
    <div className="pin-picker">
      <div className="pin-picker-label">{label}</div>

      <div className="pin-picker-search">
        <input
          type="text"
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          onFocus={() => setShowResults(true)}
          placeholder={`Type an address, or tap the map below`}
        />
        {searching && <span className="pin-picker-search-spinner" />}

        {showResults && results.length > 0 && (
          <div className="pin-picker-results">
            {results.map((r, i) => (
              <button key={i} className="pin-picker-result" onClick={() => pickResult(r)}>
                {r.display_name}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="pin-picker-map">
        <MapContainer center={[center.lat, center.lng]} zoom={zoom} style={{ height: "280px", width: "100%" }}>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <ClickCapture onPick={handleMapPick} />
          <FlyTo position={value} />
          {value && <Marker position={[value.lat, value.lng]} icon={icon} />}
        </MapContainer>
      </div>
      <div className="pin-picker-hint">Search an address above, or tap the map to set your {label.toLowerCase()}.</div>
    </div>
  );
}
