import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import Layout from "./components/Layout";
import RequireAuth from "./components/RequireAuth";
import Drivers from "./pages/Drivers";
import Incidents from "./pages/Incidents";
import Overview from "./pages/Overview";
import SignIn from "./pages/SignIn";
import SignUp from "./pages/SignUp";
import Support from "./pages/Support";
import Trips from "./pages/Trips";
import Zones from "./pages/Zones";

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
                <Layout />
              </RequireAuth>
            }
          >
            <Route index element={<Overview />} />
            <Route path="drivers" element={<Drivers />} />
            <Route path="trips" element={<Trips />} />
            <Route path="incidents" element={<Incidents />} />
            <Route path="support" element={<Support />} />
            <Route path="zones" element={<Zones />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
