import { Fragment, useEffect, useMemo, useState } from "react";
import { api, type Driver, type RiderPassPlan, type RiderPassStatus } from "../api/client";
import { EmptyState, LoadingState, PageHeader, SortableTh, StatusBadge } from "../components/ui";
import { useSortableData } from "../hooks/useSortableData";
import "./Drivers.css";

const STATUS_OPTIONS = ["", "pending", "verified", "suspended", "rejected"];

const MISSING_LABELS: Record<string, string> = {
  licence_number: "licence number",
  ghana_card_number: "Ghana Card",
  transport_union: "transport union",
  union_membership_number: "union membership no.",
  vehicle: "vehicle",
  roadworthy_expiry: "roadworthy expiry",
};
const missingText = (m: string[]) => m.map((x) => MISSING_LABELS[x] || x).join(", ");

function when(iso: string | null) {
  return iso ? new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";
}

interface DriverRow extends Driver {
  nameKey: string;
}

export default function Drivers() {
  const [tab, setTab] = useState<"pending" | "all">("pending");
  const [drivers, setDrivers] = useState<Driver[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  function load() {
    // eslint-disable-next-line react-hooks-js/set-state-in-effect -- resets loading/error state as the effect starts a fetch or subscription
    setDrivers(null);
    const url = tab === "pending" ? "/admin/drivers/pending" : "/admin/drivers";
    const params = tab === "all" ? { status: statusFilter || undefined, search: search || undefined } : undefined;
    api
      .get<Driver[]>(url, { params })
      .then(({ data }) => setDrivers(data))
      .catch(() => setError("Couldn't load riders."));
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps -- search applies when the user submits, not on every keystroke
  useEffect(load, [tab, statusFilter]);

  async function act(driverId: string, action: "verify" | "reject" | "suspend", override = false) {
    setActingOn(driverId);
    try {
      await api.patch(`/admin/drivers/${driverId}/verify`, { action, ...(override ? { override: true } : {}) });
      load();
    } catch (err: any) {
      const missing: string[] | undefined = err?.response?.data?.missing;
      if (action === "verify" && missing && !override) {
        // LI 2519 papers missing. Ops may verify anyway only after checking the originals in person;
        // the override is recorded in the audit log.
        if (window.confirm(`Missing: ${missingText(missing)}.\n\nVerify anyway? Only if you've seen the original papers in person. This is logged.`)) {
          setActingOn(null);
          return act(driverId, action, true);
        }
        return;
      }
      setError(`Couldn't ${action} that rider. Try again.`);
    } finally {
      setActingOn(null);
    }
  }

  const rows: DriverRow[] = useMemo(
    () => (drivers ?? []).map((d) => ({ ...d, nameKey: d.user?.name || d.user?.phone || "" })),
    [drivers]
  );
  const { sorted, sortKey, direction, requestSort } = useSortableData<DriverRow>(rows, "nameKey", "asc");

  return (
    <div>
      <PageHeader
        title="Riders"
      />

      <PassPlansPanel />

      <div className="btn-row" style={{ marginBottom: 16 }}>
        <button className={tab === "pending" ? "btn btn-primary" : "btn btn-ghost"} onClick={() => setTab("pending")}>
          Pending review
        </button>
        <button className={tab === "all" ? "btn btn-primary" : "btn btn-ghost"} onClick={() => setTab("all")}>
          All riders
        </button>
      </div>

      {tab === "all" && (
        <form
          className="filter-row"
          onSubmit={(e) => {
            e.preventDefault();
            load();
          }}
        >
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>{s === "" ? "All statuses" : s}</option>
            ))}
          </select>
          <input
            type="text"
            placeholder="Search by name, phone, licence, Ghana Card or union no."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button className="btn btn-primary" type="submit">Search</button>
        </form>
      )}

      {error && <EmptyState message={error} />}
      {!drivers && !error && <LoadingState />}

      {drivers && drivers.length === 0 && (
        <EmptyState message={tab === "pending" ? "No riders waiting on review right now." : "No riders match this filter."} />
      )}

      {drivers && drivers.length > 0 && (
        <div className="panel">
          <table className="data-table">
            <thead>
              <tr>
                <th aria-hidden="true"></th>
                <SortableTh<DriverRow> label="Rider" sortKey="nameKey" activeKey={sortKey} direction={direction} onSort={requestSort} />
                <th>Licence</th>
                <th>Vehicle</th>
                <SortableTh<DriverRow> label="Status" sortKey="verification_status" activeKey={sortKey} direction={direction} onSort={requestSort} />
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((driver) => (
                <Fragment key={driver.id}>
                <tr className="driver-row" onClick={() => setExpanded(expanded === driver.id ? null : driver.id)}>
                  <td className="driver-expand-cell">
                    <span className={"driver-expand-chevron" + (expanded === driver.id ? " driver-expand-chevron-open" : "")} aria-hidden="true">›</span>
                  </td>
                  <td>
                    <div>{driver.user?.name || "Unnamed"}</div>
                    <div className="mono">{driver.user?.phone}</div>
                  </td>
                  <td>
                    <div className="mono">{driver.licence_number}</div>
                    {driver.licence_expiry && (
                      <div className="mono">expires {driver.licence_expiry}</div>
                    )}
                  </td>
                  <td>
                    {driver.vehicles.length > 0
                      ? driver.vehicles.map((v) => v.plate_number).join(", ")
                      : "No vehicle on file"}
                  </td>
                  <td>
                    <StatusBadge status={driver.verification_status} />
                    {(driver.compliance_missing?.length ?? 0) > 0 && (
                      <div className="mono" style={{ color: "var(--warning, #b45309)" }}>
                        missing: {missingText(driver.compliance_missing!)}
                      </div>
                    )}
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <div className="btn-row">
                      {driver.verification_status !== "verified" && (
                        <button
                          className="btn btn-success"
                          disabled={actingOn === driver.id}
                          onClick={() => act(driver.id, "verify")}
                        >
                          Verify
                        </button>
                      )}
                      {driver.verification_status === "pending" && (
                        <button
                          className="btn btn-ghost"
                          disabled={actingOn === driver.id}
                          onClick={() => act(driver.id, "reject")}
                        >
                          Reject
                        </button>
                      )}
                      {driver.verification_status === "verified" && (
                        <button
                          className="btn btn-danger"
                          disabled={actingOn === driver.id}
                          onClick={() => act(driver.id, "suspend")}
                        >
                          Suspend
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
                {expanded === driver.id && <ApplicationDetailRow driver={driver} />}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Doc({ label, url }: { label: string; url?: string }) {
  if (!url) return <div className="driver-doc driver-doc-missing"><span>{label}</span><span>Not uploaded</span></div>;
  const isImage = /\.(png|jpe?g|webp|gif)(\?|$)/i.test(url);
  return (
    <a className="driver-doc" href={url} target="_blank" rel="noopener noreferrer">
      {isImage ? <img src={url} alt={label} className="driver-doc-thumb" /> : <div className="driver-doc-thumb driver-doc-file">File</div>}
      <span>{label}</span>
    </a>
  );
}

/** Everything ops needs to actually look at before approving — not just the text fields the
 * collapsed row shows, but the real documents, so nobody verifies a rider blind. */
function ApplicationDetailRow({ driver }: { driver: Driver }) {
  const vehicle = driver.vehicles[0];
  return (
    <tr className="driver-detail-row">
      <td colSpan={6}>
        <div className="driver-detail">
          <div className="driver-detail-docs">
            <Doc label="Licence photo" url={driver.licence_document} />
            <Doc label="Vehicle photo" url={vehicle?.photo} />
            <Doc label="Vehicle registration" url={vehicle?.registration_document} />
            <Doc label="Ghana Card" url={driver.ghana_card_document} />
            <Doc label="Union card" url={driver.union_card_document} />
            <Doc label="Roadworthy certificate" url={vehicle?.roadworthy_certificate} />
          </div>
          <div className="driver-detail-info">
            <div><span>Emergency contact</span><strong>{driver.emergency_contact_name || "—"}{driver.emergency_contact_phone ? ` · ${driver.emergency_contact_phone}` : ""}</strong></div>
            <div><span>Paid by</span><strong>{driver.payout_provider === "hubtel" ? "Hubtel" : "MTN MoMo"}{driver.payout_phone ? ` · ${driver.payout_phone}` : " · account phone"}</strong></div>
            <div><span>Vehicle type</span><strong>{vehicle?.vehicle_type?.replace("_", " ") || "—"}</strong></div>
            <div><span>Ghana Card</span><strong className="mono">{driver.ghana_card_number || "—"}</strong></div>
            <div><span>Union</span><strong>{driver.transport_union || "—"}{driver.union_membership_number ? ` · ${driver.union_membership_number}` : ""}</strong></div>
            <div><span>Roadworthy until</span><strong>{vehicle?.roadworthy_expiry || "—"}</strong></div>
          </div>
          {driver.verification_status === "verified" && <RiderPassPanel driverId={driver.id} />}
        </div>
      </td>
    </tr>
  );
}


/** Plans riders can buy. Prices are a test: change them here as rider interviews come in. */
function PassPlansPanel() {
  const [plans, setPlans] = useState<RiderPassPlan[] | null>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("Day pass");
  const [days, setDays] = useState("1");
  const [price, setPrice] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = () => { api.get<RiderPassPlan[]>("/admin/rider-passes/plans").then(({ data }) => setPlans(data)).catch(() => {}); };
  useEffect(load, []);

  async function create() {
    setError(null);
    try {
      await api.post("/admin/rider-passes/plans", { name, duration_days: Number(days), price });
      setPrice("");
      load();
    } catch (err: any) {
      setError(err?.response?.data?.detail || "Couldn't create that plan.");
    }
  }

  async function patch(plan: RiderPassPlan, body: Partial<RiderPassPlan>) {
    setError(null);
    try {
      await api.patch(`/admin/rider-passes/plans/${plan.id}`, body);
      load();
    } catch (err: any) {
      setError(err?.response?.data?.detail || "Couldn't update that plan.");
    }
  }

  return (
    <div className="panel" style={{ marginBottom: 16, padding: 12 }}>
      <button className="btn btn-ghost" onClick={() => setOpen(!open)}>
        {open ? "Hide" : "Show"} rider pass plans {plans ? `(${plans.filter((p) => p.active).length} on sale)` : ""}
      </button>
      {open && (
        <div style={{ marginTop: 12 }}>
          <p className="mono">Passes are enforced only when RIDER_PASS_REQUIRED=True on the server.</p>
          {plans && plans.length > 0 && (
            <table className="data-table">
              <thead><tr><th>Plan</th><th>Days</th><th>Price (GH₵)</th><th>Sold</th><th></th></tr></thead>
              <tbody>
                {plans.map((p) => (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    <td>{p.duration_days}</td>
                    <td>
                      <input type="number" step="0.5" min="0.5" defaultValue={p.price} style={{ width: 90 }}
                        onBlur={(e) => e.target.value !== p.price && patch(p, { price: e.target.value })} />
                    </td>
                    <td>{p.sold ?? 0}</td>
                    <td>
                      <button className="btn btn-ghost" onClick={() => patch(p, { active: !p.active })}>
                        {p.active ? "Stop selling" : "Sell again"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="filter-row" style={{ marginTop: 8 }}>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Plan name" />
            <input type="number" min="1" max="90" value={days} onChange={(e) => setDays(e.target.value)} placeholder="Days" style={{ width: 80 }} />
            <input type="number" step="0.5" min="0.5" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Price GH₵" style={{ width: 110 }} />
            <button className="btn btn-primary" disabled={!name.trim() || !price} onClick={create}>Add plan</button>
          </div>
          {error && <div className="mono" style={{ color: "var(--danger, #b91c1c)" }}>{error}</div>}
        </div>
      )}
    </div>
  );
}

/** A verified rider's pass: current cover, and ops recording a cash payment or granting free days. */
function RiderPassPanel({ driverId }: { driverId: string }) {
  const [status, setStatus] = useState<RiderPassStatus | null>(null);
  const [planId, setPlanId] = useState("");
  const [grantDays, setGrantDays] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => { api.get<RiderPassStatus>(`/admin/drivers/${driverId}/passes`).then(({ data }) => setStatus(data)).catch(() => {}); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [driverId]);

  async function record(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/admin/drivers/${driverId}/passes`, body);
      setGrantDays("");
      load();
    } catch (err: any) {
      setError(err?.response?.data?.detail || "Couldn't record that.");
    } finally {
      setBusy(false);
    }
  }

  if (!status) return null;
  return (
    <div className="driver-detail-info" style={{ marginTop: 12 }}>
      <div>
        <span>Pass</span>
        <strong>
          {status.current
            ? `${status.current.source === "trial" ? "Free trial" : status.current.plan || status.current.source} until ${when(status.current.expires_at)}`
            : status.trial_available ? "None yet (trial starts on first go-online)" : "No active pass"}
          {status.paid_until && status.current && status.paid_until !== status.current.expires_at ? ` · paid until ${when(status.paid_until)}` : ""}
        </strong>
      </div>
      <div className="btn-row" style={{ flexWrap: "wrap" }}>
        <select value={planId} onChange={(e) => setPlanId(e.target.value)}>
          <option value="">Cash payment for…</option>
          {status.plans.map((p) => <option key={p.id} value={p.id}>{p.name} · GH₵{p.price}</option>)}
        </select>
        <button className="btn btn-success" disabled={busy || !planId}
          onClick={() => window.confirm("Record that this rider paid you this amount in cash?") && record({ source: "cash", plan_id: planId })}>
          Record cash
        </button>
        <input type="number" min="1" max="90" value={grantDays} onChange={(e) => setGrantDays(e.target.value)}
          placeholder="Free days" style={{ width: 100 }} />
        <button className="btn btn-ghost" disabled={busy || !grantDays} onClick={() => record({ source: "grant", days: Number(grantDays) })}>
          Grant
        </button>
      </div>
      {error && <div className="mono" style={{ color: "var(--danger, #b91c1c)" }}>{error}</div>}
    </div>
  );
}
