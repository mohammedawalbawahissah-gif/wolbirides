import axios from "axios";

const BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000/api";

export const api = axios.create({ baseURL: BASE_URL });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("wolbirides_admin_access");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// On a 401, the token is either expired or invalid — bounce to login rather
// than let the dashboard sit in a half-authenticated state.
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem("wolbirides_admin_access");
      localStorage.removeItem("wolbirides_admin_refresh");
      localStorage.removeItem("wolbirides_admin_user");
      window.location.href = "/login";
    }
    return Promise.reject(error);
  }
);

export interface AdminUser {
  id: string;
  phone: string;
  name: string;
  role: "admin" | "support" | "driver" | "passenger";
  otp_verified: boolean;
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
  user?: AdminUser;
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
  status: string;
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

export interface Incident {
  id: string;
  trip: string | null;
  reported_by: string | null;
  severity: "p0" | "p1" | "p2" | "p3";
  status: "open" | "investigating" | "resolved";
  description: string;
  resolved_at: string | null;
  created_at: string;
}

export interface SupportTicket {
  id: string;
  user: string;
  category: string;
  status: "open" | "in_progress" | "resolved";
  subject: string;
  description: string;
  assigned_to: string | null;
  created_at: string;
}

export interface PickupPoint {
  id: string;
  name: string;
  latitude: string;
  longitude: string;
  is_campus_point: boolean;
}

export interface ServiceZone {
  id: string;
  name: string;
  boundary: Record<string, number>;
  base_fare: string;
  per_km_rate: string;
  active: boolean;
  pickup_points: PickupPoint[];
}

export interface DashboardSummary {
  drivers_online: number;
  drivers_pending_verification: number;
  trips_today: number;
  trips_completed_today: number;
  trips_cancelled_today: number;
  cancellation_rate_today: number | null;
  open_incidents: number;
  open_incidents_by_severity: Record<string, number>;
  open_support_tickets: number;
}
