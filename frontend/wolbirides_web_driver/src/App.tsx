import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import AppLayout from "./components/AppLayout";
import DriverGate from "./components/DriverGate";
import RequireAuth from "./components/RequireAuth";
import { ToastProvider } from "./components/Toast";
import ActiveTrip from "./pages/ActiveTrip";
import Earnings from "./pages/Earnings";
import Home from "./pages/Home";
import Profile from "./pages/Profile";
import ForgotPassword from "./pages/ForgotPassword";
import SignIn from "./pages/SignIn";
import SignUp from "./pages/SignUp";
import Trips from "./pages/Trips";

export default function App() {
  return (
    <ToastProvider>
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/signin" element={<SignIn />} />
          <Route path="/signup" element={<SignUp />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/login" element={<Navigate to="/signin" replace />} />

          <Route
            path="/"
            element={
              <RequireAuth>
                <DriverGate />
              </RequireAuth>
            }
          >
            <Route element={<AppLayout />}>
              <Route index element={<Home />} />
              <Route path="trips" element={<Trips />} />
              <Route path="earnings" element={<Earnings />} />
              <Route path="profile" element={<Profile />} />
            </Route>
            {/* Inside the gate (so dispatch keeps running) but outside the tab layout (full-screen trip view). */}
            <Route path="active-trip/:tripId" element={<ActiveTrip />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
    </ToastProvider>
  );
}
