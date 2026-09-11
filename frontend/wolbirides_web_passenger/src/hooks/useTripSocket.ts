import { useEffect, useRef, useState } from "react";
import { WS_BASE_URL } from "../api/client";

/**
 * Subscribes to /ws/trip/<tripId>/ for status pushes from the backend
 * (trips/consumers.py::TripConsumer). Reconnects on drop with a short
 * backoff — mobile networks in the pilot zone won't always be stable
 * (PRD Section 8: offline resilience).
 */
export function useTripSocket(tripId: string | null) {
  const [lastMessage, setLastMessage] = useState<any>(null);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef(0);

  useEffect(() => {
    if (!tripId) return;
    let cancelled = false;
    let retryTimeout: ReturnType<typeof setTimeout>;

    function connect() {
      const token = localStorage.getItem("wolbirides_access");
      const ws = new WebSocket(`${WS_BASE_URL}/ws/trip/${tripId}/?token=${token}`);
      wsRef.current = ws;

      ws.onopen = () => {
        if (cancelled) return;
        setConnected(true);
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
        setConnected(false);
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

  return { lastMessage, connected };
}
