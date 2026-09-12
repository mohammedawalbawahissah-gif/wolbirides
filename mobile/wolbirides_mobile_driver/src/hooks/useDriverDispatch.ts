import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { useCallback, useEffect, useRef, useState } from "react";
import { WS_BASE_URL, type RideOffer } from "../api/client";

const PING_INTERVAL_MS = 5000;
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

export function useDriverDispatch(zoneId: string | null, online: boolean) {
  const [connected, setConnected] = useState(false);
  const [offer, setOffer] = useState<RideOffer | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [backgroundModeActive, setBackgroundModeActive] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const retryRef = useRef(0);
  const lastPositionRef = useRef<{ lat: number; lng: number } | null>(null);
  const foregroundSubRef = useRef<Location.LocationSubscription | null>(null);

  const clearOffer = useCallback(() => setOffer(null), []);

  useEffect(() => {
    if (!online || !zoneId) {
      wsRef.current?.close();
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
      foregroundSubRef.current?.remove();
      Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME)
        .then(async (started) => { if (started) await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME); })
        .catch(() => {});
      latestLocationHandler = null;
      setConnected(false);
      setBackgroundModeActive(false);
      return;
    }

    let cancelled = false;
    let retryTimeout: ReturnType<typeof setTimeout>;

    latestLocationHandler = (loc) => {
      lastPositionRef.current = loc;
    };

    async function startLocationTracking() {
      const { status: fgStatus } = await Location.requestForegroundPermissionsAsync();
      if (fgStatus !== "granted") {
        setLocationError("Location permission denied — turn it on to receive ride requests.");
        return;
      }

      // Try background permission + background task registration first
      // (this is what makes location keep flowing while the app is
      // minimized). Falls back to foreground-only watching if unavailable
      // — either because the user declined "Always" permission, or
      // because we're running in Expo Go, which doesn't support this API.
      try {
        const { status: bgStatus } = await Location.requestBackgroundPermissionsAsync();
        if (bgStatus === "granted") {
          await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
            accuracy: Location.Accuracy.High,
            timeInterval: PING_INTERVAL_MS,
            distanceInterval: 0,
            showsBackgroundLocationIndicator: true,
            foregroundService: {
              notificationTitle: "WolbiRides Driver",
              notificationBody: "Sharing your location while you're online",
            },
          });
          setBackgroundModeActive(true);
          setLocationError(null);
          return;
        }
      } catch {
        // Background location unavailable (e.g. running in Expo Go) — fall
        // through to foreground-only tracking below.
      }

      setBackgroundModeActive(false);
      setLocationError(
        "Background location isn't available — location will pause if you leave this app. Keep it open while online."
      );
      foregroundSubRef.current = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: PING_INTERVAL_MS, distanceInterval: 0 },
        (loc) => {
          lastPositionRef.current = { lat: loc.coords.latitude, lng: loc.coords.longitude };
        }
      );
    }

    startLocationTracking();

    function connect() {
      AsyncStorage.getItem("wolbirides_driver_access").then((token) => {
        if (cancelled) return;
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
      });
    }

    connect();

    return () => {
      cancelled = true;
      clearTimeout(retryTimeout);
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
      foregroundSubRef.current?.remove();
      Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME)
        .then(async (started) => { if (started) await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME); })
        .catch(() => {});
      latestLocationHandler = null;
      wsRef.current?.close();
    };
  }, [online, zoneId]);

  return { connected, offer, locationError, backgroundModeActive, clearOffer };
}
