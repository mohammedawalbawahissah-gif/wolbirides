import axios from "axios";

const BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000/api";
const WS_BASE_URL = import.meta.env.VITE_WS_BASE_URL || "ws://localhost:8000";

export { WS_BASE_URL };

export const api = axios.create({ baseURL: BASE_URL });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("wolbirides_access");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem("wolbirides_access");
      localStorage.removeItem("wolbirides_refresh");
      localStorage.removeItem("wolbirides_user");
      window.location.href = "/login";
    }
    return Promise.reject(error);
  }
);

export interface WolbiUser {
  id: string;
  phone: string;
  name: string;
  role: "passenger" | "driver" | "admin" | "support";
  otp_verified: boolean;
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
