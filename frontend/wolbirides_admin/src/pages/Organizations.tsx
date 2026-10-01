import { useEffect, useState, type FormEvent } from "react";
import { api } from "../api/client";
import { EmptyState, LoadingState, PageHeader, StatusBadge } from "../components/ui";

interface Org {
  id: string; name: string; billing_contact_name: string; billing_email: string; billing_phone: string;
  monthly_budget: string | null; prepaid_balance: string | null; active: boolean; member_count: number;
}
interface Voucher {
  id: string; code: string; kind: "value" | "rides"; value: string | null; value_remaining: string | null;
  ride_count: number | null; rides_remaining: number | null; redeemed_by_name: string | null; expires_at: string | null;
  voided: boolean;
}
interface Member { id: string; name: string; email: string | null; phone: string; monthly_limit: string | null; active: boolean; remaining_this_month: string | null }
interface Invoice { id: string; period_start: string; period_end: string; total: string; status: string; line_items: unknown[] }

function monthRange(offset = -1) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const end = new Date(now.getFullYear(), now.getMonth() + offset + 1, 1);
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
  return { start: iso(start), end: iso(end) };
}

/** WR-21: organizations that pay for their members' rides. */
export default function Organizations() {
  const [orgs, setOrgs] = useState<Org[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", billing_contact_name: "", billing_email: "", billing_phone: "", monthly_budget: "" });
  const [openId, setOpenId] = useState<string | null>(null);

  function load() {
    api.get<Org[]>("/admin/organizations").then(({ data }) => setOrgs(data)).catch(() => setError("Couldn't load organizations."));
  }
  useEffect(load, []);

  async function create(e: FormEvent) {
    e.preventDefault();
    try {
      await api.post("/admin/organizations", { ...form, monthly_budget: form.monthly_budget || null });
      setForm({ name: "", billing_contact_name: "", billing_email: "", billing_phone: "", monthly_budget: "" });
      setShowForm(false);
      load();
    } catch (err: any) {
      setError(err?.response?.data?.name?.[0] || "Couldn't create that organization.");
    }
  }

  return (
    <div>
      <PageHeader title="Organizations" />
      <div className="btn-row" style={{ marginBottom: 16 }}>
        <button className="btn btn-primary" onClick={() => setShowForm((v) => !v)}>{showForm ? "Cancel" : "Add organization"}</button>
      </div>

      {showForm && (
        <form className="panel" onSubmit={create} style={{ padding: 20, marginBottom: 20 }}>
          <div className="zone-form-grid">
            {([
              ["name", "Name"], ["billing_contact_name", "Billing contact"], ["billing_email", "Billing email"],
              ["billing_phone", "Billing phone"], ["monthly_budget", "Monthly budget (GH₵, blank = no cap)"],
            ] as const).map(([key, label]) => (
              <label key={key}>
                {label}
                <input value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} required={key === "name"} />
              </label>
            ))}
          </div>
          <button className="btn btn-primary" type="submit" style={{ marginTop: 12 }}>Create organization</button>
        </form>
      )}

      {error && <EmptyState message={error} />}
      {!orgs && !error && <LoadingState />}
      {orgs && orgs.length === 0 && <EmptyState message="No organizations yet." />}
      {orgs?.map((org) => (
        <div className="panel" key={org.id} style={{ marginBottom: 12 }}>
          <div className="panel-header">
            <h2>{org.name}</h2>
            <div className="btn-row">
              <span style={{ fontSize: 13, color: "var(--ink-muted)" }}>
                {org.member_count} member{org.member_count === 1 ? "" : "s"}
                {org.monthly_budget ? `, GH₵${org.monthly_budget}/month` : ""}
                {org.prepaid_balance != null ? `, prepaid balance GH₵${org.prepaid_balance}` : ", invoiced monthly"}
              </span>
              <StatusBadge status={org.active ? "active" : "suspended"} />
              <button className="btn btn-ghost" onClick={() => setOpenId(openId === org.id ? null : org.id)}>
                {openId === org.id ? "Close" : "Manage"}
              </button>
            </div>
          </div>
          {openId === org.id && <OrgDetail org={org} onChanged={load} />}
        </div>
      ))}
    </div>
  );
}

function OrgDetail({ org, onChanged }: { org: Org; onChanged: () => void }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [identifier, setIdentifier] = useState("");
  const [limit, setLimit] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  function load() {
    api.get(`/admin/organizations/${org.id}`).then(({ data }) => setMembers(data.members));
    api.get<Invoice[]>(`/admin/invoices?organization=${org.id}`).then(({ data }) => setInvoices(data));
  }
  useEffect(load, [org.id]);

  async function addMember(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    try {
      await api.post(`/admin/organizations/${org.id}/members`, { identifier, monthly_limit: limit || null });
      setIdentifier(""); setLimit("");
      load(); onChanged();
    } catch (err: any) {
      setMsg(err?.response?.data?.detail || "Couldn't add that member.");
    }
  }

  async function removeMember(m: Member) {
    await api.delete(`/admin/organizations/${org.id}/members/${m.id}`);
    load(); onChanged();
  }

  async function invoiceLastMonth() {
    const { start, end } = monthRange(-1);
    await api.post("/admin/invoices", { organization: org.id, period_start: start, period_end: end });
    load();
  }

  async function setInvoiceStatus(inv: Invoice, status: "sent" | "paid") {
    await api.post(`/admin/invoices/${inv.id}/status`, { status });
    load();
  }

  async function toggleActive() {
    await api.patch(`/admin/organizations/${org.id}`, { active: !org.active });
    onChanged();
  }

  return (
    <div style={{ padding: "0 20px 20px" }}>
      <p style={{ fontSize: 13, color: "var(--ink-muted)" }}>
        Billing: {org.billing_contact_name || "no contact"} {org.billing_email} {org.billing_phone}
      </p>
      <h3 style={{ fontSize: 14 }}>Members</h3>
      <form className="filter-row" onSubmit={addMember}>
        <input placeholder="Member's email or phone" value={identifier} onChange={(e) => setIdentifier(e.target.value)} required />
        <input placeholder="Monthly limit GH₵ (optional)" value={limit} onChange={(e) => setLimit(e.target.value)} />
        <button className="btn btn-primary" type="submit">Add member</button>
      </form>
      {msg && <p style={{ color: "var(--danger)", fontSize: 13 }}>{msg}</p>}
      <table className="data-table">
        <thead><tr><th>Name</th><th>Contact</th><th>Limit</th><th>Left this month</th><th></th></tr></thead>
        <tbody>
          {members.filter((m) => m.active).map((m) => (
            <tr key={m.id}>
              <td>{m.name || "—"}</td>
              <td>{m.email || m.phone}</td>
              <td>{m.monthly_limit ? `GH₵${m.monthly_limit}` : "No limit"}</td>
              <td>{m.remaining_this_month != null ? `GH₵${m.remaining_this_month}` : "—"}</td>
              <td><button className="btn btn-ghost" onClick={() => removeMember(m)}>Remove</button></td>
            </tr>
          ))}
        </tbody>
      </table>

      <BalanceAndVouchers org={org} onChanged={onChanged} />

      <h3 style={{ fontSize: 14, marginTop: 20 }}>Invoices</h3>
      <div className="btn-row" style={{ marginBottom: 8 }}>
        <button className="btn btn-ghost" onClick={invoiceLastMonth}>Generate last month's invoice</button>
        <button className="btn btn-ghost" onClick={toggleActive}>{org.active ? "Pause billing" : "Resume billing"}</button>
      </div>
      {invoices.length === 0 ? <p style={{ fontSize: 13, color: "var(--ink-muted)" }}>No invoices yet.</p> : (
        <table className="data-table">
          <thead><tr><th>Period</th><th>Trips</th><th>Total</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {invoices.map((inv) => (
              <tr key={inv.id}>
                <td>{inv.period_start} to {inv.period_end}</td>
                <td>{inv.line_items.length}</td>
                <td><strong>GH₵{inv.total}</strong></td>
                <td><StatusBadge status={inv.status} /></td>
                <td className="btn-row">
                  {inv.status === "draft" && <button className="btn btn-ghost" onClick={() => setInvoiceStatus(inv, "sent")}>Mark sent</button>}
                  {inv.status !== "paid" && <button className="btn btn-success" onClick={() => setInvoiceStatus(inv, "paid")}>Mark paid</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** WR-21: pre-funded balance (optional) and vouchers the organization hands out. */
function BalanceAndVouchers({ org, onChanged }: { org: Org; onChanged: () => void }) {
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [vouchers, setVouchers] = useState<Voucher[]>([]);
  const [issue, setIssue] = useState({ count: "10", kind: "rides", value: "", ride_count: "1", expires_at: "" });
  const [msg, setMsg] = useState<string | null>(null);

  function loadVouchers() {
    api.get<Voucher[]>(`/admin/organizations/${org.id}/vouchers`).then(({ data }) => setVouchers(data));
  }
  useEffect(loadVouchers, [org.id]);

  async function topUp(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    try {
      await api.post(`/admin/organizations/${org.id}/top-up`, { amount, reference });
      setAmount(""); setReference("");
      onChanged();
    } catch (err: any) {
      setMsg(err?.response?.data?.detail || "Couldn't record that top-up.");
    }
  }

  async function issueVouchers(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    try {
      await api.post(`/admin/organizations/${org.id}/vouchers`, {
        count: Number(issue.count), kind: issue.kind,
        value: issue.kind === "value" ? issue.value : undefined,
        ride_count: issue.kind === "rides" ? Number(issue.ride_count) : undefined,
        expires_at: issue.expires_at || undefined,
      });
      loadVouchers();
    } catch (err: any) {
      setMsg(err?.response?.data?.detail || "Couldn't issue vouchers.");
    }
  }

  async function voidVoucher(v: Voucher) {
    if (!window.confirm(`Void ${v.code}? It can't be used after this.`)) return;
    await api.post(`/admin/vouchers/${v.id}/void`);
    loadVouchers();
  }

  function copyUnused() {
    const codes = vouchers.filter((v) => !v.redeemed_by_name && !v.voided).map((v) => v.code).join("\n");
    navigator.clipboard.writeText(codes);
    setMsg(`${codes.split("\n").filter(Boolean).length} unused codes copied.`);
  }

  return (
    <>
      <h3 style={{ fontSize: 14, marginTop: 20 }}>Prepaid balance</h3>
      <p style={{ fontSize: 13, color: "var(--ink-muted)", margin: "0 0 8px" }}>
        {org.prepaid_balance != null
          ? `GH₵${org.prepaid_balance} left. Rides draw from this; new rides are refused once it can't cover them.`
          : "Not pre-funded: rides are invoiced monthly. Recording a top-up switches this organization to pre-funded."}
      </p>
      <form className="filter-row" onSubmit={topUp}>
        <input placeholder="Amount GH₵" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required />
        <input placeholder="Receipt / MoMo reference" value={reference} onChange={(e) => setReference(e.target.value)} />
        <button className="btn btn-primary" type="submit">Record top-up</button>
      </form>

      <h3 style={{ fontSize: 14, marginTop: 20 }}>Vouchers</h3>
      <form className="filter-row" onSubmit={issueVouchers}>
        <input style={{ width: 70 }} aria-label="How many" value={issue.count} onChange={(e) => setIssue({ ...issue, count: e.target.value })} />
        <select value={issue.kind} onChange={(e) => setIssue({ ...issue, kind: e.target.value })}>
          <option value="rides">Rides</option>
          <option value="value">GH₵ value</option>
        </select>
        {issue.kind === "rides"
          ? <input style={{ width: 90 }} aria-label="Rides each" value={issue.ride_count} onChange={(e) => setIssue({ ...issue, ride_count: e.target.value })} />
          : <input style={{ width: 90 }} aria-label="GH₵ each" placeholder="GH₵ each" value={issue.value} onChange={(e) => setIssue({ ...issue, value: e.target.value })} />}
        <label style={{ fontSize: 13 }}>Expires <input type="date" value={issue.expires_at} onChange={(e) => setIssue({ ...issue, expires_at: e.target.value })} /></label>
        <button className="btn btn-primary" type="submit">Issue</button>
        <button className="btn btn-ghost" type="button" onClick={copyUnused}>Copy unused codes</button>
      </form>
      {msg && <p style={{ fontSize: 13 }}>{msg}</p>}
      {vouchers.length > 0 && (
        <table className="data-table">
          <thead><tr><th>Code</th><th>Worth</th><th>Left</th><th>Holder</th><th>Expires</th><th></th></tr></thead>
          <tbody>
            {vouchers.slice(0, 100).map((v) => (
              <tr key={v.id} style={v.voided ? { opacity: 0.5 } : undefined}>
                <td><code>{v.code}</code></td>
                <td>{v.kind === "rides" ? `${v.ride_count} ride(s)` : `GH₵${v.value}`}</td>
                <td>{v.kind === "rides" ? v.rides_remaining : `GH₵${v.value_remaining}`}</td>
                <td>{v.voided ? "Voided" : v.redeemed_by_name || "Unused"}</td>
                <td>{v.expires_at ? new Date(v.expires_at).toLocaleDateString() : "—"}</td>
                <td>{!v.voided && <button className="btn btn-ghost" onClick={() => voidVoucher(v)}>Void</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
