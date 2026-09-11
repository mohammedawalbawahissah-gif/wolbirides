import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type ServiceZone } from "../api/client";
import { useDriverContext } from "../components/DriverGate";
import { useDriverDispatch } from "../hooks/useDriverDispatch";
import OfferModal from "../components/OfferModal";
import "./Home.css";

export default function Home() {
  const { driver, setDriver } = useDriverContext();
  const navigate = useNavigate();
  const [zone, setZone] = useState<ServiceZone | null>(null);
  const [toggling, setToggling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<ServiceZone[]>("/zones").then(({ data }) => {
      if (data.length > 0) setZone(data[0]);
    });
  }, []);

  // Check for a trip already in progress (e.g. after a page refresh mid-trip)
  useEffect(() => {
    api.get("/drivers/me/active-trip").then(({ data }) => {
      if (data) navigate(`/active-trip/${data.id}`);
    });
  }, [navigate]);

  const { connected, offer, locationError, clearOffer } = useDriverDispatch(
    zone?.id ?? driver.current_zone,
    driver.is_online
  );

  async function toggleOnline() {
    if (!zone) return;
    setToggling(true);
    setError(null);
    try {
      const { data } = await api.patch("/drivers/me/status", {
        is_online: !driver.is_online,
        zone_id: zone.id,
      });
      setDriver(data);
    } catch (err: any) {
      setError(err?.response?.data?.detail || "Couldn't update your status.");
    } finally {
      setToggling(false);
    }
  }

  async function acceptOffer(tripId: string) {
    try {
      await api.post(`/trips/${tripId}/accept`);
      clearOffer();
      navigate(`/active-trip/${tripId}`);
    } catch {
      // Someone else likely got there first, or the offer expired — the
      // cascade has already moved to the next driver server-side.
      clearOffer();
    }
  }

  async function declineOffer(tripId: string) {
    try {
      await api.post(`/trips/${tripId}/decline`);
    } finally {
      clearOffer();
    }
  }

  if (driver.verification_status !== "verified") {
    return (
      <div className="screen">
        <div className="empty-state">
          Your account isn't verified yet — you can't go online until ops approves your
          application.
        </div>
      </div>
    );
  }

  return (
    <div className="screen">
      <h1 className="screen-title">{driver.is_online ? "You're online" : "You're offline"}</h1>
      <p className="screen-subtitle">{zone ? zone.name : "Loading zone…"}</p>

      <div className={"card status-card " + (driver.is_online ? "status-card-online" : "")}>
        <div>
          <div className="status-label">{driver.is_online ? "Receiving ride requests" : "Not receiving requests"}</div>
          {driver.is_online && (
            <div className="status-detail">
              {connected ? "Connected" : "Reconnecting…"}
              {locationError && <span className="status-warning"> · {locationError}</span>}
            </div>
          )}
        </div>
        <button
          className={"toggle-switch " + (driver.is_online ? "toggle-switch-on" : "")}
          onClick={toggleOnline}
          disabled={toggling || !zone}
          aria-label="Toggle online status"
        >
          <span className="toggle-knob" />
        </button>
      </div>

      {error && <div className="home-error">{error}</div>}

      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
          <span style={{ fontSize: 13, color: "var(--ink-muted)" }}>Vehicle</span>
          <span style={{ fontWeight: 600 }}>{driver.vehicles[0]?.plate_number || "—"}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span style={{ fontSize: 13, color: "var(--ink-muted)" }}>Rating</span>
          <span style={{ fontWeight: 600 }}>★ {driver.quality_score}</span>
        </div>
      </div>

      {offer && (
        <OfferModal offer={offer} onAccept={() => acceptOffer(offer.trip_id)} onDecline={() => declineOffer(offer.trip_id)} />
      )}
    </div>
  );
}
