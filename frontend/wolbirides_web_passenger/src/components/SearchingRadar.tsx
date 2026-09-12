import "./SearchingRadar.css";

export default function SearchingRadar() {
  return (
    <div className="searching-radar" aria-hidden="true">
      <span className="radar-ring radar-ring-1" />
      <span className="radar-ring radar-ring-2" />
      <span className="radar-ring radar-ring-3" />
      <span className="radar-core">WR</span>
    </div>
  );
}
