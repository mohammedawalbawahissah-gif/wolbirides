import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState } from "react-native";
import { api, type SOSResult } from "./api/client";

/**
 * WR-18 guardrail: SOS must work under poor connectivity. An alert that
 * can't be sent is written to the phone first, then retried aggressively:
 * every few seconds, whenever the app comes back to the foreground, and on
 * the next app launch, until the server confirms it.
 */
const KEY = "wolbirides_pending_sos";

interface PendingSOS { tripId: string; lat?: string; lng?: string; queuedAt: number }

async function readQueue(): Promise<PendingSOS[]> {
  try {
    return JSON.parse((await AsyncStorage.getItem(KEY)) || "[]");
  } catch {
    return [];
  }
}

async function writeQueue(items: PendingSOS[]) {
  await AsyncStorage.setItem(KEY, JSON.stringify(items));
}

export async function queueSOS(item: PendingSOS) {
  const queue = (await readQueue()).filter((q) => q.tripId !== item.tripId);
  await writeQueue([...queue, item]);
}

async function sendOne(item: PendingSOS): Promise<SOSResult | "refused" | null> {
  try {
    const body = item.lat && item.lng ? { lat: item.lat, lng: item.lng } : {};
    const { data } = await api.post<SOSResult>(`/trips/${item.tripId}/sos`, body);
    return data;
  } catch (err: any) {
    // A 4xx is a real answer (e.g. not your trip); only network/server failures are retried.
    return err?.response && err.response.status < 500 ? "refused" : null;
  }
}

/** Tries every queued alert once. Returns results for the ones that went through. */
export async function flushSOSQueue(): Promise<Record<string, SOSResult>> {
  const queue = await readQueue();
  const sent: Record<string, SOSResult> = {};
  const remaining: PendingSOS[] = [];
  for (const item of queue) {
    const result = await sendOne(item);
    if (result && result !== "refused") sent[item.tripId] = result;
    else if (result === null && Date.now() - item.queuedAt < 6 * 60 * 60 * 1000) remaining.push(item);
  }
  await writeQueue(remaining);
  return sent;
}

let started = false;

/** Call once after sign-in: flushes anything left from a previous session and on every return to the app. */
export function startSOSQueueFlusher() {
  if (started) return;
  started = true;
  flushSOSQueue();
  AppState.addEventListener("change", (state) => { if (state === "active") flushSOSQueue(); });
}

/** Sends now, retrying for a few minutes while the screen is open; stays queued after that. */
export async function sendSOSWithRetry(item: PendingSOS, onRetry: () => void): Promise<SOSResult | null> {
  await queueSOS(item);
  for (let attempt = 0; attempt < 40; attempt++) {
    const result = await sendOne(item);
    if (result === "refused") {
      await writeQueue((await readQueue()).filter((q) => q.tripId !== item.tripId));
      return null;
    }
    if (result) {
      await writeQueue((await readQueue()).filter((q) => q.tripId !== item.tripId));
      return result;
    }
    onRetry();
    await new Promise((r) => setTimeout(r, Math.min(2000 + attempt * 1000, 8000)));
  }
  return null;
}
