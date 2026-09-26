import { createContext, useContext, useState, type ReactNode } from "react";
import { api, type AdminUser } from "../api/client";

interface AuthContextValue {
  user: AdminUser | null;
  login: (email: string, password: string) => Promise<void>;
  requestSignupCode: (email: string) => Promise<void>;
  requestAccess: (email: string, code: string, password: string, name: string) => Promise<{ granted: boolean }>;
  updateProfilePhoto: (url: string) => Promise<void>;
  logout: () => void;
  resetPassword: (email: string, code: string, newPassword: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function loadStoredUser(): AdminUser | null {
  const raw = localStorage.getItem("wolbirides_admin_user");
  return raw ? JSON.parse(raw) : null;
}

function storeSession(data: { access: string; refresh: string; user: AdminUser }) {
  localStorage.setItem("wolbirides_admin_access", data.access);
  localStorage.setItem("wolbirides_admin_refresh", data.refresh);
  localStorage.setItem("wolbirides_admin_user", JSON.stringify(data.user));
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AdminUser | null>(loadStoredUser());

  async function login(email: string, password: string) {
    const { data } = await api.post("/admin/auth/login", { email, password });
    storeSession(data);
    setUser(data.user);
  }

  async function requestSignupCode(email: string) {
    await api.post("/auth/email/otp/request", { email });
  }

  /**
   * A brand new email+OTP account defaults to role='passenger' on the
   * backend — this deliberately signs up through the regular endpoint,
   * then tries an admin login with the same credentials. Only an account
   * an existing admin has since promoted to admin/support will succeed;
   * otherwise nothing is stored and the caller shows "ask an admin".
   */
  async function requestAccess(email: string, code: string, password: string, name: string) {
    await api.post("/auth/signup", { email, code, password, name, role: "passenger" });
    try {
      const { data } = await api.post("/admin/auth/login", { email, password });
      storeSession(data);
      setUser(data.user);
      return { granted: true };
    } catch {
      return { granted: false };
    }
  }

  async function updateProfilePhoto(url: string) {
    const { data } = await api.patch("/passengers/me", { profile_photo: url });
    localStorage.setItem("wolbirides_admin_user", JSON.stringify(data));
    setUser(data);
  }

  async function resetPassword(email: string, code: string, newPassword: string) {
    const { data } = await api.post("/auth/password/reset/confirm", { email, code, new_password: newPassword });
    // Same rule as the admin sign-in: only staff accounts get into the dashboard.
    if (!["admin", "support"].includes(data.user?.role)) {
      throw new Error("Your password was changed, but this account isn't set up for the admin dashboard.");
    }
    storeSession(data);
    setUser(data.user);
  }

  function logout() {
    localStorage.removeItem("wolbirides_admin_access");
    localStorage.removeItem("wolbirides_admin_refresh");
    localStorage.removeItem("wolbirides_admin_user");
    setUser(null);
    window.location.href = "/signin";
  }

  return (
    <AuthContext.Provider
      value={{ user, login, requestSignupCode, requestAccess, updateProfilePhoto, logout, resetPassword }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react/only-export-components -- exports this module's hook/helpers next to its component (standard pattern); only affects dev hot-reload
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
