import { useState } from "react";
import { MapContainer, Marker, TileLayer, useMapEvents } from "react-leaflet";
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
}

function ClickCapture({ onPick }: { onPick: (pos: LatLng) => void }) {
  useMapEvents({
    click(e) {
      onPick({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
  });
  return null;
}

/**
 * Uses OpenStreetMap tiles via Leaflet rather than Google Maps Platform —
 * WR-05.1 names Google Maps as the default, but that needs an API key
 * decision that hasn't been made yet (PRD Section 12). OSM tiles work
 * immediately with no key, which matters more for getting the MVP running
 * than matching the blueprint's default recommendation exactly.
 */
export default function PinPicker({
  center,
  value,
  onChange,
  label,
}: {
  center: LatLng;
  value: LatLng | null;
  onChange: (pos: LatLng) => void;
  label: string;
}) {
  const [zoom] = useState(15);

  return (
    <div className="pin-picker">
      <div className="pin-picker-label">{label}</div>
      <div className="pin-picker-map">
        <MapContainer center={[center.lat, center.lng]} zoom={zoom} style={{ height: "280px", width: "100%" }}>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <ClickCapture onPick={onChange} />
          {value && <Marker position={[value.lat, value.lng]} icon={icon} />}
        </MapContainer>
      </div>
      <div className="pin-picker-hint">Tap the map to set your {label.toLowerCase()}.</div>
    </div>
  );
}
