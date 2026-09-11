import { NavLink, Outlet, useOutletContext } from "react-router-dom";
import "./Shell.css";

const TABS = [
  { to: "/", label: "Drive", icon: "◈", end: true },
  { to: "/trips", label: "Trips", icon: "☰" },
  { to: "/earnings", label: "Earnings", icon: "◆" },
  { to: "/profile", label: "Profile", icon: "◐" },
];

export default function Shell() {
  // Forward DriverGate's outlet context through to the tab pages — Outlet
  // does not pass context to further-nested Outlets automatically.
  const context = useOutletContext();

  return (
    <div className="app-shell">
      <div className="app-frame">
        <Outlet context={context} />
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
