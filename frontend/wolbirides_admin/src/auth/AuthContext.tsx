import { createContext, useContext, useState, type ReactNode } from "react";
import { api, type AdminUser } from "../api/client";

interface AuthContextValue {
  user: AdminUser | null;
  requestOtp: (phone: string) => Promise<void>;
  verifyOtp: (phone: string, code: string) => Promise<void>;
  requestAccess: (phone: string, code: string, name: string) => Promise<{ granted: boolean }>;
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

  /**
   * "Sign up" for the ops dashboard is really "create an account (or verify
   * an existing one) and see whether it already has ops access." A brand
   * new OTP-verified account defaults to role='passenger' on the backend
   * (accounts/services.py), so this deliberately does NOT use the
   * admin-gated /admin/auth/otp/verify endpoint — it uses the regular one,
   * then checks the returned role itself, and only persists a session if
   * the account is actually admin/support. Otherwise nothing is stored:
   * the person needs an existing ops teammate to promote their role.
   */
  async function requestAccess(phone: string, code: string, name: string) {
    const { data } = await api.post("/auth/otp/verify", { phone, code });
    if (name.trim()) {
      try {
        await api.patch("/passengers/me", { name: name.trim() }, {
          headers: { Authorization: `Bearer ${data.access}` },
        });
      } catch {
        // Non-fatal — name can be set later once they have real access.
      }
    }
    if (data.user.role === "admin" || data.user.role === "support") {
      localStorage.setItem("wolbirides_admin_access", data.access);
      localStorage.setItem("wolbirides_admin_refresh", data.refresh);
      localStorage.setItem("wolbirides_admin_user", JSON.stringify(data.user));
      setUser(data.user);
      return { granted: true };
    }
    return { granted: false };
  }

  return (
    <AuthContext.Provider value={{ user, requestOtp, verifyOtp, requestAccess, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
