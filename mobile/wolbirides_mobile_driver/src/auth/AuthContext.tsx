import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, clearSession, setUnauthorizedHandler, type WolbiUser } from "../api/client";
import { APP_ROLE, STORAGE_KEYS } from "../appConfig";
import { unregisterPush } from "../push";
import { saveTokens } from "../tokenStore";

interface AuthContextValue {
  user: WolbiUser | null;
  loading: boolean;
  requestSignupCode: (email: string) => Promise<void>;
  signup: (email: string, code: string, password: string, name: string) => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  resetPassword: (email: string, code: string, newPassword: string) => Promise<void>;
  updateProfile: (fields: Partial<WolbiUser>) => Promise<void>;
  refreshUser: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** Email + password, same accounts and endpoints as the web apps. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<WolbiUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEYS.user).then((raw) => {
      if (raw) setUser(JSON.parse(raw));
      setLoading(false);
    });
    setUnauthorizedHandler(() => setUser(null));
  }, []);

  async function storeSession(data: { access: string; refresh: string; user: WolbiUser }) {
    // setItem one key at a time: works on async-storage 2.x (your pinned 2.2.0) and 3.x.
    await Promise.all([
      saveTokens(data.access, data.refresh),
      AsyncStorage.setItem(STORAGE_KEYS.user, JSON.stringify(data.user)),
    ]);
    setUser(data.user);
  }

  async function saveUser(data: WolbiUser) {
    await AsyncStorage.setItem(STORAGE_KEYS.user, JSON.stringify(data));
    setUser(data);
  }

  async function requestSignupCode(email: string) {
    await api.post("/auth/email/otp/request", { email });
  }

  async function signup(email: string, code: string, password: string, name: string) {
    const { data } = await api.post("/auth/signup", { email, code, password, name, role: APP_ROLE });
    await storeSession(data);
  }

  async function login(email: string, password: string) {
    const { data } = await api.post("/drivers/auth/login", { email, password }); // role-gated: see DriverLoginView
    await storeSession(data);
  }

  async function resetPassword(email: string, code: string, newPassword: string) {
    const { data } = await api.post("/auth/password/reset/confirm", { email, code, new_password: newPassword });
    await storeSession(data);
  }

  async function updateProfile(fields: Partial<WolbiUser>) {
    const { data } = await api.patch("/passengers/me", fields);
    await saveUser(data);
  }

  async function refreshUser() {
    const { data } = await api.get("/passengers/me");
    await saveUser(data);
  }

  async function logout() {
    await unregisterPush();
    await clearSession();
    setUser(null);
  }

  return (
    <AuthContext.Provider
      value={{ user, loading, requestSignupCode, signup, login, updateProfile, refreshUser, logout, resetPassword }}
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
