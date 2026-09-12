import axios from "axios";

const BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000/api";
const WS_BASE_URL = import.meta.env.VITE_WS_BASE_URL || "ws://localhost:8000";

export { WS_BASE_URL };

export const api = axios.create({ baseURL: BASE_URL });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("wolbirides_driver_access");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Silent-refresh: a 401 first tries /auth/token/refresh with the stored
// refresh token before giving up, so a short-lived access token doesn't
// force a re-login — "stay signed in until you sign out" (WR UX overhaul).
let refreshPromise: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  const refresh = localStorage.getItem("wolbirides_driver_refresh");
  if (!refresh) return null;
  try {
    const { data } = await axios.post(`${BASE_URL}/auth/token/refresh`, { refresh });
    localStorage.setItem("wolbirides_driver_access", data.access);
    return data.access as string;
  } catch {
    return null;
  }
}

function clearSessionAndRedirect() {
  localStorage.removeItem("wolbirides_driver_access");
  localStorage.removeItem("wolbirides_driver_refresh");
  localStorage.removeItem("wolbirides_driver_user");
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
}
