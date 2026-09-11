import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import RequireAuth from "./components/RequireAuth";
import Shell from "./components/Shell";
import "./components/Shell.css";
import History from "./pages/History";
import Home from "./pages/Home";
import Login from "./pages/Login";
import Profile from "./pages/Profile";
import TripStatus from "./pages/TripStatus";

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
                <Shell />
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
                <div className="app-shell">
                  <div className="app-frame" style={{ paddingBottom: 24 }}>
                    <TripStatus />
                  </div>
                </div>
              </RequireAuth>
            }
          />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
