import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import Layout from "./components/Layout";
import RequireAuth from "./components/RequireAuth";
import ForgotPassword from "./pages/ForgotPassword";
import SignIn from "./pages/SignIn";
import SignUp from "./pages/SignUp";

// Each dashboard page loads on first visit, so charts (Overview) and maps (Incidents)
// aren't downloaded at sign-in.
const Deliveries = lazy(() => import("./pages/Deliveries"));
const Drivers = lazy(() => import("./pages/Drivers"));
const Incidents = lazy(() => import("./pages/Incidents"));
const Bundles = lazy(() => import("./pages/Bundles"));
const Fairness = lazy(() => import("./pages/Fairness"));
const Organizations = lazy(() => import("./pages/Organizations"));
const Overview = lazy(() => import("./pages/Overview"));
const Partners = lazy(() => import("./pages/Partners"));
const Placements = lazy(() => import("./pages/Placements"));
const Trust = lazy(() => import("./pages/Trust"));
const Payouts = lazy(() => import("./pages/Payouts"));
const Support = lazy(() => import("./pages/Support"));
const Trips = lazy(() => import("./pages/Trips"));
const Zones = lazy(() => import("./pages/Zones"));

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Suspense fallback={<div className="empty-state" style={{ padding: 40 }}>Loading…</div>}>
        <Routes>
          <Route path="/signin" element={<SignIn />} />
          <Route path="/signup" element={<SignUp />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/login" element={<Navigate to="/signin" replace />} />

          <Route
            path="/"
            element={
              <RequireAuth>
                <Layout />
              </RequireAuth>
            }
          >
            <Route index element={<Overview />} />
            <Route path="drivers" element={<Drivers />} />
            <Route path="deliveries" element={<Deliveries />} />
            <Route path="trips" element={<Trips />} />
            <Route path="incidents" element={<Incidents />} />
            <Route path="payouts" element={<Payouts />} />
            <Route path="organizations" element={<Organizations />} />
            <Route path="bundles" element={<Bundles />} />
            <Route path="partners" element={<Partners />} />
            <Route path="fairness" element={<Fairness />} />
            <Route path="placements" element={<Placements />} />
            <Route path="trust" element={<Trust />} />
            <Route path="support" element={<Support />} />
            <Route path="zones" element={<Zones />} />
          </Route>
        </Routes>
        </Suspense>
      </BrowserRouter>
    </AuthProvider>
  );
}
