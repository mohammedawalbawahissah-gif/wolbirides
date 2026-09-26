import { useCallback, useEffect, useRef, useState } from "react";
import { WS_BASE_URL, type RideOffer } from "../api/client";

// The server says how hard to track (see trips/consumers.py): precise and frequent
// while heading to or carrying a rider, lighter while waiting for work.
const PING_INTERVAL_MS = { active: 5000, idle: 15000 } as const;
type TrackingMode = keyof typeof PING_INTERVAL_MS;

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
export function useDriverDispatch(zoneId: string | null, online: boolean, onForcedOffline?: (reason: string) => void) {
  const [connected, setConnected] = useState(false);
  const [mode, setMode] = useState<TrackingMode>("idle");
  const modeRef = useRef<TrackingMode>("idle");
  const forcedOfflineRef = useRef(onForcedOffline);
  useEffect(() => {
    forcedOfflineRef.current = onForcedOffline;
  }, [onForcedOffline]);
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
      // eslint-disable-next-line react-hooks-js/set-state-in-effect -- resets loading/error state as the effect starts a fetch or subscription
      setConnected(false);
      return;
    }

    let cancelled = false;
    let retryTimeout: ReturnType<typeof setTimeout>;

    function connect() {
      const token = localStorage.getItem("wolbirides_driver_access");
      const ws = new WebSocket(`${WS_BASE_URL}/ws/driver/location/?token=${token}`);
      wsRef.current = ws;

      ws.onopen = () => {
        if (cancelled) return;
        setConnected(true);
        retryRef.current = 0;
        startPinging(ws);
      };

      function startPinging(ws: WebSocket) {
        if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = setInterval(() => {
          const pos = lastPositionRef.current;
          if (pos && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "location.ping", lat: pos.lat, lng: pos.lng, zone_id: zoneId }));
          }
        }, PING_INTERVAL_MS[modeRef.current]);
      }

      ws.onmessage = (event) => {
        if (cancelled) return;
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "ride_request") {
            setOffer(msg.trip);
          } else if (msg.type === "trip_cancelled") {
            setOffer(null);
          } else if (msg.type === "tracking_mode" && (msg.mode === "active" || msg.mode === "idle")) {
            if (msg.mode !== modeRef.current) {
              modeRef.current = msg.mode;
              setMode(msg.mode);
              startPinging(ws);
            }
          } else if (msg.type === "force_offline") {
            // Suspended, rejected or switched offline elsewhere: stop at once and let the page refresh the driver.
            setOffer(null);
            forcedOfflineRef.current?.(msg.reason ?? "offline");
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
      wsRef.current?.close();
    };
  }, [online, zoneId]);

  // GPS runs separately so a tracking-mode change only restarts the location watch,
  // never the socket. High accuracy only while a rider is waiting or on board.
  useEffect(() => {
    if (!online || !zoneId) return;
    if (!("geolocation" in navigator)) {
      // eslint-disable-next-line react-hooks-js/set-state-in-effect -- resets loading/error state as the effect starts a fetch or subscription
      setLocationError("This browser doesn't support location — try a different device.");
      return;
    }
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        lastPositionRef.current = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setLocationError(null);
      },
      () => setLocationError("Location access denied — turn on location sharing to receive ride requests."),
      { enableHighAccuracy: mode === "active", maximumAge: mode === "active" ? 5000 : 15000 }
    );
    return () => {
      if (watchIdRef.current != null) navigator.geolocation.clearWatch(watchIdRef.current);
    };
  }, [online, zoneId, mode]);

  return { connected, offer, locationError, clearOffer, mode };
}
