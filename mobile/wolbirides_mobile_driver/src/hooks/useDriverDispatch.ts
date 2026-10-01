import { getAccessToken } from "../tokenStore";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, WS_BASE_URL, type RideOffer } from "../api/client";

// The server says how hard to track (see backend trips/consumers.py): precise and
// frequent while heading to or carrying a passenger; lighter while waiting for work,
// which is most of a shift and the biggest battery cost on budget Android phones.
type TrackingMode = "active" | "idle";
const TRACKING: Record<TrackingMode, { accuracy: Location.Accuracy; timeInterval: number; distanceInterval: number }> = {
  active: { accuracy: Location.Accuracy.High, timeInterval: 5000, distanceInterval: 0 },
  idle: { accuracy: Location.Accuracy.Balanced, timeInterval: 15000, distanceInterval: 25 },
};
const LOCATION_TASK_NAME = "wolbirides-driver-location-task";

/**
 * Background location task definition. Must be registered at module scope
 * (not inside a component) per Expo's TaskManager requirements — this is
 * what lets location updates keep flowing when the app is backgrounded,
 * which is the entire reason a native build exists instead of just reusing
 * the web driver app's foreground-only geolocation.
 *
 * IMPORTANT: this task only fires in a real dev-client/standalone build.
 * Expo Go removed support for background location starting SDK 51 — in
 * Expo Go, `Location.startLocationUpdatesAsync` will throw, and this hook
 * catches that and falls back to foreground-only watching (same
 * limitation the web driver app already has, documented there).
 */
let latestLocationHandler: ((loc: { lat: number; lng: number }) => void) | null = null;

TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }) => {
  if (error || !data) return;
  const { locations } = data as { locations: Location.LocationObject[] };
  const loc = locations[locations.length - 1];
  if (loc && latestLocationHandler) {
    latestLocationHandler({ lat: loc.coords.latitude, lng: loc.coords.longitude });
  }
});

export function useDriverDispatch(zoneId: string | null, online: boolean, onForcedOffline?: (reason: string) => void) {
  const [connected, setConnected] = useState(false);
  const [offer, setOffer] = useState<RideOffer | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [backgroundModeActive, setBackgroundModeActive] = useState(false);
  const [mode, setMode] = useState<TrackingMode>("idle");

  const wsRef = useRef<WebSocket | null>(null);
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const retryRef = useRef(0);
  const lastPositionRef = useRef<{ lat: number; lng: number } | null>(null);
  const foregroundSubRef = useRef<Location.LocationSubscription | null>(null);
  const modeRef = useRef<TrackingMode>("idle");
  const forcedOfflineRef = useRef(onForcedOffline);
  useEffect(() => {
    forcedOfflineRef.current = onForcedOffline;
  }, [onForcedOffline]);

  const clearOffer = useCallback(() => setOffer(null), []);

  // --- GPS: restarted only when online state or tracking mode changes (never the socket) ---
  useEffect(() => {
    if (!online || !zoneId) return;
    let stopped = false;
    const settings = TRACKING[mode];
    latestLocationHandler = (loc) => {
      lastPositionRef.current = loc;
    };

    (async () => {
      const { status: fgStatus } = await Location.requestForegroundPermissionsAsync();
      if (stopped) return;
      if (fgStatus !== "granted") {
        setLocationError("Location permission denied — turn it on to receive ride requests.");
        return;
      }
      // Background tracking first (keeps flowing when the app is minimised); falls back to
      // foreground-only if "Always" permission is declined or we're in Expo Go.
      try {
        const { status: bgStatus } = await Location.requestBackgroundPermissionsAsync();
        if (bgStatus === "granted" && !stopped) {
          if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME)) {
            await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
          }
          await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
            ...settings,
            showsBackgroundLocationIndicator: true,
            foregroundService: {
              notificationTitle: "WolbiRides Rider",
              notificationBody: "Sharing your location while you're online",
            },
          });
          setBackgroundModeActive(true);
          setLocationError(null);
          return;
        }
      } catch {
        // Background location unavailable: fall through to foreground-only tracking.
      }
      if (stopped) return;
      setBackgroundModeActive(false);
      setLocationError(
        "Background location isn't available — location will pause if you leave this app. Keep it open while online."
      );
      foregroundSubRef.current?.remove();
      foregroundSubRef.current = await Location.watchPositionAsync(settings, (loc) => {
        lastPositionRef.current = { lat: loc.coords.latitude, lng: loc.coords.longitude };
      });
    })();

    return () => {
      stopped = true;
      foregroundSubRef.current?.remove();
      foregroundSubRef.current = null;
      Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME)
        .then(async (started) => { if (started) await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME); })
        .catch(() => {});
      latestLocationHandler = null;
    };
  }, [online, zoneId, mode]);

  // --- Socket: pings, offers, and server instructions ---
  useEffect(() => {
    if (!online || !zoneId) {
      wsRef.current?.close();
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
      setConnected(false);
      setBackgroundModeActive(false);
      return;
    }

    let cancelled = false;
    let retryTimeout: ReturnType<typeof setTimeout>;

    function startPinging(ws: WebSocket) {
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = setInterval(() => {
        const pos = lastPositionRef.current;
        if (pos && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "location.ping", lat: pos.lat, lng: pos.lng, zone_id: zoneId }));
        }
      }, TRACKING[modeRef.current].timeInterval);
    }

    function connect() {
      getAccessToken().then((token) => {
        if (cancelled) return;
        const ws = new WebSocket(`${WS_BASE_URL}/ws/driver/location/?token=${token}`);
        wsRef.current = ws;

        ws.onopen = () => {
          if (cancelled) return;
          setConnected(true);
          retryRef.current = 0;
          startPinging(ws);
        };

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
                setMode(msg.mode); // restarts GPS with the matching settings
                startPinging(ws);
              }
            } else if (msg.type === "force_offline") {
              // Suspended, rejected or switched offline elsewhere: the screen reloads the driver.
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
      });
    }

    connect();

    return () => {
      cancelled = true;
      clearTimeout(retryTimeout);
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
      wsRef.current?.close();
    };
  }, [online, zoneId]);

  useEffect(() => {
    if (!online) return;
    let cancelled = false;
    function poll() {
      api.get<RideOffer | null>("/drivers/me/current-offer").then(({ data }) => {
        if (!cancelled && data) setOffer((current) => current ?? data);
      }).catch(() => {});
    }
    poll();
    const id = setInterval(poll, 20000);
    return () => { cancelled = true; clearInterval(id); };
  }, [online]);

  return { connected, offer, locationError, backgroundModeActive, clearOffer, mode };
}
