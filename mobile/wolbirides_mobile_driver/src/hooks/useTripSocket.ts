import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useRef, useState } from "react";
import { WS_BASE_URL } from "../api/client";

export function useTripSocket(tripId: string | null) {
  const [lastMessage, setLastMessage] = useState<any>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef(0);

  useEffect(() => {
    if (!tripId) return;
    let cancelled = false;
    let retryTimeout: ReturnType<typeof setTimeout>;

    async function connect() {
      const token = await AsyncStorage.getItem("wolbirides_driver_access");
      if (cancelled) return;
      const ws = new WebSocket(`${WS_BASE_URL}/ws/trip/${tripId}/?token=${token}`);
      wsRef.current = ws;

      ws.onopen = () => {
        retryRef.current = 0;
      };
      ws.onmessage = (event) => {
        if (cancelled) return;
        try {
          setLastMessage(JSON.parse(event.data));
        } catch {
          // ignore malformed frames
        }
      };
      ws.onclose = () => {
        if (cancelled) return;
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
      wsRef.current?.close();
    };
  }, [tripId]);

  return { lastMessage };
}
