import { NavLink, Outlet } from "react-router-dom";
import "./Shell.css";

const TABS = [
  { to: "/", label: "Ride", icon: "◈", end: true },
  { to: "/history", label: "History", icon: "☰" },
  { to: "/profile", label: "Profile", icon: "◐" },
];

export default function Shell() {
  return (
    <div className="app-shell">
      <div className="app-frame">
        <Outlet />
      </div>
      <nav className="tab-bar">
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) => "tab-item" + (isActive ? " tab-item-active" : "")}
          >
            <span className="tab-icon">{tab.icon}</span>
            <span>{tab.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
