import { createContext, useContext, useState, type ReactNode } from "react";
import { api, type AdminUser } from "../api/client";

interface AuthContextValue {
  user: AdminUser | null;
  requestOtp: (phone: string) => Promise<void>;
  verifyOtp: (phone: string, code: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function loadStoredUser(): AdminUser | null {
  const raw = localStorage.getItem("wolbirides_admin_user");
  return raw ? JSON.parse(raw) : null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AdminUser | null>(loadStoredUser());

  async function requestOtp(phone: string) {
    await api.post("/auth/otp/request", { phone });
  }

  async function verifyOtp(phone: string, code: string) {
    const { data } = await api.post("/admin/auth/otp/verify", { phone, code });
    localStorage.setItem("wolbirides_admin_access", data.access);
    localStorage.setItem("wolbirides_admin_refresh", data.refresh);
    localStorage.setItem("wolbirides_admin_user", JSON.stringify(data.user));
    setUser(data.user);
  }

  function logout() {
    localStorage.removeItem("wolbirides_admin_access");
    localStorage.removeItem("wolbirides_admin_refresh");
    localStorage.removeItem("wolbirides_admin_user");
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, requestOtp, verifyOtp, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
