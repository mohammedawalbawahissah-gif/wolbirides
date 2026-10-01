import { useCallback, useEffect, useState } from "react";
import { api, type Trip } from "../api/client";
import { EmptyState, LoadingState, PageHeader, StatusBadge } from "../components/ui";
import "./Deliveries.css";

type View = "queue" | "active" | "recent";
const TABS: { key: View; label: string }[] = [
  { key: "queue", label: "Needs a courier" },
  { key: "active", label: "In progress" },
  { key: "recent", label: "Recent" },
];
const SUBTYPE: Record<string, string> = { parcel: "Parcel", errand: "Errand", vendor_order: "Vendor order" };
const WHY: Record<string, string> = {
  review: "Checked by ops first",
  no_courier_accepted: "No rider took it",
  driver_withdrew: "Rider withdrew",
  reassigned: "Taken off its courier",
};

interface DriverOption { driver_id: string; name: string; phone: string; distance_km: number | null }
interface ExternalOption { id: string; name: string; phone: string; notes: string }

function minutesSince(iso: string) {
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
}
function errorText(err: any, fallback: string) {
  return err?.response?.data?.detail || fallback;
}
function Phone({ value }: { value?: string | null }) {
  return value ? <a href={`tel:${value}`}>{value}</a> : null;
}

/** Ticks down to zero, then just shows "responding…" — the trip itself moves on (accepted,
 * declined, or back in the queue) once the backend's own timeout actually fires. */
function Countdown({ until }: { until: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks-js/set-state-in-effect -- seeds the clock on mount; this component only ever shows a live countdown
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  if (now == null) return null;
  const secondsLeft = Math.max(0, Math.round((new Date(until).getTime() - now) / 1000));
  return <>{secondsLeft > 0 ? `${secondsLeft}s to respond` : "responding…"}</>;
}

/** WR-26: the ops delivery desk. Errands, vendor orders and any parcel no driver took wait here. */
export default function Deliveries() {
  const [view, setView] = useState<View>("queue");
  const [rows, setRows] = useState<Trip[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [assigning, setAssigning] = useState<Trip | null>(null);
  const [confirming, setConfirming] = useState<{ trip: Trip; step: "pickup" | "dropoff" } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    api.get<Trip[]>(`/admin/deliveries?view=${view}`)
      .then(({ data }) => { setRows(data); setError(null); })
      .catch(() => setError("Couldn't load deliveries."));
  }, [view]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks-js/set-state-in-effect -- resets loading state as the effect starts a fetch
    setRows(null);
    load();
    const timer = window.setInterval(load, 10000); // new orders and status changes appear without a refresh
    return () => window.clearInterval(timer);
  }, [load]);

  async function act(trip: Trip, action: string, body: Record<string, unknown> = {}) {
    setBusy(trip.id);
    setError(null);
    try {
      await api.post(`/admin/deliveries/${trip.id}/${action}`, body);
      setAssigning(null);
      setConfirming(null);
      load();
    } catch (err) {
      setError(errorText(err, "That didn't work. Try again."));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <PageHeader title="Deliveries" />
      <div className="delivery-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={view === t.key}
            className={"delivery-tab" + (view === t.key ? " delivery-tab-on" : "")} onClick={() => setView(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {error && <div className="delivery-error" role="alert">{error}</div>}
      {rows == null && !error && <LoadingState />}
      {rows != null && rows.length === 0 && (
        <EmptyState message={view === "queue" ? "Nothing waiting for a courier." : "No deliveries here."} />
      )}

      <div className="delivery-list">
        {rows?.map((trip) => {
          const d = trip.delivery;
          if (!d) return null;
          const external = d.external_courier;
          const started = trip.status === "in_progress";
          const withCourier = ["matched", "driver_arriving", "in_progress"].includes(trip.status);
          return (
            <div key={trip.id} className="card delivery-card">
              <div className="delivery-head">
                <span className="delivery-type">{SUBTYPE[d.delivery_subtype]}</span>
                <StatusBadge status={trip.status} />
                {trip.status === "awaiting_assignment" && (
                  <span className="delivery-wait">
                    waiting {minutesSince(trip.requested_at)} min{trip.queue_reason ? ` · ${WHY[trip.queue_reason]}` : ""}
                  </span>
                )}
                {trip.status === "matching" && trip.pending_offer && (
                  <span className="delivery-offer-tag">
                    Offered to {trip.pending_offer.driver_name ?? "a rider"} · <Countdown until={trip.pending_offer.expires_at} />
                  </span>
                )}
              </div>

              <div className="delivery-route">{trip.pickup_label} <span aria-hidden="true">→</span> {trip.destination_label}</div>
              <div className="delivery-what">
                {d.delivery_subtype === "parcel" ? `${d.package_description} (${d.package_size})` : d.task_description}
                {d.vendor && <> · <strong>{d.vendor.name}</strong>{d.vendor.location_label ? `, ${d.vendor.location_label}` : ""}</>}
                {d.spend_limit && <> · spend up to GH₵{d.spend_limit}</>}
              </div>

              <div className="delivery-people">
                {d.sender_name && <div><strong>Collect from</strong> {d.sender_name} <Phone value={d.sender_phone} /></div>}
                {d.recipient_name && <div><strong>Deliver to</strong> {d.recipient_name} <Phone value={d.recipient_phone} /></div>}
                {trip.booker && <div><strong>Booked by</strong> {trip.booker.name} <Phone value={trip.booker.phone} /></div>}
                <div><strong>Pays by</strong> {trip.payment_method ?? "cash"}</div>
              </div>

              {withCourier && (
                <div className="delivery-courier">
                  {external
                    ? <>External courier: <strong>{external.name}</strong> <Phone value={external.phone} /></>
                    : <>Rider: <strong>{trip.driver_detail?.name}</strong> <Phone value={trip.driver_detail?.phone} /></>}
                </div>
              )}

              <div className="btn-row">
                {trip.status === "awaiting_assignment" && (
                  <button className="btn btn-primary" onClick={() => setAssigning(trip)}>Offer to a courier</button>
                )}
                {external && !started && ["matched", "driver_arriving"].includes(trip.status) && (
                  <button className="btn btn-primary" onClick={() => setConfirming({ trip, step: "pickup" })}>Confirm pickup</button>
                )}
                {external && started && (
                  <button className="btn btn-success" onClick={() => setConfirming({ trip, step: "dropoff" })}>Confirm drop-off</button>
                )}
                {external && trip.status === "completed" && trip.payment_method !== "momo" && trip.payment_method !== "hubtel" && (
                  <button className="btn btn-ghost" disabled={busy === trip.id} onClick={() => act(trip, "cash-received")}>Cash received</button>
                )}
                {["matched", "driver_arriving"].includes(trip.status) && (
                  <button className="btn btn-ghost" disabled={busy === trip.id} onClick={() => act(trip, "unassign")}>Take back</button>
                )}
                {!["completed", "cancelled"].includes(trip.status) && (
                  <button className="btn btn-ghost" disabled={busy === trip.id}
                    onClick={() => { if (window.confirm("Cancel this delivery? The requester is told.")) act(trip, "cancel", { reason: "Cancelled by our team." }); }}>
                    Cancel
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {assigning && <AssignModal trip={assigning} busy={busy === assigning.id} onClose={() => setAssigning(null)}
        onAssignDriver={(id) => act(assigning, "assign", { driver_id: id })}
        onAssignExternal={(body) => act(assigning, "assign-external", body)} />}
      {confirming && <ConfirmModal step={confirming.step} busy={busy === confirming.trip.id} onClose={() => setConfirming(null)}
        onConfirm={(code, byPhone) => act(confirming.trip, confirming.step === "pickup" ? "confirm-pickup" : "confirm-dropoff", { code, by_phone: byPhone })} />}
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="delivery-modal-overlay" role="dialog" aria-modal="true" aria-label={title}>
      <div className="delivery-modal card">
        <div className="delivery-modal-head">
          <h2>{title}</h2>
          <button className="delivery-modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function AssignModal({ trip, busy, onClose, onAssignDriver, onAssignExternal }: {
  trip: Trip; busy: boolean; onClose: () => void;
  onAssignDriver: (driverId: string) => void;
  onAssignExternal: (body: { courier_id?: string; name?: string; phone?: string; notes?: string }) => void;
}) {
  const [options, setOptions] = useState<{ drivers: DriverOption[]; external: ExternalOption[] } | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    api.get(`/admin/deliveries/${trip.id}/couriers`).then(({ data }) => setOptions(data)).catch(() => setOptions({ drivers: [], external: [] }));
  }, [trip.id]);

  return (
    <Modal title="Offer to a courier" onClose={onClose}>
      <h3 className="delivery-section">Available riders</h3>
      <p className="delivery-modal-hint">A rider gets to accept or decline — it isn't assigned until they do. An external courier is confirmed right away, since they have no app to respond in.</p>
      {options == null && <LoadingState />}
      {options?.drivers.length === 0 && <p className="delivery-empty">No rider is online, free and taking deliveries right now.</p>}
      {options?.drivers.map((d) => (
        <div key={d.driver_id} className="delivery-option">
          <div><strong>{d.name}</strong> <Phone value={d.phone} />
            {d.distance_km != null && <span className="delivery-km"> · {d.distance_km} km from pickup</span>}</div>
          <button className="btn btn-primary" disabled={busy} onClick={() => onAssignDriver(d.driver_id)}>Offer it</button>
        </div>
      ))}

      <h3 className="delivery-section">External couriers</h3>
      {options?.external.map((c) => (
        <div key={c.id} className="delivery-option">
          <div><strong>{c.name}</strong> <Phone value={c.phone} />{c.notes && <span className="delivery-km"> · {c.notes}</span>}</div>
          <button className="btn btn-ghost" disabled={busy} onClick={() => onAssignExternal({ courier_id: c.id })}>Use</button>
        </div>
      ))}
      <div className="delivery-new">
        <input className="field-input" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="field-input" placeholder="Phone" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <input className="field-input" placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
        <button className="btn btn-ghost" disabled={busy || !name.trim() || !phone.trim()}
          onClick={() => onAssignExternal({ name: name.trim(), phone: phone.trim(), notes: notes.trim() })}>
          Add and assign
        </button>
      </div>
    </Modal>
  );
}

function ConfirmModal({ step, busy, onClose, onConfirm }: {
  step: "pickup" | "dropoff"; busy: boolean; onClose: () => void; onConfirm: (code: string, byPhone: boolean) => void;
}) {
  const [code, setCode] = useState("");
  const [byPhone, setByPhone] = useState(false);
  const who = step === "pickup" ? "sender" : "recipient";
  return (
    <Modal title={step === "pickup" ? "Confirm pickup" : "Confirm drop-off"} onClose={onClose}>
      <label className="field-label" htmlFor="confirm-code">Code the courier was given by the {who}</label>
      <input id="confirm-code" className="field-input" inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} />
      <label className="delivery-check">
        <input type="checkbox" checked={byPhone} onChange={(e) => setByPhone(e.target.checked)} />
        No code — I checked with the {who} by phone
      </label>
      <button className="btn btn-primary" disabled={busy || (!code.trim() && !byPhone)} onClick={() => onConfirm(code.trim(), byPhone)}>
        Confirm
      </button>
    </Modal>
  );
}
