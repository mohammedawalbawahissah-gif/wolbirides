import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import "./Home.css";

const CARDS = [
  { to: "/book", state: { initialKind: "ride" as const }, icon: "🛺", title: "Request a Ride", blurb: "Book a yellow-yellow around campus and Tamale." },
  { to: "/book", state: { initialKind: "delivery" as const }, icon: "📦", title: "Delivery", blurb: "Send or receive a package with WolbiDeliver." },
  { to: "/rate", state: undefined, icon: "⭐", title: "Rate Rider", blurb: "Rate a completed trip you haven't rated yet." },
  { to: "/support", state: undefined, icon: "🛟", title: "Support & Help", blurb: "Get help, or tell us about a problem." },
];

/** The Ride tab's landing menu. Each card opens its own focused screen. */
export default function Home() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const firstName = (user?.name || "").split(" ")[0];

  return (
    <div>
      <div className="page-heading">
        <h1>{firstName ? `Hi, ${firstName}` : "Welcome"}</h1>
        <p>What would you like to do?</p>
      </div>

      <div className="menu-grid">
        {CARDS.map((c) => (
          <button key={c.title} className="menu-card" onClick={() => navigate(c.to, c.state ? { state: c.state } : undefined)}>
            <span className="menu-card-icon" aria-hidden="true">{c.icon}</span>
            <span className="menu-card-title">{c.title}</span>
            <span className="menu-card-blurb">{c.blurb}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
