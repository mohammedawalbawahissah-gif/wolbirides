import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import AppLayout from "./components/AppLayout";
import RequireAuth from "./components/RequireAuth";
import { ToastProvider } from "./components/Toast";
import ForgotPassword from "./pages/ForgotPassword";
import SignIn from "./pages/SignIn";
import SignUp from "./pages/SignUp";

// Pages load on first visit. Mainly for the public trip-share page: someone opening a
// shared link on mobile data gets that page and the map, not the whole passenger app.
const BookRide = lazy(() => import("./pages/BookRide"));
const History = lazy(() => import("./pages/History"));
const Home = lazy(() => import("./pages/Home"));
const Profile = lazy(() => import("./pages/Profile"));
const RateDriver = lazy(() => import("./pages/RateDriver"));
const SharedTrip = lazy(() => import("./pages/SharedTrip"));
const Support = lazy(() => import("./pages/Support"));
const TripStatus = lazy(() => import("./pages/TripStatus"));

export default function App() {
  return (
    <ToastProvider>
    <AuthProvider>
      <BrowserRouter>
        <Suspense fallback={<div className="screen"><div className="empty-state">Loading…</div></div>}>
        <Routes>
          <Route path="/signin" element={<SignIn />} />
          <Route path="/signup" element={<SignUp />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/share/:token" element={<SharedTrip />} />
          <Route path="/login" element={<Navigate to="/signin" replace />} />

          <Route
            path="/"
            element={
              <RequireAuth>
                <AppLayout />
              </RequireAuth>
            }
          >
            <Route index element={<Home />} />
            <Route path="book" element={<BookRide />} />
            <Route path="rate" element={<RateDriver />} />
            <Route path="support" element={<Support />} />
            <Route path="history" element={<History />} />
            <Route path="profile" element={<Profile />} />
          </Route>

          <Route
            path="/trip/:tripId"
            element={
              <RequireAuth>
                <TripStatus />
              </RequireAuth>
            }
          />
        </Routes>
        </Suspense>
      </BrowserRouter>
    </AuthProvider>
    </ToastProvider>
  );
}
