import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
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
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate("/login");
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">WR</span>
          <span className="brand-name">WolbiRides</span>
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
            <div className="account-name">{user?.name || user?.phone}</div>
            <div className="account-role">{user?.role}</div>
          </div>
          <button className="logout-btn" onClick={handleLogout}>
            Log out
          </button>
        </div>
      </aside>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
