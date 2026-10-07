import AsyncStorage from "@react-native-async-storage/async-storage";
import axios from "axios";
import Constants from "expo-constants";
import { STORAGE_KEYS } from "../appConfig";
import { clearTokens, getAccessToken, getRefreshToken, saveTokens } from "../tokenStore";

// Expo env vars come through app.json's "extra" block (import.meta.env is Vite-only).
const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, string>;

// While developing, the backend runs on the same computer as the Expo dev server, so use the address this
// app was loaded from. A fixed address (say a phone hotspot's 172.20.10.x) stops working the moment the
// computer is given a different one, and then every request fails. Released builds use app.json's address.
const devHost = __DEV__ ? Constants.expoConfig?.hostUri?.split(":")[0] : undefined;
const useDevHost = !!devHost && /^\d{1,3}(\.\d{1,3}){3}$/.test(devHost) && !extra.apiBaseUrl?.startsWith("https://");
export const API_BASE_URL = useDevHost ? `http://${devHost}:8001/api` : extra.apiBaseUrl || "http://localhost:8001/api";
export const WS_BASE_URL = useDevHost ? `ws://${devHost}:8001` : extra.wsBaseUrl || "ws://localhost:8001";

/** What to tell a person when a request fails. "No response at all" is a connection problem, never a wrong password. */
export function requestErrorMessage(err: any, fallback: string): string {
  if (!err?.response) {
    const server = API_BASE_URL.replace(/^https?:\/\//, "").replace(/\/api$/, "");
    return `Can't reach the WolbiRides server (${server}). Check that your phone and computer are on the same network and the backend is running.`;
  }
  const { status, data } = err.response;
  if (status >= 500) return "The server had a problem. Try again in a moment.";
  if (data && typeof data === "object") return data.detail || fallback;
  return `The server sent an unexpected reply (${status}). Check that the app points at the WolbiRides backend.`;
}

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
// so passengers stay signed in until they sign out. One refresh at a time.
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
  roadworthy_certificate?: string;
  roadworthy_expiry?: string | null;
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
  licence_document?: string;
  emergency_contact_name?: string;
  emergency_contact_phone?: string;
  payout_phone?: string;
  payout_provider?: "momo" | "hubtel";
  // LI 2519 commercial rider details (only ever returned to the rider and admins).
  ghana_card_number?: string;
  ghana_card_document?: string;
  transport_union?: string;
  union_membership_number?: string;
  union_card_document?: string;
  compliance_missing?: string[];
}

export interface RiderPassPlan {
  id: string;
  name: string;
  duration_days: number;
  price: string;
}

export interface RiderPass {
  id: string;
  source: "trial" | "momo" | "cash" | "grant";
  status: "pending_payment" | "active" | "expired" | "cancelled";
  plan: string | null;
  duration_days: number;
  price_paid: string;
  starts_at: string | null;
  expires_at: string | null;
}

export interface RiderPassStatus {
  required: boolean;
  can_go_online: boolean;
  trial_available: boolean;
  trial_days: number;
  current: RiderPass | null;
  paid_until: string | null;
  plans: RiderPassPlan[];
  recent: RiderPass[];
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
    passenger_count: number;
    stops?: { type: "pickup" | "dropoff"; trip_id: string; first_name: string; label: string; lat: string; lng: string; done: boolean }[];
  } | null;
  delivery?: {
    delivery_subtype: "parcel" | "errand" | "vendor_order";
    sender_name: string; sender_phone: string;
    recipient_name: string; recipient_phone: string; package_description: string; package_size: string;
    task_description: string; spend_limit: string | null;
    vendor: { id: string; name: string; location_label: string; phone: string } | null;
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
  expires_at?: string;
  admin_offer?: boolean;
  kind?: "ride" | "delivery";
  trip_type?: "ride" | "delivery";
  delivery_subtype?: "parcel" | "errand" | "vendor_order";
  package_description?: string;
  package_size?: string;
  task_description?: string;
  spend_limit?: string | null;
  vendor_name?: string;
  pool_legs?: { type: "pickup" | "dropoff"; trip_id: string; first_name: string; label: string }[];
}
