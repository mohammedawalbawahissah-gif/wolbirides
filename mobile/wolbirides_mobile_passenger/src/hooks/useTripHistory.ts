import { useCallback, useEffect, useState } from "react";
import { api, type Trip } from "../api/client";

const PAGE_SIZE = 50; // matches trips.services.HISTORY_PAGE_SIZE on the backend

/**
 * Trip history, newest first, 50 at a time. `loadMore` fetches the next page of older
 * trips using ?before=<requested_at of the oldest one shown>. Before paging existed,
 * anything past the 100 most recent trips couldn't be seen at all.
 */
export function useTripHistory(path: string, onError?: () => void) {
  const [trips, setTrips] = useState<Trip[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    api.get<Trip[]>(path)
      .then(({ data }) => { setTrips(data); setHasMore(data.length === PAGE_SIZE); })
      .catch(() => { setTrips([]); onError?.(); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  const loadMore = useCallback(async () => {
    if (!trips?.length || loadingMore) return;
    setLoadingMore(true);
    try {
      const before = encodeURIComponent(trips[trips.length - 1].requested_at);
      const { data } = await api.get<Trip[]>(`${path}?before=${before}`);
      setTrips((prev) => [...(prev ?? []), ...data]);
      setHasMore(data.length === PAGE_SIZE);
    } catch {
      onError?.();
    } finally {
      setLoadingMore(false);
    }
  }, [path, trips, loadingMore, onError]);

  return { trips, hasMore, loadingMore, loadMore };
}
