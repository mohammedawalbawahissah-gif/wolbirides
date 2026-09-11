import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import Layout from "./components/Layout";
import RequireAuth from "./components/RequireAuth";
import Drivers from "./pages/Drivers";
import Incidents from "./pages/Incidents";
import Login from "./pages/Login";
import Overview from "./pages/Overview";
import Support from "./pages/Support";
import Trips from "./pages/Trips";
import Zones from "./pages/Zones";

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
