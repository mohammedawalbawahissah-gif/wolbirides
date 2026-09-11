import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import AppLayout from "./components/AppLayout";
import RequireAuth from "./components/RequireAuth";
import History from "./pages/History";
import Home from "./pages/Home";
import Profile from "./pages/Profile";
import SignIn from "./pages/SignIn";
import SignUp from "./pages/SignUp";
import TripStatus from "./pages/TripStatus";

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/signin" element={<SignIn />} />
          <Route path="/signup" element={<SignUp />} />
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
      </BrowserRouter>
    </AuthProvider>
  );
}
