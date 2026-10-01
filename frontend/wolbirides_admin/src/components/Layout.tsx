import { Navigate, NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import AssistantPanel from "./AssistantPanel";
import NotificationBell from "./NotificationBell";
import "./Layout.css";

const NAV_ITEMS = [
  { to: "/", label: "Overview", end: true, support: true },
  { to: "/drivers", label: "Riders" },
  { to: "/deliveries", label: "Deliveries", support: true },
  { to: "/trips", label: "Trips", support: true },
  { to: "/incidents", label: "Incidents", support: true },
  { to: "/payouts", label: "Payouts" },
  { to: "/organizations", label: "Organizations" },
  { to: "/bundles", label: "Bundles" },
  { to: "/partners", label: "Partners" },
  { to: "/placements", label: "Placements" },
  { to: "/fairness", label: "Fairness" },
  { to: "/trust", label: "Trust" },
  { to: "/support", label: "Support", support: true },
  { to: "/zones", label: "Zones" },
];

// Support staff get the day-to-day operations pages (the backend enforces the same split:
// core.permissions.IsStaffRole vs IsAdminRole). Money and configuration are admin-only.
const SUPPORT_PATHS = NAV_ITEMS.filter((i) => i.support).map((i) => i.to);

export default function Layout() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const isAdmin = user?.role === "admin";
  const items = isAdmin ? NAV_ITEMS : NAV_ITEMS.filter((i) => i.support);

  if (!isAdmin && !SUPPORT_PATHS.includes(location.pathname)) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <img src="/favicon.svg" alt="WolbiRides" className="brand-mark" />
          <span className="brand-name">WolbiRides</span>
          <div className="sidebar-bell">
            <NotificationBell />
          </div>
        </div>
        <nav className="nav">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => "nav-link" + (isActive ? " nav-link-active" : "")}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="account">
            <div className="account-avatar-sm">
              {user?.profile_photo ? (
                <img src={user.profile_photo} alt="" />
              ) : (
                (user?.name || user?.email || user?.phone || "?")[0].toUpperCase()
              )}
            </div>
            <div>
              <div className="account-name">{user?.name || user?.email || user?.phone}</div>
              <div className="account-role">admin</div>
            </div>
          </div>
          <button className="logout-btn" onClick={logout}>
            Log out
          </button>
        </div>
      </aside>
      <main className="content">
        <Outlet />
      </main>

      <AssistantPanel greeting="Hi! Ask me about dashboard metrics, rider verification, or incident severity." />
    </div>
  );
}
