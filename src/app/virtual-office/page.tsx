"use client";

import { useEffect, useMemo, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/browser";
import { loadScopedPropertiesForUser } from "@/lib/properties/scoped";
import { formatPropertyLabel } from "@/lib/properties/label";

type VOContract = {
  id: string;
  tenant_id: string;
  property_id: string;
  contact_id: string | null;
  contract_number: string;
  start_date: string;
  end_date: string | null;
  monthly_fee: number;
  status: "active" | "cancelled" | "suspended";
  includes_address: boolean;
  includes_mail_handling: boolean;
  includes_phone_answering: boolean;
  includes_meeting_room_credits: boolean;
  meeting_room_credits_hours: number;
  business_registration_address: boolean;
  notes: string | null;
};

type Property = { id: string; name: string | null; city: string | null; tenant_id: string };
type Contact = { id: string; company_name: string | null; business_id: string | null };

export default function VirtualOfficePage() {
  const [rows, setRows] = useState<VOContract[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [q, setQ] = useState("");
  const [propertyFilter, setPropertyFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, string | boolean>>({
    property_id: "",
    contact_id: "",
    contract_number: "",
    start_date: new Date().toISOString().slice(0, 10),
    end_date: "",
    monthly_fee: "",
    status: "active",
    includes_address: true,
    includes_mail_handling: false,
    includes_phone_answering: false,
    includes_meeting_room_credits: false,
    meeting_room_credits_hours: "0",
    business_registration_address: false,
    notes: "",
  });

  async function load() {
    const supabase = getSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const scoped = await loadScopedPropertiesForUser(supabase, user.id);
    const isSuperAdmin = scoped.isSuperAdmin;
    const tenantIds = scoped.tenantIds;
    if (!isSuperAdmin && !tenantIds.length) return;
    const voQuery = supabase.from("virtual_office_contracts").select("*").order("created_at", { ascending: false });
    const leadsQuery = supabase.from("leads").select("id,company_name,business_id").order("company_name", { ascending: true });
    const [{ data: voRows }, { data: leads }] = await Promise.all([
      isSuperAdmin ? voQuery : voQuery.in("tenant_id", tenantIds),
      isSuperAdmin ? leadsQuery : leadsQuery.in("tenant_id", tenantIds),
    ]);
    setRows((voRows ?? []) as VOContract[]);
    setProperties((scoped.properties as unknown as Property[]) ?? []);
    setContacts((leads ?? []) as Contact[]);
  }

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (propertyFilter && r.property_id !== propertyFilter) return false;
      if (statusFilter && r.status !== statusFilter) return false;
      if (q.trim()) {
        const c = contacts.find((x) => x.id === r.contact_id);
        const txt = `${c?.company_name ?? ""} ${c?.business_id ?? ""}`.toLowerCase();
        if (!txt.includes(q.trim().toLowerCase())) return false;
      }
      return true;
    });
  }, [rows, propertyFilter, statusFilter, q, contacts]);

  const stats = useMemo(() => {
    const total = filtered.length;
    const active = filtered.filter((r) => r.status === "active").length;
    const cancelled = filtered.filter((r) => r.status === "cancelled").length;
    const monthlyRevenue = filtered.filter((r) => r.status === "active").reduce((s, r) => s + Number(r.monthly_fee || 0), 0);
    return { total, active, cancelled, monthlyRevenue };
  }, [filtered]);

  async function saveContract() {
    setMsg(null);
    const propertyId = String(form.property_id ?? "");
    const prop = properties.find((p) => p.id === propertyId);
    if (!prop) {
      setMsg("Select property.");
      return;
    }
    const supabase = getSupabaseClient();
    const payload = {
      tenant_id: prop.tenant_id,
      property_id: propertyId,
      contact_id: String(form.contact_id ?? "") || null,
      contract_number: String(form.contract_number ?? "").trim(),
      start_date: String(form.start_date ?? "").slice(0, 10),
      end_date: String(form.end_date ?? "").slice(0, 10) || null,
      monthly_fee: Number(form.monthly_fee ?? 0),
      status: String(form.status ?? "active"),
      includes_address: !!form.includes_address,
      includes_mail_handling: !!form.includes_mail_handling,
      includes_phone_answering: !!form.includes_phone_answering,
      includes_meeting_room_credits: !!form.includes_meeting_room_credits,
      meeting_room_credits_hours: Number(form.meeting_room_credits_hours ?? 0),
      business_registration_address: !!form.business_registration_address,
      notes: String(form.notes ?? "").trim() || null,
    };
    const { error } = await supabase.from("virtual_office_contracts").insert(payload);
    if (error) {
      setMsg(error.message);
      return;
    }
    setMsg("Virtual office contract saved.");
    await load();
  }

  return (
    <main style={{ display: "grid", gap: 12 }}>
      <h1 className="vw-admin-page-title" style={{ margin: 0 }}>Virtual Office</h1>
      <section style={{ border: "1px solid #e5e7eb", borderRadius: 12, background: "#fff", padding: 12, display: "grid", gap: 10 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input placeholder="Search company or Y-tunnus" value={q} onChange={(e) => setQ(e.target.value)} />
          <select value={propertyFilter} onChange={(e) => setPropertyFilter(e.target.value)}>
            <option value="">All properties</option>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>{p.name ?? "Property"}</option>
            ))}
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All status</option>
            <option value="active">active</option>
            <option value="cancelled">cancelled</option>
            <option value="suspended">suspended</option>
          </select>
        </div>
        <p style={{ margin: 0, fontSize: 13 }}>
          Total clients: <strong>{stats.total}</strong> · Active: <strong>{stats.active}</strong> · Cancelled: <strong>{stats.cancelled}</strong> · Monthly revenue: <strong>EUR {stats.monthlyRevenue.toFixed(2)}</strong>
        </p>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead><tr>{["Company", "Property", "Monthly fee", "Services", "Contract", "Status"].map((h) => <th key={h} style={{ textAlign: "left", padding: 6, borderBottom: "1px solid #e5e7eb" }}>{h}</th>)}</tr></thead>
            <tbody>
              {filtered.map((r) => {
                const c = contacts.find((x) => x.id === r.contact_id);
                const p = properties.find((x) => x.id === r.property_id);
                const badges = [
                  r.includes_address ? "Address" : "",
                  r.includes_mail_handling ? "Mail" : "",
                  r.includes_phone_answering ? "Phone" : "",
                  r.includes_meeting_room_credits ? `Meeting ${r.meeting_room_credits_hours}h` : "",
                  r.business_registration_address ? "Registration" : "",
                ].filter(Boolean).join(", ");
                return (
                  <tr key={r.id}>
                    <td style={{ padding: 6, borderBottom: "1px solid #f1f5f9" }}>{c?.company_name ?? "—"} {c?.business_id ? `(${c.business_id})` : ""}</td>
                    <td style={{ padding: 6, borderBottom: "1px solid #f1f5f9" }}>{p?.name ?? "—"}</td>
                    <td style={{ padding: 6, borderBottom: "1px solid #f1f5f9" }}>EUR {Number(r.monthly_fee || 0).toFixed(2)}</td>
                    <td style={{ padding: 6, borderBottom: "1px solid #f1f5f9" }}>{badges || "—"}</td>
                    <td style={{ padding: 6, borderBottom: "1px solid #f1f5f9" }}>{r.start_date} {r.end_date ? `-> ${r.end_date}` : ""}</td>
                    <td style={{ padding: 6, borderBottom: "1px solid #f1f5f9" }}>{r.status}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section style={{ border: "1px solid #e5e7eb", borderRadius: 12, background: "#fff", padding: 12, display: "grid", gap: 8 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>Add virtual office contract</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 8 }}>
          <label>Client
            <select value={String(form.contact_id ?? "")} onChange={(e) => setForm((s) => ({ ...s, contact_id: e.target.value }))}>
              <option value="">Select client...</option>
              {contacts.map((c) => <option key={c.id} value={c.id}>{c.company_name ?? c.id}</option>)}
            </select>
          </label>
          <label>Property
            <select value={String(form.property_id ?? "")} onChange={(e) => setForm((s) => ({ ...s, property_id: e.target.value }))}>
              <option value="">Select property...</option>
              {properties.map((p) => <option key={p.id} value={p.id}>{formatPropertyLabel(p, { includeCity: true })}</option>)}
            </select>
          </label>
          <label>Contract number <input value={String(form.contract_number ?? "")} onChange={(e) => setForm((s) => ({ ...s, contract_number: e.target.value }))} /></label>
          <label>Monthly fee EUR <input type="number" min={0} step="0.01" value={String(form.monthly_fee ?? "")} onChange={(e) => setForm((s) => ({ ...s, monthly_fee: e.target.value }))} /></label>
          <label>Start date <input type="date" value={String(form.start_date ?? "")} onChange={(e) => setForm((s) => ({ ...s, start_date: e.target.value }))} /></label>
          <label>End date <input type="date" value={String(form.end_date ?? "")} onChange={(e) => setForm((s) => ({ ...s, end_date: e.target.value }))} /></label>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <label><input type="checkbox" checked={!!form.includes_address} onChange={(e) => setForm((s) => ({ ...s, includes_address: e.target.checked }))} /> Address</label>
          <label><input type="checkbox" checked={!!form.includes_mail_handling} onChange={(e) => setForm((s) => ({ ...s, includes_mail_handling: e.target.checked }))} /> Mail handling</label>
          <label><input type="checkbox" checked={!!form.includes_phone_answering} onChange={(e) => setForm((s) => ({ ...s, includes_phone_answering: e.target.checked }))} /> Phone answering</label>
          <label><input type="checkbox" checked={!!form.includes_meeting_room_credits} onChange={(e) => setForm((s) => ({ ...s, includes_meeting_room_credits: e.target.checked }))} /> Meeting room credits</label>
          <label><input type="checkbox" checked={!!form.business_registration_address} onChange={(e) => setForm((s) => ({ ...s, business_registration_address: e.target.checked }))} /> Business registration address</label>
          <label>Credits hours/month <input type="number" min={0} step="0.5" value={String(form.meeting_room_credits_hours ?? "0")} onChange={(e) => setForm((s) => ({ ...s, meeting_room_credits_hours: e.target.value }))} /></label>
        </div>
        <label>Notes <textarea rows={2} value={String(form.notes ?? "")} onChange={(e) => setForm((s) => ({ ...s, notes: e.target.value }))} /></label>
        <button type="button" onClick={() => void saveContract()} style={{ width: "fit-content" }}>Save contract</button>
        {msg ? <p style={{ margin: 0, color: "#1e3a8a" }}>{msg}</p> : null}
      </section>
    </main>
  );
}

