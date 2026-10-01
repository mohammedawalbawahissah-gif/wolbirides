import axios from "axios";

// Dev: talk to Django directly. Production builds (e.g. Docker) default to the
// same origin, where nginx proxies /api and /ws to the backend.
const BASE_URL = import.meta.env.VITE_API_BASE_URL || (import.meta.env.DEV ? "http://localhost:8001/api" : "/api");
const WS_BASE_URL =
  import.meta.env.VITE_WS_BASE_URL ||
  (import.meta.env.DEV ? "ws://localhost:8001" : `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`);

export { WS_BASE_URL };

export const api = axios.create({ baseURL: BASE_URL });

/** What to tell a person when a request fails. "No response at all" is a connection problem, never a wrong password. */
export function requestErrorMessage(err: any, fallback: string): string {
  if (!err?.response) return "Can't reach the WolbiRides server. Check your connection and that the backend is running.";
  const { status, data } = err.response;
  if (status >= 500) return "The server had a problem. Try again in a moment.";
  if (data && typeof data === "object") return data.detail || fallback;
  return `The server sent an unexpected reply (${status}). Check that the app points at the WolbiRides backend.`;
}


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
    // Refresh tokens rotate: keep the new one, or the next refresh would be refused.
    if (data.refresh) localStorage.setItem("wolbirides_driver_refresh", data.refresh);
    return data.access as string;
  } catch {
    // Another open tab may have refreshed first (rotation makes our copy stale). If it
    // saved a newer token, use that instead of signing this tab out.
    await new Promise((r) => setTimeout(r, 400));
    const latest = localStorage.getItem("wolbirides_driver_refresh");
    if (latest && latest !== refresh) return localStorage.getItem("wolbirides_driver_access");
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
  emergency_contact_name?: string;
  emergency_contact_phone?: string;
}

export interface SOSResult {
  incident_id: string;
  emergency_number: string;
  contact_notified: boolean;
}

export interface PayoutLineItem {
  trip_id: string;
  fare: string;
  commission: string;
  net: string;
  completed_at?: string;
}

export interface Payout {
  id: string;
  period_start: string;
  period_end: string;
  amount: string;
  status: "pending" | "approved" | "paid" | "failed";
  commission_rate_snapshot: string | null;
  line_items: PayoutLineItem[];
  failure_reason: string;
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
  licence_document?: string;
  emergency_contact_name?: string;
  emergency_contact_phone?: string;
  payout_phone?: string;
  payout_provider?: "momo" | "hubtel";
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
  payment_method?: "cash" | "momo" | "organization" | "voucher" | "bundle";
  trip_type?: "ride" | "delivery";
  shareable?: boolean;
  rated_by_me?: boolean;
  pool_seat_fare?: string | null;
  pool_info?: {
    pool_group: string;
    open: boolean;
    passenger_count: number;
    stops?: { type: "pickup" | "dropoff"; trip_id: string; first_name: string; label: string; done: boolean }[];
  } | null;
  delivery?: {
    delivery_subtype: "parcel" | "errand" | "vendor_order";
    sender_name: string; sender_phone: string;
    recipient_name: string; recipient_phone: string; package_description: string; package_size: string;
    task_description: string; spend_limit: string | null;
    vendor: { id: string; name: string; location_label: string; phone: string } | null;
    picked_up_at: string | null;
  } | null;
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
