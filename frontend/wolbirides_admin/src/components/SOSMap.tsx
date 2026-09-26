import { MapContainer, CircleMarker, Popup, TileLayer } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import type { Incident } from "../api/client";

/** WR-18: where open SOS alerts came from, so ops can direct help without leaving the dashboard. */
export default function SOSMap({ incidents }: { incidents: Incident[] }) {
  const points = incidents.filter((i) => i.location_lat && i.location_lng);
  if (points.length === 0) return null;
  const center: [number, number] = [Number(points[0].location_lat), Number(points[0].location_lng)];

  return (
    <div className="sos-map">
      <MapContainer center={center} zoom={15} style={{ height: 280, width: "100%" }} scrollWheelZoom={false}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {points.map((i) => (
          <CircleMarker
            key={i.id}
            center={[Number(i.location_lat), Number(i.location_lng)]}
            radius={11}
            pathOptions={{ color: "#B23A2F", fillColor: "#B23A2F", fillOpacity: 0.6, weight: 3 }}
          >
            <Popup>
              <strong>SOS</strong> {new Date(i.created_at).toLocaleTimeString()}
              <br />
              {i.description}
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  );
}
