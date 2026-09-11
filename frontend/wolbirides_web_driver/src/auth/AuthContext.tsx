import { createContext, useContext, useState, type ReactNode } from "react";
import { api, type WolbiUser } from "../api/client";

interface AuthContextValue {
  user: WolbiUser | null;
  requestOtp: (phone: string) => Promise<void>;
  verifyOtp: (phone: string, code: string) => Promise<void>;
  refreshUser: () => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function loadStoredUser(): WolbiUser | null {
  const raw = localStorage.getItem("wolbirides_driver_user");
  return raw ? JSON.parse(raw) : null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<WolbiUser | null>(loadStoredUser());

  async function requestOtp(phone: string) {
    await api.post("/auth/otp/request", { phone });
  }

  async function verifyOtp(phone: string, code: string) {
    const { data } = await api.post("/auth/otp/verify", { phone, code });
    localStorage.setItem("wolbirides_driver_access", data.access);
    localStorage.setItem("wolbirides_driver_refresh", data.refresh);
    localStorage.setItem("wolbirides_driver_user", JSON.stringify(data.user));
    setUser(data.user);
  }

  async function refreshUser() {
    const { data } = await api.get("/passengers/me");
    localStorage.setItem("wolbirides_driver_user", JSON.stringify(data));
    setUser(data);
  }

  function logout() {
    localStorage.removeItem("wolbirides_driver_access");
    localStorage.removeItem("wolbirides_driver_refresh");
    localStorage.removeItem("wolbirides_driver_user");
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, requestOtp, verifyOtp, refreshUser, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
