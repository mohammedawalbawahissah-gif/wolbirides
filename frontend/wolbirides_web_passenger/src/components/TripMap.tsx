import { MapContainer, Marker, Polyline, useMap } from "react-leaflet";
import { useEffect } from "react";
import L from "leaflet";
import BaseMap from "./BaseMap";
import "./TripMap.css";

const pickupIcon = new L.DivIcon({
  className: "trip-map-pin trip-map-pin-pickup",
  html: '<span></span>',
  iconSize: [16, 16],
});
const destIcon = new L.DivIcon({
  className: "trip-map-pin trip-map-pin-dest",
  html: '<span></span>',
  iconSize: [16, 16],
});
const driverIcon = new L.DivIcon({
  className: "trip-map-pin trip-map-pin-driver",
  html: '<span>🛺</span>',
  iconSize: [30, 30],
});

interface Point { lat: number; lng: number }

function FitBounds({ points }: { points: Point[] }) {
  const map = useMap();
  // Re-fit when the actual coordinates change (a new driver position), not on every re-render.
  const pointsKey = JSON.stringify(points);
  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1) {
      map.setView([points[0].lat, points[0].lng], 15);
    } else {
      map.fitBounds(points.map((p) => [p.lat, p.lng] as [number, number]), { padding: [32, 32] });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on pointsKey, the value of `points`
  }, [pointsKey, map]);
  return null;
}

export default function TripMap({
  pickup,
  destination,
  driver,
}: {
  pickup: Point;
  destination: Point;
  driver?: Point | null;
}) {
  const points = [pickup, destination, ...(driver ? [driver] : [])];

  return (
    <div className="trip-map">
      <MapContainer center={[pickup.lat, pickup.lng]} zoom={15} style={{ height: "220px", width: "100%" }} zoomControl={false}>
        <BaseMap />
        <Polyline positions={[[pickup.lat, pickup.lng], [destination.lat, destination.lng]]} pathOptions={{ color: "#B8860B", weight: 3, dashArray: "6 8" }} />
        <Marker position={[pickup.lat, pickup.lng]} icon={pickupIcon} />
        <Marker position={[destination.lat, destination.lng]} icon={destIcon} />
        {driver && <Marker position={[driver.lat, driver.lng]} icon={driverIcon} />}
        <FitBounds points={points} />
      </MapContainer>
    </div>
  );
}
