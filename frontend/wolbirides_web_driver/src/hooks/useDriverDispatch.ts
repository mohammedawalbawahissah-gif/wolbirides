import { useCallback, useEffect, useRef, useState } from "react";
import { WS_BASE_URL, type RideOffer } from "../api/client";

const PING_INTERVAL_MS = 5000;

/**
 * Manages the driver's /ws/driver/location/ connection: sends a location
 * ping on an interval while `online` is true, and surfaces incoming
 * ride_request pushes (trips/services.py::_offer_to_driver) as state.
 *
 * IMPORTANT LIMITATION vs. the eventual Expo app: this uses the browser's
 * foreground Geolocation API (navigator.geolocation), which only reports
 * position while this tab is open and active. There is no background
 * location on the web — that's precisely the problem PRD Section 8 flags
 * as needing an Expo dev-client build with background permissions. This
 * web version is a legitimate way to run the pilot (a driver props their
 * phone up with the browser tab open), but it is not a substitute for the
 * native app's background tracking.
 */
export function useDriverDispatch(zoneId: string | null, online: boolean) {
  const [connected, setConnected] = useState(false);
  const [offer, setOffer] = useState<RideOffer | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const retryRef = useRef(0);
  const lastPositionRef = useRef<{ lat: number; lng: number } | null>(null);
  const watchIdRef = useRef<number | null>(null);

  const clearOffer = useCallback(() => setOffer(null), []);

  useEffect(() => {
    if (!online || !zoneId) {
      wsRef.current?.close();
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
      if (watchIdRef.current != null) navigator.geolocation.clearWatch(watchIdRef.current);
      setConnected(false);
      return;
    }

    let cancelled = false;
    let retryTimeout: ReturnType<typeof setTimeout>;

    if ("geolocation" in navigator) {
      watchIdRef.current = navigator.geolocation.watchPosition(
        (pos) => {
          lastPositionRef.current = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          setLocationError(null);
        },
        () => setLocationError("Location access denied — turn on location sharing to receive ride requests."),
        { enableHighAccuracy: true, maximumAge: 10000 }
      );
    } else {
      setLocationError("This browser doesn't support location — try a different device.");
    }

    function connect() {
      const token = localStorage.getItem("wolbirides_driver_access");
      const ws = new WebSocket(`${WS_BASE_URL}/ws/driver/location/?token=${token}`);
      wsRef.current = ws;

      ws.onopen = () => {
        if (cancelled) return;
        setConnected(true);
        retryRef.current = 0;
        pingIntervalRef.current = setInterval(() => {
          const pos = lastPositionRef.current;
          if (pos && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "location.ping", lat: pos.lat, lng: pos.lng, zone_id: zoneId }));
          }
        }, PING_INTERVAL_MS);
      };

      ws.onmessage = (event) => {
        if (cancelled) return;
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "ride_request") {
            setOffer(msg.trip);
          } else if (msg.type === "trip_cancelled") {
            setOffer(null);
          }
        } catch {
          // ignore malformed frames
        }
      };

      ws.onclose = () => {
        if (cancelled) return;
        setConnected(false);
        if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
        const delay = Math.min(1000 * 2 ** retryRef.current, 10000);
        retryRef.current += 1;
        retryTimeout = setTimeout(connect, delay);
      };
      ws.onerror = () => ws.close();
    }

    connect();

    return () => {
      cancelled = true;
      clearTimeout(retryTimeout);
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
      if (watchIdRef.current != null) navigator.geolocation.clearWatch(watchIdRef.current);
      wsRef.current?.close();
    };
  }, [online, zoneId]);

  return { connected, offer, locationError, clearOffer };
}
