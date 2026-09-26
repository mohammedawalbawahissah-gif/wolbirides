import { createContext, useContext, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api, type Driver } from "../api/client";
import { useDriverDispatch } from "../hooks/useDriverDispatch";
import OfferModal from "./OfferModal";

interface DispatchState {
  connected: boolean;
  locationError: string | null;
}

const DispatchContext = createContext<DispatchState>({ connected: false, locationError: null });

// eslint-disable-next-line react/only-export-components -- exports this module's hook/helpers next to its component (standard pattern); only affects dev hot-reload
export function useDispatchState() {
  return useContext(DispatchContext);
}

/**
 * Keeps the driver's dispatch connection alive on every driver page, not just Home.
 * Before this lived inside Home, so opening a trip, Earnings, Trips or Profile
 * silently stopped location pings (frozen rider map, no "driver arriving") and
 * stopped ride offers while the driver still showed as online.
 */
export default function DispatchLayer({ driver, onDriverChanged, children }: {
  driver: Driver; onDriverChanged: () => void; children: ReactNode;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const { connected, offer, locationError, clearOffer } = useDriverDispatch(
    driver.current_zone,
    driver.verification_status === "verified" && driver.is_online,
    () => onDriverChanged(), // server said: suspended / offline, so reload the driver
  );

  async function accept(tripId: string) {
    try {
      await api.post(`/trips/${tripId}/accept`);
      clearOffer();
      navigate(`/active-trip/${tripId}`);
    } catch {
      clearOffer();
    }
  }

  async function decline(tripId: string) {
    try {
      await api.post(`/trips/${tripId}/decline`);
    } finally {
      clearOffer();
    }
  }

  // No new offers pop over a trip already in progress.
  const onTripScreen = location.pathname.startsWith("/active-trip/");
  return (
    <DispatchContext.Provider value={{ connected, locationError }}>
      {children}
      {offer && !onTripScreen && (
        <OfferModal offer={offer} onAccept={() => accept(offer.trip_id)} onDecline={() => decline(offer.trip_id)} />
      )}
    </DispatchContext.Provider>
  );
}
