import { useEffect, useState } from "react";
import { Outlet, useOutletContext } from "react-router-dom";
import { api, type Driver } from "../api/client";
import Apply from "../pages/Apply";
import Pending from "../pages/Pending";

interface DriverContext {
  driver: Driver;
  setDriver: (d: Driver) => void;
}

export function useDriverContext() {
  return useOutletContext<DriverContext>();
}

export default function DriverGate() {
  const [driver, setDriver] = useState<Driver | null | "loading">("loading");

  function load() {
    api
      .get<Driver>("/drivers/me")
      .then(({ data }) => setDriver(data))
      .catch((err) => {
        if (err?.response?.status === 404) {
          setDriver(null); // no driver profile yet — needs to apply
        }
      });
  }

  useEffect(load, []);

  if (driver === "loading") {
    return <div className="screen"><div className="empty-state">Loading…</div></div>;
  }

  if (driver === null) {
    return <Apply onApplied={load} />;
  }

  if (driver.verification_status === "pending" || driver.verification_status === "rejected") {
    return <Pending licenceNumber={driver.licence_number} />;
  }

  return <Outlet context={{ driver, setDriver: setDriver } satisfies DriverContext} />;
}
