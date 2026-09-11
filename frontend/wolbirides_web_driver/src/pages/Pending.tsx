export default function Pending({ licenceNumber }: { licenceNumber: string }) {
  return (
    <div className="screen">
      <h1 className="screen-title">Application received</h1>
      <p className="screen-subtitle">
        Your documents are being reviewed against the WR-07.2 compliance checklist
        (licence, vehicle registration, and required documentation).
      </p>
      <div className="card">
        <div style={{ fontSize: 13, color: "var(--ink-muted)", marginBottom: 4 }}>Licence number</div>
        <div style={{ fontWeight: 700, fontFamily: "monospace" }}>{licenceNumber}</div>
        <div style={{ marginTop: 12 }}>
          <span className="badge badge-warning">Pending review</span>
        </div>
      </div>
      <p style={{ fontSize: 13, color: "var(--ink-muted)", marginTop: 16 }}>
        You'll be able to go online as soon as ops approves your application. This usually
        happens quickly during the founding-driver pilot — check back soon.
      </p>
    </div>
  );
}
