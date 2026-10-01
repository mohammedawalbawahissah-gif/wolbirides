import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import axios from "axios";
import TripMap from "../components/TripMap";
import "./SharedTrip.css";

// Dev: talk to Django directly. Production builds (e.g. Docker) default to the
// same origin, where nginx proxies /api and /ws to the backend.
const BASE_URL = import.meta.env.VITE_API_BASE_URL || (import.meta.env.DEV ? "http://localhost:8001/api" : "/api");

interface SharedTripData {
  status: string;
  passenger_first_name: string;
  pickup_label: string;
  destination_label: string;
  destination_lat: string;
  destination_lng: string;
  driver: { first_name: string; photo: string; plate_number: string; vehicle_type: string } | null;
  driver_location: { lat: number; lng: number } | null;
  eta_minutes: number | null;
}

const STATUS_TEXT: Record<string, string> = {
  requested: "is booking a ride",
  matching: "is waiting for a rider",
  awaiting_assignment: "is having a courier arranged",
  matched: "is waiting for their rider",
  driver_arriving: "'s rider is arriving",
  in_progress: "is on the way",
  completed: "has arrived",
  cancelled: "'s trip was cancelled",
  no_drivers_found: "couldn't find a rider",
};

/** WR-18: public, no-login page for someone following a shared trip. */
export default function SharedTrip() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<SharedTripData | null>(null);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    let stopped = false;
    function load() {
      // Plain axios, not the app client: this page must never send or need a login.
      axios.get<SharedTripData>(`${BASE_URL}/share/${token}`)
        .then(({ data }) => !stopped && setData(data))
        .catch(() => !stopped && setGone(true));
    }
    load();
    const id = window.setInterval(load, 10000);
    return () => { stopped = true; window.clearInterval(id); };
  }, [token]);

  if (gone) {
    return (
      <main className="shared-trip">
        <h1>This link has ended</h1>
        <p>The trip finished or sharing was turned off.</p>
      </main>
    );
  }
  if (!data) return <main className="shared-trip"><p>Loading trip…</p></main>;

  const verb = STATUS_TEXT[data.status] ?? "is on a WolbiRides trip";
  const destination = { lat: Number(data.destination_lat), lng: Number(data.destination_lng) };

  return (
    <main className="shared-trip">
      <h1>{data.passenger_first_name}{verb.startsWith("'") ? verb : ` ${verb}`}</h1>
      <p className="shared-trip-route">{data.pickup_label || "Pickup"} to {data.destination_label || "destination"}</p>
      {data.eta_minutes != null && (
        <p className="shared-trip-eta">
          {data.status === "in_progress" ? "Arriving" : "Rider at pickup"} in about {data.eta_minutes} min
        </p>
      )}

      {data.driver && (
        <div className="shared-trip-driver">
          {data.driver.photo && <img src={data.driver.photo} alt="" />}
          <div>
            <strong>{data.driver.first_name}</strong>
            <div>{data.driver.vehicle_type} {data.driver.plate_number && `· ${data.driver.plate_number}`}</div>
          </div>
        </div>
      )}

      <TripMap pickup={destination} destination={destination} driver={data.driver_location} />
      <p className="shared-trip-note">In an emergency, call 112.</p>
    </main>
  );
}
