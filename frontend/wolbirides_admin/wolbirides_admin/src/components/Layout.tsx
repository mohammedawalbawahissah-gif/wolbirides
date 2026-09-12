import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import AssistantPanel from "./AssistantPanel";
import NotificationBell from "./NotificationBell";
import "./Layout.css";

const NAV_ITEMS = [
  { to: "/", label: "Overview", end: true },
  { to: "/drivers", label: "Drivers" },
  { to: "/trips", label: "Trips" },
  { to: "/incidents", label: "Incidents" },
  { to: "/support", label: "Support" },
  { to: "/zones", label: "Zones" },
];

export default function Layout() {
  const { user, logout } = useAuth();

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">WR</span>
          <span className="brand-name">WolbiRides</span>
          <div className="sidebar-bell">
            <NotificationBell />
          </div>
        </div>
        <nav className="nav">
          {NAV_ITEMS.map((item) => (
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
              <div className="account-role">{user?.role}</div>
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

      <AssistantPanel greeting="Hi! Ask me about dashboard metrics, driver verification, or incident severity." />
    </div>
  );
}
