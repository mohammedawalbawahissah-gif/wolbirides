import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, setUnauthorizedHandler, type WolbiUser } from "../api/client";

interface AuthContextValue {
  user: WolbiUser | null;
  loading: boolean;
  requestOtp: (phone: string) => Promise<void>;
  verifyOtp: (phone: string, code: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<WolbiUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    AsyncStorage.getItem("wolbirides_driver_user").then((raw) => {
      if (raw) setUser(JSON.parse(raw));
      setLoading(false);
    });
    setUnauthorizedHandler(() => setUser(null));
  }, []);

  async function requestOtp(phone: string) {
    await api.post("/auth/otp/request", { phone });
  }

  async function verifyOtp(phone: string, code: string) {
    const { data } = await api.post("/auth/otp/verify", { phone, code });
    await AsyncStorage.setMany({
      wolbirides_driver_access: data.access,
      wolbirides_driver_refresh: data.refresh,
      wolbirides_driver_user: JSON.stringify(data.user),
    });
    setUser(data.user);
  }

  async function logout() {
    await AsyncStorage.removeMany(["wolbirides_driver_access", "wolbirides_driver_refresh", "wolbirides_driver_user"]);
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, requestOtp, verifyOtp, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
