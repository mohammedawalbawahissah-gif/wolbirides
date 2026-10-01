import { createContext, useContext, type ReactNode } from "react";
import { api, type Driver, type RideOffer } from "../api/client";
import { useDriverDispatch } from "../hooks/useDriverDispatch";
import { navigationRef } from "../navigation/navigationRef";
import OfferModal from "./OfferModal";

interface DispatchState {
  connected: boolean;
  locationError: string | null;
  backgroundModeActive: boolean;
  offer: RideOffer | null;
  accept: () => Promise<void>;
  decline: () => Promise<void>;
}

const DispatchContext = createContext<DispatchState>({
  connected: false, locationError: null, backgroundModeActive: false,
  offer: null, accept: async () => {}, decline: async () => {},
});

export function useDispatchState() {
  return useContext(DispatchContext);
}

/**
 * Keeps the driver's dispatch connection alive on every tab, not just Home — before this
 * lived inside HomeScreen, so switching to Trips, Earnings or Profile could silently drop
 * ride offers and admin-sent delivery offers while the driver still showed as online.
 *
 * The current offer (organic dispatch, or an ops-sent delivery offer — WR-26 makes an admin
 * assignment an offer to accept or decline, not an instant match) is exposed here so both the
 * countdown modal below AND the standalone Requests screen show and act on the very same thing,
 * rather than the modal being the only place it's visible. The dispatch hook itself also polls
 * /drivers/me/current-offer as a backstop, so an offer still shows up even if the live push was
 * missed entirely — including in Expo Go, where remote push doesn't work at all.
 */
export default function DispatchLayer({ driver, onDriverChanged, children }: {
  driver: Driver; onDriverChanged: () => void; children: ReactNode;
}) {
  const { connected, offer, locationError, backgroundModeActive, clearOffer } = useDriverDispatch(
    driver.current_zone,
    driver.verification_status === "verified" && driver.is_online,
    onDriverChanged, // server said: suspended / offline, so reload the driver
  );

  async function accept() {
    if (!offer) return;
    try {
      await api.post(`/trips/${offer.trip_id}/accept`);
      clearOffer();
      if (navigationRef.isReady()) navigationRef.navigate("ActiveTrip", { tripId: offer.trip_id });
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

  // No new offers pop over a trip already in progress, or over the Requests screen (which shows
  // the very same offer inline — no need to also throw a modal on top of it).
  const onTripScreen = navigationRef.isReady() && navigationRef.getCurrentRoute()?.name === "ActiveTrip";
  const onRequestsScreen = navigationRef.isReady() && navigationRef.getCurrentRoute()?.name === "Requests";
  return (
    <DispatchContext.Provider value={{ connected, locationError, backgroundModeActive, offer, accept, decline }}>
      {children}
      {offer && !onTripScreen && !onRequestsScreen && (
        <OfferModal offer={offer} onAccept={accept} onDecline={decline} />
      )}
    </DispatchContext.Provider>
  );
}
