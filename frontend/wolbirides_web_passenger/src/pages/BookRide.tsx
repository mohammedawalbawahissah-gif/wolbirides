import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api, requestErrorMessage, type ServiceZone, type SuggestedRide } from "../api/client";
import LocationPickerModal, { type LatLng } from "../components/LocationPickerModal";
import QuickPlaces, { type PickedPlace } from "../components/QuickPlaces";
import RideOptions, { DEFAULT_RIDE_OPTIONS, deliveryIsComplete, rideOptionsToRequest, type RideOptionsValue } from "../components/RideOptions";
import { SkeletonBlock } from "../components/Skeleton";
import { useToast } from "../components/Toast";
import { PINNED_LABEL } from "../geocode";
import "./BookRide.css";

function haversineKm(a: LatLng, b: LatLng) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** WR-25: parcels price by package size; errands/vendor orders take the flat task rate.
 * Falls back to the old flat `delivery_surcharge` if an older backend hasn't shipped
 * `delivery_surcharges` yet, so this never silently prices a delivery at GH₵0. */
function deliverySurchargeFor(zone: ServiceZone, options: RideOptionsValue): number {
  if (options.kind !== "delivery") return 0;
  const tiers = zone.delivery_surcharges;
  if (!tiers) return Number(zone.delivery_surcharge ?? 0);
  if (options.delivery_subtype === "parcel") return Number(tiers[`parcel_${options.package_size}`] ?? 0);
  return Number(tiers.task ?? 0);
}

/**
 * Booking screen for both a ride and a delivery (opened from the Ride menu's
 * "Request a Ride" or "Delivery" card). Pickup and destination are set via a
 * full-screen search-and-map picker rather than two maps sitting on the page,
 * so the page itself stays short until a location is actually being chosen.
 */
export default function BookRide() {
  const navigate = useNavigate();
  const toast = useToast();
  const location = useLocation();
  const [zone, setZone] = useState<ServiceZone | null>(null);
  const [zonesLoaded, setZonesLoaded] = useState(false);
  const [pickup, setPickup] = useState<LatLng | null>(null);
  const [destination, setDestination] = useState<LatLng | null>(null);
  const [picking, setPicking] = useState<"pickup" | "destination" | null>(null);
  // Saved-place ids travel with the request only while the pin is still that saved place.
  const [savedIds, setSavedIds] = useState<{ pickup?: string; destination?: string }>({});
  const [requesting, setRequesting] = useState(false);
  const [suggestion, setSuggestion] = useState<SuggestedRide | null>(null);
  const [options, setOptions] = useState<RideOptionsValue>(() => {
    const initialKind = (location.state as { initialKind?: "ride" | "delivery" } | null)?.initialKind;
    return initialKind ? { ...DEFAULT_RIDE_OPTIONS, kind: initialKind } : DEFAULT_RIDE_OPTIONS;
  });

  function pickPlace(which: "pickup" | "destination", place: PickedPlace) {
    const point = { lat: place.lat, lng: place.lng, label: place.label };
    if (which === "pickup") setPickup(point); else setDestination(point);
    setSavedIds((ids) => ({ ...ids, [which]: place.savedAddressId }));
  }

  function confirmPicked(pos: LatLng) {
    if (picking === "pickup") { setPickup(pos); setSavedIds((ids) => ({ ...ids, pickup: undefined })); }
    else if (picking === "destination") { setDestination(pos); setSavedIds((ids) => ({ ...ids, destination: undefined })); }
    setPicking(null);
  }

  // WR-13: "Ride again" from history arrives here with the route pre-filled.
  useEffect(() => {
    const rebook = (location.state as { rebook?: { pickup: LatLng; destination: LatLng } } | null)?.rebook;
    if (rebook) {
      setPickup(rebook.pickup);
      setDestination(rebook.destination);
      window.history.replaceState({}, "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [partners, setPartners] = useState<{ id: string; name: string; lat: string; lng: string; offer_text: string }[]>([]);

  // WR-13: offer the passenger's most-repeated route as a one-tap prefill.
  useEffect(() => {
    api
      .get<SuggestedRide | null>("/passengers/me/suggested-ride")
      .then(({ data }) => setSuggestion(data || null))
      .catch(() => setSuggestion(null));
  }, []);

  function useSuggestion() {
    if (!suggestion) return;
    setPickup({ lat: Number(suggestion.pickup_lat), lng: Number(suggestion.pickup_lng), label: suggestion.pickup_label });
    setDestination({
      lat: Number(suggestion.destination_lat),
      lng: Number(suggestion.destination_lng),
      label: suggestion.destination_label,
    });
    setSuggestion(null);
  }

  const [zonesFailed, setZonesFailed] = useState<string | null>(null);
  const [zonesTry, setZonesTry] = useState(0);
  useEffect(() => {
    // eslint-disable-next-line react-hooks-js/set-state-in-effect -- clears the last failure as the effect starts a fetch
    setZonesFailed(null);
    api
      .get<ServiceZone[]>("/zones")
      .then(({ data }) => {
        if (data.length > 0) setZone(data[0]);
      })
      .catch((err) => setZonesFailed(requestErrorMessage(err, "Couldn't load service zones.")))
      .finally(() => setZonesLoaded(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reruns only on "Try again"
  }, [zonesTry]);

  const distanceKm = pickup && destination ? haversineKm(pickup, destination) : null;
  const baseEstimate =
    zone && distanceKm != null
      ? Number(zone.base_fare) + distanceKm * Number(zone.per_km_rate) + deliverySurchargeFor(zone, options)
      : null;
  // A shared ride's price is only known once someone pairs with you, so the estimate shows the solo fare (the most you'd pay).
  const fareEstimate = baseEstimate != null ? Math.max(baseEstimate - options.promo_discount, 0) : null;

  // WR-24: partner venues and sponsored placements for this zone. The same for every
  // passenger in the zone; nothing about this passenger is used to choose them.
  const [placements, setPlacements] = useState<{ id: string; title: string; description: string; image_url: string;
    link_url: string; sponsor_name: string }[]>([]);
  useEffect(() => {
    if (!zone) return;
    api.get(`/partners?zone_id=${zone.id}`).then(({ data }) => setPartners(data)).catch(() => {});
    api.get(`/placements/active?zone_id=${zone.id}`).then(({ data }) => setPlacements(data)).catch(() => {});
  }, [zone]);

  async function requestRide() {
    if (!zone || !pickup || !destination || distanceKm == null) return;
    setRequesting(true);
    try {
      const { data } = await api.post("/trips", {
        zone_id: zone.id,
        pickup_lat: pickup.lat,
        pickup_lng: pickup.lng,
        pickup_label: pickup.label || PINNED_LABEL,
        destination_lat: destination.lat,
        destination_lng: destination.lng,
        destination_label: destination.label || PINNED_LABEL,
        distance_km: distanceKm.toFixed(2),
        pickup_saved_address_id: savedIds.pickup,
        destination_saved_address_id: savedIds.destination,
        ...rideOptionsToRequest(options),
      });
      toast.show(options.kind === "delivery" ? "Delivery booked. Finding a rider." : "Ride requested. Finding you a rider.", "success");
      navigate(`/trip/${data.id}`);
    } catch (err: any) {
      const d = err?.response?.data;
      const msg = d?.detail || (d && typeof d === "object" ? String(Object.values(d)[0]) : null);
      toast.show(msg || "Couldn't request a ride right now. Try again in a moment.", "error");
    } finally {
      setRequesting(false);
    }
  }

  if (!zonesLoaded) {
    return (
      <div>
        <div className="page-heading">
          <SkeletonBlock height={28} width="40%" />
        </div>
        <div className="ride-layout">
          <div className="ride-map-col">
            <SkeletonBlock height={64} radius={14} />
            <div style={{ height: 12 }} />
            <SkeletonBlock height={64} radius={14} />
          </div>
          <aside className="ride-panel-col">
            <div className="card">
              <SkeletonBlock height={20} width="50%" />
              <div style={{ height: 16 }} />
              <SkeletonBlock height={44} radius={10} />
            </div>
          </aside>
        </div>
      </div>
    );
  }

  // A failed request is not the same as "no zone": say which it is, and let the passenger try again.
  if (zonesFailed) {
    return (
      <div className="empty-state">
        <p>{zonesFailed}</p>
        <button className="btn btn-gold" onClick={() => { setZonesLoaded(false); setZonesTry((n) => n + 1); }}>Try again</button>
      </div>
    );
  }

  if (!zone) {
    return (
      <div className="empty-state">
        <p>No active service zone yet — check back once the pilot zone is live.</p>
      </div>
    );
  }

  const mapCenter: LatLng = {
    lat: (zone.boundary.min_lat + zone.boundary.max_lat) / 2,
    lng: (zone.boundary.min_lng + zone.boundary.max_lng) / 2,
  };

  return (
    <div>
      <div className="page-heading">
        <h1>{options.kind === "delivery"
          ? (options.delivery_subtype === "parcel" ? "Send or receive a package"
             : options.delivery_subtype === "errand" ? "Get something done" : "Order from a vendor")
          : "Where to?"}</h1>
        <p>{zone.name}</p>
      </div>

      {suggestion && !pickup && !destination && (
        <div className="suggested-ride">
          <div>
            <div className="suggested-ride-title">
              {suggestion.pickup_label} to {suggestion.destination_label}
            </div>
            <div className="suggested-ride-meta">You've taken this ride {suggestion.trip_count} times this month</div>
          </div>
          <button className="btn btn-gold" onClick={useSuggestion}>Use this route</button>
        </div>
      )}

      {placements.map((p) => (
        <aside key={p.id} className="placement-card" aria-label={`Sponsored by ${p.sponsor_name}`}>
          <span className="sponsored-tag">Sponsored</span>
          {p.image_url && <img src={p.image_url} alt="" className="placement-img" />}
          <div>
            <strong>{p.title}</strong>
            {p.description && <p>{p.description}</p>}
            <span className="placement-sponsor">
              {p.sponsor_name}
              {p.link_url && <> · <a href={p.link_url} target="_blank" rel="noopener noreferrer sponsored">Learn more</a></>}
            </span>
          </div>
        </aside>
      ))}

      {partners.length > 0 && !destination && (
        <div className="partner-strip">
          <div className="partner-strip-title">Partner spots <span className="sponsored-tag">Sponsored</span></div>
          <div className="partner-chips">
            {partners.map((p) => (
              <button key={p.id} className="partner-chip"
                onClick={() => setDestination({ lat: Number(p.lat), lng: Number(p.lng), label: p.name })}>
                <strong>{p.name}</strong>
                {p.offer_text && <span>{p.offer_text}</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="ride-layout">
        <div className="ride-map-col">
          <QuickPlaces zone={zone} onPick={pickPlace} />

          <button className="location-button" onClick={() => setPicking("pickup")}>
            <span className="trip-dot trip-dot-pickup" />
            <span className="location-button-text">
              <span className="location-button-label">{options.kind === "delivery" ? "Collect from" : "Pickup"}</span>
              <span className="location-button-value">{pickup ? (pickup.label || PINNED_LABEL) : "Tap to set"}</span>
            </span>
            <span className="location-button-chevron">›</span>
          </button>

          <button className="location-button" onClick={() => setPicking("destination")}>
            <span className="trip-dot trip-dot-dest" />
            <span className="location-button-text">
              <span className="location-button-label">{options.kind === "delivery" ? "Deliver to" : "Destination"}</span>
              <span className="location-button-value">{destination ? (destination.label || PINNED_LABEL) : "Tap to set"}</span>
            </span>
            <span className="location-button-chevron">›</span>
          </button>
        </div>

        <aside className="ride-panel-col">
          <div className="card ride-summary-card">
            <h2>{options.kind === "delivery" ? "Delivery Summary" : "Trip summary"}</h2>

            <RideOptions value={options} onChange={setOptions} destination={destination}
              fareEstimate={baseEstimate} />

            {fareEstimate != null && (
              <div className="fare-block">
                <div>
                  <div className="fare-label">
                    {options.kind === "ride" && options.shareable ? "At most" : "Estimated fare"}
                    {options.promo_discount > 0 ? ` (GH₵${options.promo_discount.toFixed(2)} off)` : ""}
                  </div>
                  <div className="fare-value">GH₵{fareEstimate.toFixed(2)}</div>
                </div>
                <div className="fare-distance">{distanceKm!.toFixed(1)} km</div>
              </div>
            )}

            <button
              className="btn btn-gold btn-block"
              disabled={!pickup || !destination || requesting || !deliveryIsComplete(options)}
              onClick={requestRide}
            >
              {requesting ? "Requesting…" : options.kind === "delivery" ? "Book delivery" : "Request ride"}
            </button>
          </div>
        </aside>
      </div>

      {picking && (
        <LocationPickerModal
          title={picking === "pickup" ? (options.kind === "delivery" ? "Collect from" : "Set pickup")
            : (options.kind === "delivery" ? "Deliver to" : "Set destination")}
          center={(picking === "pickup" ? pickup : destination) ?? mapCenter}
          zoneId={zone.id}
          value={picking === "pickup" ? pickup : destination}
          onConfirm={confirmPicked}
          onClose={() => setPicking(null)}
        />
      )}
    </div>
  );
}
