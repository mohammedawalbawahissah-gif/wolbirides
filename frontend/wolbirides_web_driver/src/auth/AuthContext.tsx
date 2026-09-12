import { createContext, useContext, useState, type ReactNode } from "react";
import { api, type WolbiUser } from "../api/client";

interface AuthContextValue {
  user: WolbiUser | null;
  requestSignupCode: (email: string) => Promise<void>;
  signup: (email: string, code: string, password: string, name: string) => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  refreshUser: () => Promise<void>;
  updateProfilePhoto: (url: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function loadStoredUser(): WolbiUser | null {
  const raw = localStorage.getItem("wolbirides_driver_user");
  return raw ? JSON.parse(raw) : null;
}

function storeSession(data: { access: string; refresh: string; user: WolbiUser }) {
  localStorage.setItem("wolbirides_driver_access", data.access);
  localStorage.setItem("wolbirides_driver_refresh", data.refresh);
  localStorage.setItem("wolbirides_driver_user", JSON.stringify(data.user));
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<WolbiUser | null>(loadStoredUser());

  async function requestSignupCode(email: string) {
    await api.post("/auth/email/otp/request", { email });
  }

  async function signup(email: string, code: string, password: string, name: string) {
    const { data } = await api.post("/auth/signup", { email, code, password, name, role: "driver" });
    storeSession(data);
    setUser(data.user);
  }

  async function login(email: string, password: string) {
    const { data } = await api.post("/auth/login", { email, password });
    storeSession(data);
    setUser(data.user);
  }

  async function refreshUser() {
    const { data } = await api.get("/passengers/me");
    localStorage.setItem("wolbirides_driver_user", JSON.stringify(data));
    setUser(data);
  }

  async function updateProfilePhoto(url: string) {
    const { data } = await api.patch("/passengers/me", { profile_photo: url });
    localStorage.setItem("wolbirides_driver_user", JSON.stringify(data));
    setUser(data);
  }

  function logout() {
    localStorage.removeItem("wolbirides_driver_access");
    localStorage.removeItem("wolbirides_driver_refresh");
    localStorage.removeItem("wolbirides_driver_user");
    setUser(null);
    window.location.href = "/signin";
  }

  return (
    <AuthContext.Provider
      value={{ user, requestSignupCode, signup, login, refreshUser, updateProfilePhoto, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
