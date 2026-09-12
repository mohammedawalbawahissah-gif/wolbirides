import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { ActivityIndicator, View } from "react-native";
import { api, type Driver } from "../api/client";
import { colors } from "../theme";
import ApplyScreen from "../screens/ApplyScreen";
import PendingScreen from "../screens/PendingScreen";

interface DriverContextValue {
  driver: Driver;
  setDriver: (d: Driver) => void;
}

const DriverContext = createContext<DriverContextValue | null>(null);

export function useDriverContext() {
  const ctx = useContext(DriverContext);
  if (!ctx) throw new Error("useDriverContext must be used within DriverGate");
  return ctx;
}

export default function DriverGate({ children }: { children: ReactNode }) {
  const [driver, setDriver] = useState<Driver | null | "loading">("loading");

  function load() {
    api
      .get<Driver>("/drivers/me")
      .then(({ data }) => setDriver(data))
      .catch((err) => {
        if (err?.response?.status === 404) {
          setDriver(null);
        }
      });
  }

  useEffect(load, []);

  if (driver === "loading") {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.paper }}>
        <ActivityIndicator size="large" color={colors.navyInk} />
      </View>
    );
  }

  if (driver === null) {
    return <ApplyScreen onApplied={load} />;
  }

  if (driver.verification_status === "pending" || driver.verification_status === "rejected") {
    return <PendingScreen licenceNumber={driver.licence_number} />;
  }

  return <DriverContext.Provider value={{ driver, setDriver }}>{children}</DriverContext.Provider>;
}
