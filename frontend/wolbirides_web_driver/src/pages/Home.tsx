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
    return <div className="empty-state">Your account isn't verified yet — you can't go online until ops approves your application.</div>;
  }

  return (
    <div>
      <div className="page-heading">
        <h1>{driver.is_online ? "You're online" : "You're offline"}</h1>
        <p>{zone ? zone.name : "Loading zone…"}</p>
      </div>

      <div className="drive-layout">
        <div className="drive-main-col">
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

          {error && <div className="auth-error">{error}</div>}

          {!driver.is_online && (
            <div className="card drive-hint-card">
              <h2>Ready to start earning?</h2>
              <p>
                Go online to start receiving ride requests in {zone?.name ?? "your zone"}. Keep this
                tab open and location sharing turned on while you're online.
              </p>
              <button className="btn btn-gold btn-block" onClick={toggleOnline} disabled={toggling || !zone}>
                {toggling ? "Going online…" : "Go online"}
              </button>
            </div>
          )}

          {driver.is_online && (
            <button
              className="btn btn-danger-ghost btn-block"
              onClick={toggleOnline}
              disabled={toggling}
              style={{ marginTop: 12 }}
            >
              {toggling ? "Going offline…" : "Go offline"}
            </button>
          )}
        </div>

        <aside className="drive-side-col">
          <div className="card">
            <h2 className="side-card-title">Vehicle</h2>
            <div className="kv-row">
              <span>Plate</span>
              <strong>{driver.vehicles[0]?.plate_number || "—"}</strong>
            </div>
            <div className="kv-row">
              <span>Rating</span>
              <strong>★ {driver.quality_score}</strong>
            </div>
          </div>
        </aside>
      </div>

      {offer && (
        <OfferModal offer={offer} onAccept={() => acceptOffer(offer.trip_id)} onDecline={() => declineOffer(offer.trip_id)} />
      )}
    </div>
  );
}
