import AsyncStorage from "@react-native-async-storage/async-storage";
import axios from "axios";
import Constants from "expo-constants";
import { STORAGE_KEYS } from "../appConfig";
import { clearTokens, getAccessToken, getRefreshToken, saveTokens } from "../tokenStore";

// Expo env vars come through app.json's "extra" block (import.meta.env is Vite-only).
const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, string>;
export const API_BASE_URL = extra.apiBaseUrl || "http://localhost:8001/api";
export const WS_BASE_URL = extra.wsBaseUrl || "ws://localhost:8001";

export const api = axios.create({ baseURL: API_BASE_URL });

api.interceptors.request.use(async (config) => {
  const token = await getAccessToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

/** Removes the stored session: tokens from secure storage, the profile from AsyncStorage. */
export async function clearSession() {
  await Promise.all([clearTokens(), AsyncStorage.removeItem(STORAGE_KEYS.user)]);
}

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(handler: () => void) {
  onUnauthorized = handler;
}

// Silent refresh, same as the web apps: a 401 first tries the refresh token,
// so riders stay signed in until they sign out. One refresh at a time.
let refreshPromise: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  const refresh = await getRefreshToken();
  if (!refresh) return null;
  try {
    const { data } = await axios.post(`${API_BASE_URL}/auth/token/refresh`, { refresh });
    // Refresh tokens rotate: keep the new one, or the next refresh would be refused.
    await saveTokens(data.access, data.refresh);
    return data.access as string;
  } catch {
    return null;
  }
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;
    if (error.response?.status === 401 && original && !original._retried) {
      original._retried = true;
      if (!refreshPromise) refreshPromise = refreshAccessToken().finally(() => { refreshPromise = null; });
      const newAccess = await refreshPromise;
      if (newAccess) {
        original.headers.Authorization = `Bearer ${newAccess}`;
        return api(original);
      }
      await clearSession();
      onUnauthorized?.();
    }
    return Promise.reject(error);
  }
);

export interface WolbiUser {
  id: string;
  phone: string;
  email: string | null;
  name: string;
  role: "passenger" | "driver" | "admin" | "support";
  otp_verified: boolean;
  profile_photo?: string;
  emergency_contact_name?: string;
  emergency_contact_phone?: string;
}

export interface SOSResult {
  incident_id: string;
  emergency_number: string;
  contact_notified: boolean;
}

export interface Vehicle {
  id: string;
  plate_number: string;
  vehicle_type: string;
  registration_document: string;
  photo: string;
  active: boolean;
}

export interface Driver {
  id: string;
  licence_number: string;
  licence_expiry: string | null;
  verification_status: "pending" | "verified" | "suspended" | "rejected";
  quality_score: string;
  is_online: boolean;
  current_zone: string | null;
  vehicles: Vehicle[];
  gender?: "" | "female" | "male";
  offers_quiet_ride?: boolean;
  has_luggage_space?: boolean;
  accessibility_trained?: boolean;
  accepts_deliveries?: boolean;
}

export interface FareQuote {
  distance_km: string;
  base_fare: string;
  per_km_charge: string;
  total: string;
  expires_at: string;
}

export interface Trip {
  id: string;
  passenger: string;
  driver: string | null;
  zone: string;
  status:
    | "requested"
    | "matching"
    | "matched"
    | "driver_arriving"
    | "in_progress"
    | "completed"
    | "cancelled"
    | "no_drivers_found";
  pickup_lat: string;
  pickup_lng: string;
  pickup_label: string;
  destination_lat: string;
  destination_lng: string;
  destination_label: string;
  fare_quote: FareQuote | null;
  fare_final: string | null;
  cancel_reason: string;
  cancelled_by: string;
  requested_at: string;
  matched_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  trip_type?: "ride" | "delivery";
  payment_method?: "cash" | "momo" | "organization" | "voucher" | "bundle";
  shareable?: boolean;
  pool_seat_fare?: string | null;
  pool_info?: {
    pool_group: string;
    open: boolean;
    rider_count: number;
    stops?: { type: "pickup" | "dropoff"; trip_id: string; first_name: string; label: string; lat: string; lng: string; done: boolean }[];
  } | null;
  delivery?: {
    recipient_name: string; recipient_phone: string; package_description: string; package_size: string;
    picked_up_at: string | null;
  } | null;
  rated_by_me?: boolean;
}

export interface ServiceZone {
  id: string;
  name: string;
  boundary: { min_lat: number; max_lat: number; min_lng: number; max_lng: number };
  base_fare: string;
  per_km_rate: string;
  active: boolean;
}

export interface Earnings {
  trips_completed_total: number;
  earnings_total: string;
  trips_completed_today: number;
  earnings_today: string;
}

export interface RideOffer {
  trip_id: string;
  pickup_label: string;
  destination_label: string;
  fare_estimate: string;
  timeout_seconds: number;
  kind?: "ride" | "delivery";
  trip_type?: "ride" | "delivery";
  package_description?: string;
  package_size?: string;
  pool_legs?: { type: "pickup" | "dropoff"; trip_id: string; first_name: string; label: string }[];
}
