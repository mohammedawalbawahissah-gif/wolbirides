import { createContext, useContext, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api, type Driver, type RideOffer } from "../api/client";
import { useDriverDispatch } from "../hooks/useDriverDispatch";
import OfferModal from "./OfferModal";

interface DispatchState {
  connected: boolean;
  locationError: string | null;
  offer: RideOffer | null;
  accept: () => Promise<void>;
  decline: () => Promise<void>;
}

const DispatchContext = createContext<DispatchState>({
  connected: false, locationError: null, offer: null, accept: async () => {}, decline: async () => {},
});

// eslint-disable-next-line react/only-export-components -- exports this module's hook/helpers next to its component (standard pattern); only affects dev hot-reload
export function useDispatchState() {
  return useContext(DispatchContext);
}

/**
 * Keeps the driver's dispatch connection alive on every driver page, not just Home.
 * Before this lived inside Home, so opening a trip, Earnings, Trips or Profile
 * silently stopped location pings (frozen passenger map, no "driver arriving") and
 * stopped ride offers while the driver still showed as online.
 *
 * The current offer (organic dispatch or an ops-sent delivery offer — WR-26 makes an admin
 * assignment an offer to accept or decline, not an instant match) is exposed here so both the
 * countdown modal below AND the standalone Requests page can show and act on the very same
 * thing, rather than the modal being the only place it's visible.
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

  async function accept() {
    if (!offer) return;
    try {
      await api.post(`/trips/${offer.trip_id}/accept`);
      clearOffer();
      navigate(`/active-trip/${offer.trip_id}`);
    } catch {
      clearOffer();
    }
  }

  async function decline() {
    if (!offer) return;
    try {
      await api.post(`/trips/${offer.trip_id}/decline`);
    } finally {
      clearOffer();
    }
  }

  // No new offers pop over a trip already in progress.
  const onTripScreen = location.pathname.startsWith("/active-trip/");
  return (
    <DispatchContext.Provider value={{ connected, locationError, offer, accept, decline }}>
      {children}
      {offer && !onTripScreen && !location.pathname.startsWith("/requests") && (
        <OfferModal offer={offer} onAccept={accept} onDecline={decline} />
      )}
    </DispatchContext.Provider>
  );
}
