import SupportCard from "../components/SupportCard";
import "./Support.css";

/** General help, reachable from the Ride menu — not tied to any one trip. */
export default function Support() {
  return (
    <div className="support-page">
      <div className="page-heading">
        <h1>Support & Help</h1>
        <p>Get help, or tell us about a problem.</p>
      </div>
      <SupportCard />
    </div>
  );
}
