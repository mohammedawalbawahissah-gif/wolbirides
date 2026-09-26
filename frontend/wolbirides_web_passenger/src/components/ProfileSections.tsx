import { useEffect, useState, type FormEvent } from "react";
import { api, type NotificationPref, type RecurringRide, type SavedAddress } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useToast } from "./Toast";
import "./ProfileSections.css";

/** WR-18: the one person we text if you press SOS during a ride. */
export function SafetyContactCard() {
  const { user, updateProfile } = useAuth();
  const toast = useToast();
  const [name, setName] = useState(user?.emergency_contact_name || "");
  const [phone, setPhone] = useState(user?.emergency_contact_phone || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await updateProfile({ emergency_contact_name: name.trim(), emergency_contact_phone: phone.trim() });
      toast.show(phone.trim() ? "Emergency contact saved." : "Emergency contact removed.", "success");
    } catch (err: any) {
      setError(err?.response?.data?.emergency_contact_phone?.[0] || "Couldn't save your emergency contact.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card profile-card profile-section">
      <h2 className="side-card-title">Emergency contact</h2>
      <p className="profile-muted">If you press SOS during a ride, we'll text this person your location.</p>
      <form onSubmit={save}>
        <label className="field-label" htmlFor="ec-name">Name</label>
        <input id="ec-name" className="field-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Mum" />
        <label className="field-label" htmlFor="ec-phone">Phone number</label>
        <input
          id="ec-phone"
          className="field-input"
          inputMode="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="024 123 4567"
        />
        {error && <p className="profile-error">{error}</p>}
        <button className="btn btn-gold" type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save contact"}
        </button>
      </form>
    </div>
  );
}

/** WR-16: only categories that can actually be turned off are listed. */
export function NotificationPrefsCard() {
  const toast = useToast();
  const [prefs, setPrefs] = useState<NotificationPref[] | null>(null);

  useEffect(() => {
    api.get<NotificationPref[]>("/notifications/preferences").then(({ data }) => setPrefs(data)).catch(() => setPrefs([]));
  }, []);

  async function toggle(pref: NotificationPref) {
    const next = !pref.enabled;
    setPrefs((prev) => prev?.map((p) => (p.category === pref.category ? { ...p, enabled: next } : p)) ?? prev);
    try {
      const { data } = await api.patch<NotificationPref[]>("/notifications/preferences", [
        { category: pref.category, enabled: next },
      ]);
      setPrefs(data);
    } catch {
      setPrefs((prev) => prev?.map((p) => (p.category === pref.category ? { ...p, enabled: !next } : p)) ?? prev);
      toast.show("Couldn't update that setting — try again.", "error");
    }
  }

  return (
    <div className="card profile-card profile-section">
      <h2 className="side-card-title">Notifications</h2>
      <p className="profile-muted">Trip updates and safety alerts always come through.</p>
      {prefs == null && <p className="profile-muted">Loading…</p>}
      {prefs?.map((pref) => (
        <label className="pref-row" key={pref.category}>
          <span>{pref.label}</span>
          <input type="checkbox" className="pref-switch" checked={pref.enabled} onChange={() => toggle(pref)} />
        </label>
      ))}
    </div>
  );
}

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** WR-13: reminders for rides you take often. Never books on your behalf. */
export function RecurringRidesCard() {
  const toast = useToast();
  const [rides, setRides] = useState<RecurringRide[] | null>(null);
  const [places, setPlaces] = useState<SavedAddress[]>([]);
  const [adding, setAdding] = useState(false);
  const [pickup, setPickup] = useState("");
  const [destination, setDestination] = useState("");
  const [days, setDays] = useState<number[]>([0, 1, 2, 3, 4]);
  const [time, setTime] = useState("07:30");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get<RecurringRide[]>("/passengers/me/recurring-rides").then(({ data }) => setRides(data)).catch(() => setRides([]));
    api.get<SavedAddress[]>("/passengers/me/addresses").then(({ data }) => setPlaces(data)).catch(() => setPlaces([]));
  }, []);

  function toggleDay(d: number) {
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()));
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!pickup || !destination || pickup === destination || days.length === 0) return;
    setSaving(true);
    try {
      const { data } = await api.post<RecurringRide>("/passengers/me/recurring-rides", {
        pickup, destination, days_of_week: days, time_of_day: time,
      });
      setRides((prev) => [...(prev ?? []), data].sort((a, b) => a.time_of_day.localeCompare(b.time_of_day)));
      setAdding(false);
      toast.show("Reminder set. We'll nudge you 15 minutes before.", "success");
    } catch {
      toast.show("Couldn't save that reminder — try again.", "error");
    } finally {
      setSaving(false);
    }
  }

  async function setActive(ride: RecurringRide, active: boolean) {
    setRides((prev) => prev?.map((r) => (r.id === ride.id ? { ...r, active } : r)) ?? prev);
    api.patch(`/passengers/me/recurring-rides/${ride.id}`, { active }).catch(() => {
      setRides((prev) => prev?.map((r) => (r.id === ride.id ? { ...r, active: !active } : r)) ?? prev);
      toast.show("Couldn't update that reminder.", "error");
    });
  }

  async function remove(ride: RecurringRide) {
    setRides((prev) => prev?.filter((r) => r.id !== ride.id) ?? prev);
    api.delete(`/passengers/me/recurring-rides/${ride.id}`).catch(() => toast.show("Couldn't remove that reminder.", "error"));
  }

  return (
    <div className="card profile-card profile-section">
      <h2 className="side-card-title">Regular rides</h2>
      <p className="profile-muted">Get a reminder before rides you take every week. We never book for you.</p>

      {rides == null && <p className="profile-muted">Loading…</p>}
      {rides?.map((ride) => (
        <div className="saved-address-row" key={ride.id}>
          <div>
            <div className="saved-address-label">
              {ride.pickup_detail.label} to {ride.destination_detail.label}
            </div>
            <div className="saved-address-text">
              {ride.days_of_week.map((d) => DAYS[d]).join(", ")} at {ride.time_of_day.slice(0, 5)}
            </div>
          </div>
          <div className="recurring-actions">
            <input
              type="checkbox"
              className="pref-switch"
              checked={ride.active}
              onChange={(e) => setActive(ride, e.target.checked)}
              aria-label={ride.active ? "Pause reminder" : "Resume reminder"}
            />
            <button className="saved-address-remove" onClick={() => remove(ride)} aria-label="Remove reminder">✕</button>
          </div>
        </div>
      ))}

      {places.length < 2 ? (
        <p className="profile-muted">Save at least two places above to set up a regular ride.</p>
      ) : adding ? (
        <form className="recurring-form" onSubmit={create}>
          <label className="field-label" htmlFor="rr-from">From</label>
          <select id="rr-from" className="field-input" value={pickup} onChange={(e) => setPickup(e.target.value)}>
            <option value="">Choose a saved place</option>
            {places.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
          <label className="field-label" htmlFor="rr-to">To</label>
          <select id="rr-to" className="field-input" value={destination} onChange={(e) => setDestination(e.target.value)}>
            <option value="">Choose a saved place</option>
            {places.filter((p) => p.id !== pickup).map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
          <span className="field-label">Days</span>
          <div className="day-chips">
            {DAYS.map((d, i) => (
              <button type="button" key={d} className={"day-chip" + (days.includes(i) ? " day-chip-on" : "")}
                onClick={() => toggleDay(i)} aria-pressed={days.includes(i)}>
                {d}
              </button>
            ))}
          </div>
          <label className="field-label" htmlFor="rr-time">Time</label>
          <input id="rr-time" type="time" className="field-input" value={time} onChange={(e) => setTime(e.target.value)} />
          <div className="recurring-form-actions">
            <button className="btn btn-gold" type="submit" disabled={saving || !pickup || !destination || days.length === 0}>
              {saving ? "Saving…" : "Set reminder"}
            </button>
            <button className="btn btn-ghost" type="button" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </form>
      ) : (
        <button className="btn btn-ghost" style={{ marginTop: 12 }} onClick={() => setAdding(true)}>
          Add a regular ride
        </button>
      )}
    </div>
  );
}

/** WR-19: defaults for every booking (can still be changed per trip). Seen only by matching. */
export function RidePreferencesCard() {
  const toast = useToast();
  const [prefs, setPrefs] = useState<Record<string, boolean | string> | null>(null);
  const LABELS: Record<string, string> = {
    prefer_previous_drivers: "Prefer drivers I've ridden with",
    quiet_ride: "Quiet ride",
    needs_luggage_space: "Space for luggage",
    needs_accessibility_help: "Help getting in and out",
  };

  useEffect(() => {
    api.get("/passengers/me/ride-preferences").then(({ data }) => setPrefs(data)).catch(() => setPrefs({}));
  }, []);

  async function save(patch: Record<string, boolean | string>) {
    const previous = prefs;
    const next = { ...(prefs ?? {}), ...patch };
    setPrefs(next);
    try {
      const { data } = await api.put("/passengers/me/ride-preferences", next);
      setPrefs(data);
    } catch {
      setPrefs(previous);
      toast.show("Couldn't save that preference.", "error");
    }
  }

  return (
    <div className="card profile-card profile-section">
      <h2 className="side-card-title">Ride preferences</h2>
      <p className="profile-muted">
        Optional. Only our matching uses these; drivers never see them. If no matching driver is free, we'll ask you
        before sending anyone else.
      </p>
      {prefs && (
        <>
          <label className="field-label" htmlFor="pref-gender">Driver preference</label>
          <select id="pref-gender" className="field-input" value={String(prefs.preferred_driver_gender || "")}
            onChange={(e) => save({ preferred_driver_gender: e.target.value })}>
            <option value="">No preference</option>
            <option value="female">Female driver</option>
            <option value="male">Male driver</option>
          </select>
          {Object.keys(LABELS).map((k) => (
            <label className="pref-row" key={k}>
              <span>{LABELS[k]}</span>
              <input type="checkbox" className="pref-switch" checked={!!prefs[k]} onChange={() => save({ [k]: !prefs[k] })} />
            </label>
          ))}
        </>
      )}
    </div>
  );
}

interface Plan {
  id: string; name: string; ride_count: number; price: string; per_ride_price: string; max_fare_per_ride: string;
  valid_days: number | null; expires_before_term: boolean;
}
interface MyBundle {
  id: string; plan_name: string; rides_total: number; rides_remaining: number; status: string;
  expires_at: string | null; max_fare_per_ride: string; price_paid: string;
}

const BUNDLE_STATUS: Record<string, string> = {
  pending_payment: "Awaiting payment", active: "Active", exhausted: "Used up", expired: "Expired", cancelled: "Cancelled",
};

/** WR-22: prepaid ride bundles. */
export function BundlesCard() {
  const toast = useToast();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [mine, setMine] = useState<MyBundle[] | null>(null);
  const [buying, setBuying] = useState<string | null>(null);

  function load() {
    api.get<Plan[]>("/bundles/plans").then(({ data }) => setPlans(data)).catch(() => {});
    api.get<MyBundle[]>("/passengers/me/ride-bundles").then(({ data }) => setMine(data)).catch(() => setMine([]));
  }
  useEffect(load, []);

  const { user } = useAuth();
  const [momoPhone, setMomoPhone] = useState(user?.phone || "");

  async function buy(plan: Plan, method: "momo" | "office") {
    // PRD WR-22: a bundle that expires before the end of a term is disclosed and confirmed up front.
    if (plan.expires_before_term && !window.confirm(
      `This bundle expires ${plan.valid_days} days after you buy it, before the end of a term. ` +
      `Unused rides are lost after that. Buy it anyway?`)) return;
    setBuying(plan.id);
    try {
      const { data } = await api.post<MyBundle>("/ride-bundles/purchase", {
        plan_id: plan.id, payment_method: method, phone: momoPhone.trim(), acknowledge_expiry: plan.expires_before_term,
      });
      if (method === "momo") {
        toast.show("Approve the MoMo prompt on your phone.", "info");
        waitForPayment(data.id);
      } else {
        toast.show("Bundle reserved. Pay at the WolbiRides desk and it'll be switched on.", "success");
      }
      load();
    } catch (err: any) {
      toast.show(err?.response?.data?.detail || "Couldn't start that purchase. Try again.", "error");
      load();
    } finally {
      setBuying(null);
    }
  }

  // Poll for up to ~2 minutes while the rider approves the MoMo prompt.
  function waitForPayment(bundleId: string, attempt = 0) {
    if (attempt > 30) return;
    window.setTimeout(async () => {
      try {
        const { data } = await api.get<MyBundle>(`/bundles/${bundleId}/payment-status`);
        if (data.status === "active") {
          toast.show("Bundle paid and ready to use.", "success");
          load();
          return;
        }
      } catch { /* keep trying */ }
      waitForPayment(bundleId, attempt + 1);
    }, 4000);
  }

  const visible = (mine ?? []).filter((b) => ["pending_payment", "active"].includes(b.status));
  if (plans.length === 0 && visible.length === 0) return null;

  return (
    <div className="card profile-card profile-section">
      <h2 className="side-card-title">Ride bundles</h2>
      <p className="profile-muted">Pay once for several rides. Each ride uses one credit.</p>
      {plans.length > 0 && (
        <>
          <label className="field-label" htmlFor="bundle-momo">MoMo number for bundle payments</label>
          <input id="bundle-momo" className="field-input" inputMode="tel" value={momoPhone}
            onChange={(e) => setMomoPhone(e.target.value)} />
        </>
      )}
      {visible.map((b) => (
        <div className="saved-address-row" key={b.id}>
          <div>
            <div className="saved-address-label">{b.plan_name}</div>
            <div className="saved-address-text">
              {b.status === "active"
                ? `${b.rides_remaining} of ${b.rides_total} rides left, ${b.expires_at ? `expires ${new Date(b.expires_at).toLocaleDateString()}` : "never expires"}. Used automatically, oldest first.`
                : `GH₵${b.price_paid}. Waiting for payment (approve the MoMo prompt, or pay at the desk).`}
            </div>
          </div>
          <span className={"badge " + (b.status === "active" ? "badge-success" : "badge-warning")}>{BUNDLE_STATUS[b.status]}</span>
        </div>
      ))}
      {plans.map((p) => (
        <div className="saved-address-row" key={p.id}>
          <div>
            <div className="saved-address-label">{p.name}: {p.ride_count} rides for GH₵{p.price} (GH₵{p.per_ride_price} each)</div>
            <div className="saved-address-text">
              Rides up to GH₵{p.max_fare_per_ride} each.{" "}
              {p.valid_days == null ? "Never expires."
                : <strong style={p.expires_before_term ? { color: "var(--danger)" } : undefined}>
                    Expires {p.valid_days} days after purchase{p.expires_before_term ? ", before the end of a term" : ""}.
                  </strong>}
            </div>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button className="btn btn-gold" disabled={buying === p.id || momoPhone.trim().length < 9} onClick={() => buy(p, "momo")}>
              {buying === p.id ? "Starting…" : "Pay with MoMo"}
            </button>
            <button className="btn btn-ghost" disabled={buying === p.id} onClick={() => buy(p, "office")}>Pay at desk</button>
          </div>
        </div>
      ))}
    </div>
  );
}
