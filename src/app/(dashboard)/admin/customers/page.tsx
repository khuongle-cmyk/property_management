"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { getSupabaseClient } from "@/lib/supabase/browser";
import { formatDate } from "@/lib/date/format";

const PETROL = "#0D4F4F";
const PETROL_HOVER = "#0a3f3f";

const COMPANY_SIZES = ["1-5", "6-10", "11-25", "26-50", "51-100", "100+"] as const;
const SPACE_TYPES = ["Office", "Meeting room", "Venue", "Coworking", "Virtual Office"] as const;

type TenantRow = { id: string; name: string };
type PropertyRow = { id: string; name: string; city: string | null; tenant_id: string };
type CompanyRow = {
  id: string;
  property_id: string | null;
  name: string;
  business_id: string | null;
  email: string | null;
  phone: string | null;
  address_line: string | null;
  city: string | null;
  postal_code: string | null;
  industry: string | null;
  company_size: string | null;
  space_type: string | null;
  contract_start: string | null;
  contract_end: string | null;
  notes: string | null;
  properties: { name: string; tenant_id?: string | null } | { name: string; tenant_id?: string | null }[] | null;
};

function propertyName(p: CompanyRow["properties"]): string {
  if (!p) return "—";
  if (Array.isArray(p)) return p[0]?.name ?? "—";
  return p.name ?? "—";
}

function contractStatus(contractEnd: string | null): { label: string; kind: "active" | "expired" } {
  if (!contractEnd) return { label: "Active", kind: "active" };
  const end = +new Date(contractEnd);
  if (!Number.isFinite(end)) return { label: "Active", kind: "active" };
  return end >= +new Date(new Date().toDateString()) ? { label: "Active", kind: "active" } : { label: "Expired", kind: "expired" };
}

function badgeContract(kind: "active" | "expired"): React.CSSProperties {
  if (kind === "active") return { fontSize: 12, padding: "2px 8px", borderRadius: 999, background: "#dcfce7", color: "#15803d" };
  return { fontSize: 12, padding: "2px 8px", borderRadius: 999, background: "#e2e8f0", color: "#475569" };
}

const defaultForm = () => ({
  tenantId: "",
  name: "",
  businessId: "",
  email: "",
  phone: "",
  addressLine: "",
  city: "",
  postalCode: "",
  industry: "",
  companySize: "" as (typeof COMPANY_SIZES)[number] | "",
  propertyId: "",
  spaceType: "" as (typeof SPACE_TYPES)[number] | "",
  contractStart: "",
  contractEnd: "",
  notes: "",
});

export default function AdminCustomersPage() {
  const router = useRouter();
  const supabase = useMemo(() => getSupabaseClient(), []);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [companies, setCompanies] = useState<CompanyRow[]>([]);
  const [empCounts, setEmpCounts] = useState<Record<string, number>>({});
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [properties, setProperties] = useState<PropertyRow[]>([]);
  const [search, setSearch] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState(defaultForm);
  const [defaultTenantId, setDefaultTenantId] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      router.replace("/login");
      return;
    }
    const { data: mems } = await supabase.from("memberships").select("role").eq("user_id", user.id);
    const roles = (mems ?? []).map((m) => (m.role ?? "").toLowerCase());
    const sa = roles.includes("super_admin");
    setIsSuperAdmin(sa);
    if (!sa && !roles.some((r) => ["owner", "manager"].includes(r))) {
      setError("You do not have access to customer companies.");
      setLoading(false);
      return;
    }

    let firstTenantId = "";
    if (!sa) {
      const { data: mm } = await supabase.from("memberships").select("tenant_id").eq("user_id", user.id);
      const tids = [...new Set((mm ?? []).map((m) => m.tenant_id).filter(Boolean))] as string[];
      firstTenantId = tids[0] ?? "";
      setDefaultTenantId(firstTenantId);
    } else {
      setDefaultTenantId("");
    }

    if (sa) {
      const { data: trows } = await supabase.from("tenants").select("id, name").order("name");
      setTenants((trows as TenantRow[]) ?? []);
    } else if (firstTenantId) {
      const { data: tr } = await supabase.from("tenants").select("id, name").eq("id", firstTenantId).maybeSingle();
      setTenants(tr ? ([tr] as TenantRow[]) : []);
    } else {
      setTenants([]);
    }

    const { data: prows } = await supabase.from("properties").select("id, name, city, tenant_id").order("name");
    setProperties((prows as PropertyRow[]) ?? []);

    const { data: crows, error: cErr } = await supabase
      .from("customer_companies")
      .select(
        "id, property_id, name, business_id, email, phone, address_line, city, postal_code, industry, company_size, space_type, contract_start, contract_end, notes, properties(name, tenant_id)",
      )
      .order("name", { ascending: true });

    if (cErr) {
      setError(cErr.message);
      setLoading(false);
      return;
    }
    const list = (crows ?? []) as unknown as CompanyRow[];
    setCompanies(list);

    if (list.length) {
      const ids = list.map((c) => c.id);
      const { data: counts } = await supabase.from("customer_users").select("company_id").in("company_id", ids);
      const map: Record<string, number> = {};
      for (const row of counts ?? []) {
        const id = (row as { company_id: string }).company_id;
        map[id] = (map[id] ?? 0) + 1;
      }
      setEmpCounts(map);
    } else {
      setEmpCounts({});
    }

    setLoading(false);
  }, [router, supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  const propertiesForTenant = useMemo(() => {
    if (!form.tenantId) return properties;
    return properties.filter((p) => p.tenant_id === form.tenantId);
  }, [properties, form.tenantId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return companies;
    return companies.filter((c) => {
      const blob = [c.name, c.business_id ?? "", c.email ?? "", c.phone ?? ""].join(" ").toLowerCase();
      return blob.includes(q);
    });
  }, [companies, search]);

  function openCreate() {
    setForm({ ...defaultForm(), tenantId: isSuperAdmin ? "" : defaultTenantId });
    setFormError(null);
    setShowModal(true);
  }

  async function submitCreate(e: FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.tenantId) {
      setFormError("Company name and organization are required.");
      return;
    }
    setSaving(true);
    setFormError(null);
    const res = await fetch("/api/customer-companies", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenantId: form.tenantId,
        propertyId: form.propertyId || null,
        name: form.name.trim(),
        businessId: form.businessId || null,
        email: form.email || null,
        phone: form.phone || null,
        addressLine: form.addressLine || null,
        city: form.city || null,
        postalCode: form.postalCode || null,
        industry: form.industry || null,
        companySize: form.companySize || null,
        spaceType: form.spaceType || null,
        contractStart: form.contractStart || null,
        contractEnd: form.contractEnd || null,
        notes: form.notes || null,
      }),
    });
    const json = (await res.json()) as { error?: string; companyId?: string };
    setSaving(false);
    if (!res.ok) {
      setFormError(json.error ?? "Could not create company.");
      return;
    }
    setShowModal(false);
    await load();
    if (json.companyId) router.push(`/admin/customers/${json.companyId}`);
  }

  async function deleteCompany(id: string, name: string) {
    if (!confirm(`Delete company “${name}”? This removes all employee links.`)) return;
    const { error: dErr } = await supabase.from("customer_companies").delete().eq("id", id);
    if (dErr) {
      setError(dErr.message);
      return;
    }
    await load();
  }

  const th: React.CSSProperties = {
    textAlign: "left",
    padding: "10px 12px",
    background: PETROL,
    color: "#fff",
    fontWeight: 600,
    fontSize: 13,
    whiteSpace: "nowrap",
  };
  const td: React.CSSProperties = { padding: "10px 12px", borderBottom: "1px solid #e5e7eb", fontSize: 13 };

  return (
    <DashboardLayout>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <h1 className="vw-admin-page-title" style={{ margin: 0 }}>Customer Companies</h1>
        <button
          type="button"
          onClick={openCreate}
          style={{
            padding: "10px 18px",
            borderRadius: 10,
            border: "none",
            background: PETROL,
            color: "#fff",
            fontWeight: 600,
            cursor: "pointer",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = PETROL_HOVER;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = PETROL;
          }}
        >
          Create Company
        </button>
      </div>

      <label style={{ display: "block", maxWidth: 400 }}>
        <span style={{ fontSize: 12, color: "#64748b", fontWeight: 500 }}>Search</span>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Company name, Y-tunnus, email…"
          style={{ marginTop: 4, width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 14 }}
        />
      </label>

      {error ? (
        <p style={{ color: "#b00020" }} role="alert">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p style={{ color: "#64748b" }}>Loading…</p>
      ) : (
        <div style={{ overflowX: "auto", border: "1px solid #e5e7eb", borderRadius: 12, background: "#fff" }}>
          <table style={{ width: "100%", minWidth: 900, borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Company name", "Y-tunnus", "Contact email", "Phone", "Property", "Employees", "Contract start", "Status", "Actions"].map(
                  (h) => (
                    <th key={h} style={th}>
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => {
                const st = contractStatus(c.contract_end);
                return (
                  <tr key={c.id}>
                    <td style={td}>
                      <Link href={`/admin/customers/${c.id}`} style={{ fontWeight: 600, color: PETROL }}>
                        {c.name}
                      </Link>
                    </td>
                    <td style={td}>{c.business_id ?? "—"}</td>
                    <td style={td}>{c.email ?? "—"}</td>
                    <td style={td}>{c.phone ?? "—"}</td>
                    <td style={td}>{propertyName(c.properties)}</td>
                    <td style={td}>{empCounts[c.id] ?? 0}</td>
                    <td style={td}>{c.contract_start ? formatDate(c.contract_start) : "—"}</td>
                    <td style={td}>
                      <span style={badgeContract(st.kind)}>{st.label}</span>
                    </td>
                    <td style={{ ...td, whiteSpace: "nowrap" }}>
                      <Link href={`/admin/customers/${c.id}`} style={{ color: PETROL, fontWeight: 500 }}>
                        View
                      </Link>
                      {" · "}
                      <Link href={`/admin/customers/${c.id}?edit=1`} style={{ color: PETROL }}>
                        Edit
                      </Link>
                      {" · "}
                      <button
                        type="button"
                        onClick={() => void deleteCompany(c.id, c.name)}
                        style={{ background: "none", border: "none", color: "#b91c1c", cursor: "pointer", padding: 0, font: "inherit" }}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filtered.length === 0 ? <p style={{ padding: 16, margin: 0, color: "#64748b" }}>No companies match.</p> : null}
        </div>
      )}

      {showModal ? (
        <div
          role="presentation"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 10000,
            background: "rgba(0,0,0,0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
          onClick={() => !saving && setShowModal(false)}
        >
          <div
            role="dialog"
            onClick={(ev) => ev.stopPropagation()}
            style={{
              background: "#fff",
              borderRadius: 16,
              padding: 24,
              maxWidth: 520,
              width: "100%",
              maxHeight: "min(90vh, 880px)",
              overflowY: "auto",
            }}
          >
            <h2 style={{ margin: "0 0 16px", fontSize: 20, fontWeight: 700 }}>Create Company</h2>
            <form onSubmit={(e) => void submitCreate(e)} style={{ display: "grid", gap: 12 }}>
              {isSuperAdmin ? (
                <label style={{ display: "grid", gap: 4, fontSize: 13, fontWeight: 500 }}>
                  Organization *
                  <select
                    required
                    value={form.tenantId}
                    onChange={(e) => setForm((f) => ({ ...f, tenantId: e.target.value, propertyId: "" }))}
                    style={{ padding: 10, borderRadius: 8, border: "1px solid #e2e8f0" }}
                  >
                    <option value="">Select…</option>
                    {tenants.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <p style={{ margin: 0, fontSize: 13, color: "#64748b" }}>
                  Organization is set from your account.{" "}
                  <span style={{ fontWeight: 600, color: "#0f172a" }}>{tenants.find((t) => t.id === form.tenantId)?.name ?? "—"}</span>
                </p>
              )}
              <label style={{ display: "grid", gap: 4, fontSize: 13, fontWeight: 500 }}>
                Company name *
                <input
                  required
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  style={{ padding: 10, borderRadius: 8, border: "1px solid #e2e8f0" }}
                />
              </label>
              <label style={{ display: "grid", gap: 4, fontSize: 13, fontWeight: 500 }}>
                Y-tunnus / Business ID
                <input
                  value={form.businessId}
                  onChange={(e) => setForm((f) => ({ ...f, businessId: e.target.value }))}
                  style={{ padding: 10, borderRadius: 8, border: "1px solid #e2e8f0" }}
                />
              </label>
              <label style={{ display: "grid", gap: 4, fontSize: 13, fontWeight: 500 }}>
                Email
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  style={{ padding: 10, borderRadius: 8, border: "1px solid #e2e8f0" }}
                />
              </label>
              <label style={{ display: "grid", gap: 4, fontSize: 13, fontWeight: 500 }}>
                Phone
                <input
                  value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                  style={{ padding: 10, borderRadius: 8, border: "1px solid #e2e8f0" }}
                />
              </label>
              <label style={{ display: "grid", gap: 4, fontSize: 13, fontWeight: 500 }}>
                Address
                <input
                  value={form.addressLine}
                  onChange={(e) => setForm((f) => ({ ...f, addressLine: e.target.value }))}
                  style={{ padding: 10, borderRadius: 8, border: "1px solid #e2e8f0" }}
                />
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <label style={{ display: "grid", gap: 4, fontSize: 13, fontWeight: 500 }}>
                  City
                  <input
                    value={form.city}
                    onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
                    style={{ padding: 10, borderRadius: 8, border: "1px solid #e2e8f0" }}
                  />
                </label>
                <label style={{ display: "grid", gap: 4, fontSize: 13, fontWeight: 500 }}>
                  Postal code
                  <input
                    value={form.postalCode}
                    onChange={(e) => setForm((f) => ({ ...f, postalCode: e.target.value }))}
                    style={{ padding: 10, borderRadius: 8, border: "1px solid #e2e8f0" }}
                  />
                </label>
              </div>
              <label style={{ display: "grid", gap: 4, fontSize: 13, fontWeight: 500 }}>
                Industry
                <input
                  value={form.industry}
                  onChange={(e) => setForm((f) => ({ ...f, industry: e.target.value }))}
                  style={{ padding: 10, borderRadius: 8, border: "1px solid #e2e8f0" }}
                />
              </label>
              <label style={{ display: "grid", gap: 4, fontSize: 13, fontWeight: 500 }}>
                Company size
                <select
                  value={form.companySize}
                  onChange={(e) => setForm((f) => ({ ...f, companySize: e.target.value as (typeof COMPANY_SIZES)[number] }))}
                  style={{ padding: 10, borderRadius: 8, border: "1px solid #e2e8f0" }}
                >
                  <option value="">—</option>
                  {COMPANY_SIZES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ display: "grid", gap: 4, fontSize: 13, fontWeight: 500 }}>
                Property
                <select
                  value={form.propertyId}
                  onChange={(e) => setForm((f) => ({ ...f, propertyId: e.target.value }))}
                  style={{ padding: 10, borderRadius: 8, border: "1px solid #e2e8f0" }}
                >
                  <option value="">— None —</option>
                  {(isSuperAdmin ? propertiesForTenant : properties).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.city ? ` — ${p.city}` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ display: "grid", gap: 4, fontSize: 13, fontWeight: 500 }}>
                Space type
                <select
                  value={form.spaceType}
                  onChange={(e) => setForm((f) => ({ ...f, spaceType: e.target.value as (typeof SPACE_TYPES)[number] }))}
                  style={{ padding: 10, borderRadius: 8, border: "1px solid #e2e8f0" }}
                >
                  <option value="">—</option>
                  {SPACE_TYPES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <label style={{ display: "grid", gap: 4, fontSize: 13, fontWeight: 500 }}>
                  Contract start
                  <input
                    type="date"
                    value={form.contractStart}
                    onChange={(e) => setForm((f) => ({ ...f, contractStart: e.target.value }))}
                    style={{ padding: 10, borderRadius: 8, border: "1px solid #e2e8f0" }}
                  />
                </label>
                <label style={{ display: "grid", gap: 4, fontSize: 13, fontWeight: 500 }}>
                  Contract end
                  <input
                    type="date"
                    value={form.contractEnd}
                    onChange={(e) => setForm((f) => ({ ...f, contractEnd: e.target.value }))}
                    style={{ padding: 10, borderRadius: 8, border: "1px solid #e2e8f0" }}
                  />
                </label>
              </div>
              <label style={{ display: "grid", gap: 4, fontSize: 13, fontWeight: 500 }}>
                Notes
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  rows={3}
                  style={{ padding: 10, borderRadius: 8, border: "1px solid #e2e8f0", resize: "vertical" }}
                />
              </label>
              {formError ? <p style={{ color: "#b00020", margin: 0 }}>{formError}</p> : null}
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <button
                  type="button"
                  onClick={() => !saving && setShowModal(false)}
                  style={{ padding: "10px 16px", borderRadius: 8, border: "1px solid #e2e8f0", background: "#fff", cursor: "pointer" }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  style={{
                    padding: "10px 16px",
                    borderRadius: 8,
                    border: "none",
                    background: PETROL,
                    color: "#fff",
                    fontWeight: 600,
                    cursor: saving ? "wait" : "pointer",
                  }}
                >
                  {saving ? "Saving…" : "Create"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </DashboardLayout>
  );
}
