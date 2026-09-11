import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import DriverGate from "./components/DriverGate";
import RequireAuth from "./components/RequireAuth";
import Shell from "./components/Shell";
import "./components/Shell.css";
import ActiveTrip from "./pages/ActiveTrip";
import Earnings from "./pages/Earnings";
import Home from "./pages/Home";
import Login from "./pages/Login";
import Profile from "./pages/Profile";
import Trips from "./pages/Trips";

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/"
            element={
              <RequireAuth>
                <DriverGate />
              </RequireAuth>
            }
          >
            <Route element={<Shell />}>
              <Route index element={<Home />} />
              <Route path="trips" element={<Trips />} />
              <Route path="earnings" element={<Earnings />} />
              <Route path="profile" element={<Profile />} />
            </Route>
          </Route>
          <Route
            path="/active-trip/:tripId"
            element={
              <RequireAuth>
                <ActiveTrip />
              </RequireAuth>
            }
          />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
