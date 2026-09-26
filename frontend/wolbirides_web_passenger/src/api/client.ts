import axios from "axios";

// Dev: talk to Django directly. Production builds (e.g. Docker) default to the
// same origin, where nginx proxies /api and /ws to the backend.
const BASE_URL = import.meta.env.VITE_API_BASE_URL || (import.meta.env.DEV ? "http://localhost:8001/api" : "/api");
const WS_BASE_URL =
  import.meta.env.VITE_WS_BASE_URL ||
  (import.meta.env.DEV ? "ws://localhost:8001" : `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`);

export { WS_BASE_URL };

export const api = axios.create({ baseURL: BASE_URL });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("wolbirides_access");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Silent-refresh: a 401 first tries /auth/token/refresh with the stored
// refresh token before giving up, so a short-lived access token doesn't
// force a re-login — the whole point of "stay signed in until you sign
// out" (WR UX overhaul, item 1). Only one refresh runs at a time; requests
// that arrive mid-refresh queue behind it instead of each firing their own.
let refreshPromise: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  const refresh = localStorage.getItem("wolbirides_refresh");
  if (!refresh) return null;
  try {
    const { data } = await axios.post(`${BASE_URL}/auth/token/refresh`, { refresh });
    localStorage.setItem("wolbirides_access", data.access);
    // Refresh tokens rotate: keep the new one, or the next refresh would be refused.
    if (data.refresh) localStorage.setItem("wolbirides_refresh", data.refresh);
    return data.access as string;
  } catch {
    // Another open tab may have refreshed first (rotation makes our copy stale). If it
    // saved a newer token, use that instead of signing this tab out.
    await new Promise((r) => setTimeout(r, 400));
    const latest = localStorage.getItem("wolbirides_refresh");
    if (latest && latest !== refresh) return localStorage.getItem("wolbirides_access");
    return null;
  }
}

function clearSessionAndRedirect() {
  localStorage.removeItem("wolbirides_access");
  localStorage.removeItem("wolbirides_refresh");
  localStorage.removeItem("wolbirides_user");
  window.location.href = "/signin";
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;
    if (error.response?.status === 401 && !original._retried) {
      original._retried = true;
      if (!refreshPromise) refreshPromise = refreshAccessToken().finally(() => { refreshPromise = null; });
      const newAccess = await refreshPromise;
      if (newAccess) {
        original.headers.Authorization = `Bearer ${newAccess}`;
        return api(original);
      }
      clearSessionAndRedirect();
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
  profile_photo: string;
  emergency_contact_name?: string;
  emergency_contact_phone?: string;
}

export interface SuggestedRide {
  pickup_label: string;
  pickup_lat: string;
  pickup_lng: string;
  destination_label: string;
  destination_lat: string;
  destination_lng: string;
  trip_count: number;
}

export interface RecurringRide {
  id: string;
  pickup: string;
  destination: string;
  pickup_detail: SavedAddress;
  destination_detail: SavedAddress;
  days_of_week: number[];
  time_of_day: string;
  active: boolean;
}

export interface NotificationPref {
  category: string;
  label: string;
  enabled: boolean;
}

export interface DraftTrip {
  pickup_label: string;
  pickup_lat: number;
  pickup_lng: number;
  destination_label: string;
  destination_lat: number;
  destination_lng: number;
}

export interface SOSResult {
  incident_id: string;
  emergency_number: string;
  contact_notified: boolean;
}

export interface SavedAddress {
  id: string;
  label: string;
  lat: string;
  lng: string;
  address_text: string;
  created_at: string;
}

export interface AppNotification {
  id: string;
  category: "trip" | "driver" | "incident" | "support" | "system";
  title: string;
  body: string;
  link: string;
  read: boolean;
  created_at: string;
}

export interface FareQuote {
  distance_km: string;
  base_fare: string;
  per_km_charge: string;
  surcharge?: string;
  discount?: string;
  discount_reason?: string;
  total: string;
  expires_at: string;
}

export interface TripVehicleBrief {
  plate_number: string;
  vehicle_type: string;
  photo: string;
}

export interface TripDriverBrief {
  id: string;
  name: string;
  phone: string;
  profile_photo: string;
  rating: string;
  verification_status: string;
  vehicle: TripVehicleBrief | null;
  current_lat: string | null;
  current_lng: string | null;
}

export interface Trip {
  id: string;
  passenger: string;
  driver: string | null;
  driver_detail: TripDriverBrief | null;
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
  kind?: "ride" | "delivery";
  payment_method?: "cash" | "momo" | "organization" | "voucher" | "bundle";
  organization_name?: string | null;
  recipient_name?: string;
  recipient_phone?: string;
  package_description?: string;
  delivery_code?: string | null;
  trip_type?: "ride" | "delivery";
  shareable?: boolean;
  rated_by_me?: boolean;
  pool_seat_fare?: string | null;
  pool_info?: { pool_group: string; open: boolean; rider_count: number } | null;
  preference_status?: "" | "awaiting_rider" | "keep_waiting" | "relaxed";
  delivery?: {
    recipient_name: string; recipient_phone: string; package_description: string; package_size: string;
    picked_up_at: string | null; pickup_code: string | null; dropoff_code: string | null;
  } | null;
}

export interface ServiceZone {
  id: string;
  name: string;
  boundary: { min_lat: number; max_lat: number; min_lng: number; max_lng: number };
  base_fare: string;
  per_km_rate: string;
  active: boolean;
  delivery_surcharge?: string;
  pool_max_riders?: number;
  pickup_points?: { id: string; name: string; latitude: string; longitude: string; sponsor_name?: string }[];
}
