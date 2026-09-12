import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import AssistantPanel from "./AssistantPanel";
import NotificationBell from "./NotificationBell";
import "./AppLayout.css";

const NAV_ITEMS = [
  { to: "/", label: "Ride", end: true },
  { to: "/history", label: "History" },
];

export default function AppLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  function handleLogout() {
    logout();
    navigate("/signin");
  }

  return (
    <div className="app-layout">
      <header className="topbar">
        <div className="topbar-inner">
          <NavLink to="/" className="topbar-brand">
            <span className="brand-mark">WR</span>
            <span className="brand-name">WolbiRides</span>
          </NavLink>

          <nav className="topbar-nav">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => "topbar-link" + (isActive ? " topbar-link-active" : "")}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="topbar-account">
            <NotificationBell />
            <button className="account-button" onClick={() => setMenuOpen((o) => !o)}>
              <span className="account-avatar">
                {user?.profile_photo ? (
                  <img src={user.profile_photo} alt="" />
                ) : (
                  (user?.name || user?.email || user?.phone || "?")[0].toUpperCase()
                )}
              </span>
              <span className="account-name-label">{user?.name || user?.email || user?.phone}</span>
            </button>
            {menuOpen && (
              <div className="account-menu" onMouseLeave={() => setMenuOpen(false)}>
                <NavLink to="/profile" className="account-menu-item" onClick={() => setMenuOpen(false)}>
                  Profile
                </NavLink>
                <button className="account-menu-item account-menu-item-danger" onClick={handleLogout}>
                  Log out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="app-main">
        <Outlet />
      </main>

      <AssistantPanel greeting="Hi! Ask me about booking a ride, fares, or how WolbiRides works." />
    </div>
  );
}
