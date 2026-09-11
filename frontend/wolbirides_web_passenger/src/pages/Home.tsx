import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type ServiceZone } from "../api/client";
import PinPicker, { type LatLng } from "../components/PinPicker";
import "./Home.css";

function haversineKm(a: LatLng, b: LatLng) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export default function Home() {
  const navigate = useNavigate();
  const [zone, setZone] = useState<ServiceZone | null>(null);
  const [pickup, setPickup] = useState<LatLng | null>(null);
  const [destination, setDestination] = useState<LatLng | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<ServiceZone[]>("/zones").then(({ data }) => {
      if (data.length > 0) setZone(data[0]);
    });
  }, []);

  const distanceKm = pickup && destination ? haversineKm(pickup, destination) : null;
  const fareEstimate =
    zone && distanceKm != null
      ? Number(zone.base_fare) + distanceKm * Number(zone.per_km_rate)
      : null;

  async function requestRide() {
    if (!zone || !pickup || !destination || distanceKm == null) return;
    setRequesting(true);
    setError(null);
    try {
      const { data } = await api.post("/trips", {
        zone_id: zone.id,
        pickup_lat: pickup.lat,
        pickup_lng: pickup.lng,
        pickup_label: "Pickup",
        destination_lat: destination.lat,
        destination_lng: destination.lng,
        destination_label: "Destination",
        distance_km: distanceKm.toFixed(2),
      });
      navigate(`/trip/${data.id}`);
    } catch {
      setError("Couldn't request a ride right now. Try again in a moment.");
    } finally {
      setRequesting(false);
    }
  }

  if (!zone) {
    return (
      <div className="screen">
        <div className="empty-state">No active service zone yet — check back once the pilot zone is live.</div>
      </div>
    );
  }

  const mapCenter: LatLng = {
    lat: (zone.boundary.min_lat + zone.boundary.max_lat) / 2,
    lng: (zone.boundary.min_lng + zone.boundary.max_lng) / 2,
  };

  return (
    <div className="screen">
      <h1 className="screen-title">Where to?</h1>
      <p className="screen-subtitle">{zone.name}</p>

      <PinPicker center={mapCenter} value={pickup} onChange={setPickup} label="Pickup" />
      <PinPicker center={mapCenter} value={destination} onChange={setDestination} label="Destination" />

      {fareEstimate != null && (
        <div className="card fare-card">
          <div>
            <div className="fare-label">Estimated fare</div>
            <div className="fare-value">GH₵{fareEstimate.toFixed(2)}</div>
          </div>
          <div className="fare-distance">{distanceKm!.toFixed(1)} km</div>
        </div>
      )}

      {error && <div className="home-error">{error}</div>}

      <button
        className="btn btn-gold btn-block request-btn"
        disabled={!pickup || !destination || requesting}
        onClick={requestRide}
      >
        {requesting ? "Requesting…" : "Request WolbiRide"}
      </button>
    </div>
  );
}
