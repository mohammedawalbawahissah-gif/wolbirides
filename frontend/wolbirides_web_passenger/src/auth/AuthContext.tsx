import { createContext, useContext, useState, type ReactNode } from "react";
import { api, type WolbiUser } from "../api/client";

interface AuthContextValue {
  user: WolbiUser | null;
  requestSignupCode: (email: string) => Promise<void>;
  signup: (email: string, code: string, password: string, name: string) => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  updateName: (name: string) => Promise<void>;
  updateProfilePhoto: (url: string) => Promise<void>;
  updateProfile: (fields: Partial<WolbiUser>) => Promise<void>;
  logout: () => void;
  resetPassword: (email: string, code: string, newPassword: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function loadStoredUser(): WolbiUser | null {
  const raw = localStorage.getItem("wolbirides_user");
  return raw ? JSON.parse(raw) : null;
}

function storeSession(data: { access: string; refresh: string; user: WolbiUser }) {
  localStorage.setItem("wolbirides_access", data.access);
  localStorage.setItem("wolbirides_refresh", data.refresh);
  localStorage.setItem("wolbirides_user", JSON.stringify(data.user));
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<WolbiUser | null>(loadStoredUser());

  async function requestSignupCode(email: string) {
    await api.post("/auth/email/otp/request", { email });
  }

  async function signup(email: string, code: string, password: string, name: string) {
    const { data } = await api.post("/auth/signup", { email, code, password, name, role: "passenger" });
    storeSession(data);
    setUser(data.user);
  }

  async function login(email: string, password: string) {
    const { data } = await api.post("/auth/login", { email, password });
    storeSession(data);
    setUser(data.user);
  }

  async function updateName(name: string) {
    const { data } = await api.patch("/passengers/me", { name });
    localStorage.setItem("wolbirides_user", JSON.stringify(data));
    setUser(data);
  }

  async function updateProfilePhoto(url: string) {
    const { data } = await api.patch("/passengers/me", { profile_photo: url });
    localStorage.setItem("wolbirides_user", JSON.stringify(data));
    setUser(data);
  }

  async function updateProfile(fields: Partial<WolbiUser>) {
    const { data } = await api.patch("/passengers/me", fields);
    localStorage.setItem("wolbirides_user", JSON.stringify(data));
    setUser(data);
  }

  async function resetPassword(email: string, code: string, newPassword: string) {
    const { data } = await api.post("/auth/password/reset/confirm", { email, code, new_password: newPassword });
    storeSession(data);
    setUser(data.user);
  }

  function logout() {
    localStorage.removeItem("wolbirides_access");
    localStorage.removeItem("wolbirides_refresh");
    localStorage.removeItem("wolbirides_user");
    setUser(null);
    window.location.href = "/signin";
  }

  return (
    <AuthContext.Provider
      value={{ user, requestSignupCode, signup, login, updateName, updateProfilePhoto, updateProfile, logout, resetPassword }}
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
