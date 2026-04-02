"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { getSupabaseClient } from "@/lib/supabase/browser";
import { formatDate } from "@/lib/date/format";
import { tenantIdFromCompanyPropertyJoin } from "@/lib/customer-companies/tenant-from-property";

const PETROL = "#0D4F4F";

const COMPANY_SIZES = ["1-5", "6-10", "11-25", "26-50", "51-100", "100+"] as const;
const SPACE_TYPES = ["Office", "Meeting room", "Venue", "Coworking", "Virtual Office"] as const;

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

type EmployeeRow = {
  id: string;
  auth_user_id: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string;
  phone: string | null;
  role: string;
  status: string;
  invited_at: string;
};

function roleBadge(role: string): React.CSSProperties {
  const admin = role === "company_admin";
  return {
    fontSize: 12,
    padding: "2px 8px",
    borderRadius: 999,
    background: admin ? "#dbeafe" : "#f1f5f9",
    color: admin ? "#1d4ed8" : "#475569",
    fontWeight: 500,
  };
}

function statusBadge(status: string): React.CSSProperties {
  if (status === "active") return { fontSize: 12, padding: "2px 8px", borderRadius: 999, background: "#dcfce7", color: "#15803d" };
  if (status === "invited") return { fontSize: 12, padding: "2px 8px", borderRadius: 999, background: "#fef9c3", color: "#a16207" };
  return { fontSize: 12, padding: "2px 8px", borderRadius: 999, background: "#e2e8f0", color: "#475569" };
}

export default function AdminCustomerDetailPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const id = typeof params.id === "string" ? params.id : "";

  const supabase = useMemo(() => getSupabaseClient(), []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [company, setCompany] = useState<CompanyRow | null>(null);
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [properties, setProperties] = useState<{ id: string; name: string; city: string | null; tenant_id: string }[]>([]);
  const [tenants, setTenants] = useState<{ id: string; name: string }[]>([]);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);

  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<Record<string, string>>({});
  const [savingCompany, setSavingCompany] = useState(false);

  const [inviteOpen, setInviteOpen] = useState<"admin" | "employee" | null>(null);
  const [inviteForm, setInviteForm] = useState({ firstName: "", lastName: "", email: "", phone: "" });
  const [inviteSaving, setInviteSaving] = useState(false);
  const [inviteErr, setInviteErr] = useState<string | null>(null);
  const [successBanner, setSuccessBanner] = useState<string | null>(null);

  const wantEdit = searchParams.get("edit") === "1";

  const load = useCallback(async () => {
    if (!id) return;
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
      setError("Access denied.");
      setLoading(false);
      return;
    }

    if (sa) {
      const { data: trows } = await supabase.from("tenants").select("id, name").order("name");
      setTenants((trows as { id: string; name: string }[]) ?? []);
    }
    const { data: prows } = await supabase.from("properties").select("id, name, city, tenant_id").order("name");
    setProperties((prows as { id: string; name: string; city: string | null; tenant_id: string }[]) ?? []);

    const { data: crow, error: cErr } = await supabase
      .from("customer_companies")
      .select(
        "id, property_id, name, business_id, email, phone, address_line, city, postal_code, industry, company_size, space_type, contract_start, contract_end, notes, properties(name, tenant_id)",
      )
      .eq("id", id)
      .maybeSingle();

    if (cErr || !crow) {
      setError(cErr?.message ?? "Company not found.");
      setLoading(false);
      return;
    }
    const c = crow as unknown as CompanyRow;
    setCompany(c);
    setEditForm({
      tenantId: tenantIdFromCompanyPropertyJoin(c.properties),
      name: c.name,
      businessId: c.business_id ?? "",
      email: c.email ?? "",
      phone: c.phone ?? "",
      addressLine: c.address_line ?? "",
      city: c.city ?? "",
      postalCode: c.postal_code ?? "",
      industry: c.industry ?? "",
      companySize: c.company_size ?? "",
      propertyId: c.property_id ?? "",
      spaceType: c.space_type ?? "",
      contractStart: c.contract_start ?? "",
      contractEnd: c.contract_end ?? "",
      notes: c.notes ?? "",
    });

    const { data: emps } = await supabase
      .from("customer_users")
      .select("id, auth_user_id, first_name, last_name, email, phone, role, status, invited_at")
      .eq("company_id", id)
      .order("invited_at", { ascending: false });
    setEmployees((emps as EmployeeRow[]) ?? []);

    setLoading(false);
  }, [id, router, supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (wantEdit && company) setEditing(true);
  }, [wantEdit, company]);

  async function saveCompany(e: FormEvent) {
    e.preventDefault();
    if (!company) return;
    setSavingCompany(true);
    const { error: uErr } = await supabase
      .from("customer_companies")
      .update({
        property_id: editForm.propertyId || null,
        name: editForm.name.trim(),
        business_id: editForm.businessId || null,
        email: editForm.email || null,
        phone: editForm.phone || null,
        address_line: editForm.addressLine || null,
        city: editForm.city || null,
        postal_code: editForm.postalCode || null,
        industry: editForm.industry || null,
        company_size: editForm.companySize || null,
        space_type: editForm.spaceType || null,
        contract_start: editForm.contractStart || null,
        contract_end: editForm.contractEnd || null,
        notes: editForm.notes || null,
      } as never)
      .eq("id", company.id);
    setSavingCompany(false);
    if (uErr) {
      setError(uErr.message);
      return;
    }
    setEditing(false);
    router.replace(`/admin/customers/${id}`);
    await load();
  }

  async function updateEmployeeRole(empId: string, role: string) {
    const { error: uErr } = await supabase.from("customer_users").update({ role } as never).eq("id", empId);
    if (uErr) setError(uErr.message);
    else await load();
  }

  async function deactivateEmployee(empId: string) {
    if (!confirm("Deactivate this user?")) return;
    const { error: uErr } = await supabase.from("customer_users").update({ status: "inactive" } as never).eq("id", empId);
    if (uErr) setError(uErr.message);
    else await load();
  }

  async function removeEmployee(empId: string) {
    if (!confirm("Remove this person from the company?")) return;
    const { error: dErr } = await supabase.from("customer_users").delete().eq("id", empId);
    if (dErr) setError(dErr.message);
    else await load();
  }

  async function submitInvite(e: FormEvent) {
    e.preventDefault();
    if (!company || !inviteForm.email.trim()) return;
    setInviteSaving(true);
    setInviteErr(null);
    const role = inviteOpen === "admin" ? "company_admin" : "employee";
    const res = await fetch("/api/admin/invite-customer", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: inviteForm.email.trim(),
        firstName: inviteForm.firstName.trim(),
        lastName: inviteForm.lastName.trim(),
        phone: inviteForm.phone.trim() || null,
        companyId: company.id,
        role,
      }),
    });
    const json = (await res.json()) as { error?: string; message?: string };
    setInviteSaving(false);
    if (!res.ok) {
      setInviteErr(json.error ?? "Failed");
      return;
    }
    setSuccessBanner(json.message ?? "Invitation sent. The user will receive an email to access the customer portal.");
    setInviteForm({ firstName: "", lastName: "", email: "", phone: "" });
    setInviteOpen(null);
    await load();
  }

  const propsForTenant = useMemo(() => {
    if (!company) return properties;
    const tid = editForm.tenantId || tenantIdFromCompanyPropertyJoin(company.properties);
    return properties.filter((p) => p.tenant_id === tid);
  }, [properties, company, editForm.tenantId]);

  const th: React.CSSProperties = {
    textAlign: "left",
    padding: "10px 12px",
    background: PETROL,
    color: "#fff",
    fontWeight: 600,
    fontSize: 13,
  };
  const td: React.CSSProperties = { padding: "10px 12px", borderBottom: "1px solid #e5e7eb", fontSize: 13 };

  if (loading && !company) {
    return (
      <DashboardLayout>
        <p style={{ color: "#64748b" }}>Loading…</p>
      </DashboardLayout>
    );
  }

  if (error && !company) {
    return (
      <DashboardLayout>
        <p style={{ color: "#b00020" }}>{error}</p>
        <Link href="/admin/customers">Back to list</Link>
      </DashboardLayout>
    );
  }

  if (!company) return null;

  return (
    <DashboardLayout>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, justifyContent: "space-between" }}>
        <div>
          <Link href="/admin/customers" style={{ fontSize: 13, color: PETROL, fontWeight: 500 }}>
            ← Customer Companies
          </Link>
          <h1 className="vw-admin-page-title" style={{ margin: "8px 0 0" }}>{company.name}</h1>
        </div>
        {!editing ? (
          <button
            type="button"
            onClick={() => setEditing(true)}
            style={{
              padding: "10px 18px",
              borderRadius: 10,
              border: `1px solid ${PETROL}`,
              background: "#fff",
              color: PETROL,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Edit
          </button>
        ) : null}
      </div>

      {error ? (
        <p style={{ color: "#b00020" }} role="alert">
          {error}
        </p>
      ) : null}

      <section
        style={{
          background: "#fff",
          border: "1px solid #e5e7eb",
          borderRadius: 12,
          padding: 20,
        }}
      >
        {!editing ? (
          <div style={{ display: "grid", gap: 10, fontSize: 14 }}>
            <div>
              <strong>Y-tunnus</strong> {company.business_id ?? "—"}
            </div>
            <div>
              <strong>Email</strong> {company.email ?? "—"}
            </div>
            <div>
              <strong>Phone</strong> {company.phone ?? "—"}
            </div>
            <div>
              <strong>Address</strong> {company.address_line ?? "—"}
            </div>
            <div>
              <strong>City / Postal</strong> {company.city ?? "—"} {company.postal_code ?? ""}
            </div>
            <div>
              <strong>Industry</strong> {company.industry ?? "—"}
            </div>
            <div>
              <strong>Company size</strong> {company.company_size ?? "—"}
            </div>
            <div>
              <strong>Property</strong> {propertyName(company.properties)}
            </div>
            <div>
              <strong>Space type</strong> {company.space_type ?? "—"}
            </div>
            <div>
              <strong>Contract</strong>{" "}
              {company.contract_start ? formatDate(company.contract_start) : "—"} →{" "}
              {company.contract_end ? formatDate(company.contract_end) : "—"}
            </div>
            <div>
              <strong>Notes</strong>
              <div style={{ whiteSpace: "pre-wrap", color: "#475569" }}>{company.notes ?? "—"}</div>
            </div>
          </div>
        ) : (
          <form onSubmit={(e) => void saveCompany(e)} style={{ display: "grid", gap: 12 }}>
            {isSuperAdmin ? (
              <label style={{ display: "grid", gap: 4, fontSize: 13, fontWeight: 500 }}>
                Organization
                <select
                  value={editForm.tenantId}
                  onChange={(e) => setEditForm((f) => ({ ...f, tenantId: e.target.value, propertyId: "" }))}
                  style={{ padding: 10, borderRadius: 8, border: "1px solid #e2e8f0" }}
                >
                  <option value="">Select organization…</option>
                  {tenants.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label style={{ display: "grid", gap: 4, fontSize: 13, fontWeight: 500 }}>
              Company name *
              <input
                required
                value={editForm.name}
                onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                style={{ padding: 10, borderRadius: 8, border: "1px solid #e2e8f0" }}
              />
            </label>
            <label style={{ display: "grid", gap: 4, fontSize: 13, fontWeight: 500 }}>
              Y-tunnus
              <input
                value={editForm.businessId}
                onChange={(e) => setEditForm((f) => ({ ...f, businessId: e.target.value }))}
                style={{ padding: 10, borderRadius: 8, border: "1px solid #e2e8f0" }}
              />
            </label>
            <label style={{ display: "grid", gap: 4, fontSize: 13, fontWeight: 500 }}>
              Email
              <input
                value={editForm.email}
                onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))}
                style={{ padding: 10, borderRadius: 8, border: "1px solid #e2e8f0" }}
              />
            </label>
            <label style={{ display: "grid", gap: 4, fontSize: 13, fontWeight: 500 }}>
              Phone
              <input
                value={editForm.phone}
                onChange={(e) => setEditForm((f) => ({ ...f, phone: e.target.value }))}
                style={{ padding: 10, borderRadius: 8, border: "1px solid #e2e8f0" }}
              />
            </label>
            <label style={{ display: "grid", gap: 4, fontSize: 13, fontWeight: 500 }}>
              Address
              <input
                value={editForm.addressLine}
                onChange={(e) => setEditForm((f) => ({ ...f, addressLine: e.target.value }))}
                style={{ padding: 10, borderRadius: 8, border: "1px solid #e2e8f0" }}
              />
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <label style={{ display: "grid", gap: 4, fontSize: 13, fontWeight: 500 }}>
                City
                <input
                  value={editForm.city}
                  onChange={(e) => setEditForm((f) => ({ ...f, city: e.target.value }))}
                  style={{ padding: 10, borderRadius: 8, border: "1px solid #e2e8f0" }}
                />
              </label>
              <label style={{ display: "grid", gap: 4, fontSize: 13, fontWeight: 500 }}>
                Postal code
                <input
                  value={editForm.postalCode}
                  onChange={(e) => setEditForm((f) => ({ ...f, postalCode: e.target.value }))}
                  style={{ padding: 10, borderRadius: 8, border: "1px solid #e2e8f0" }}
                />
              </label>
            </div>
            <label style={{ display: "grid", gap: 4, fontSize: 13, fontWeight: 500 }}>
              Industry
              <input
                value={editForm.industry}
                onChange={(e) => setEditForm((f) => ({ ...f, industry: e.target.value }))}
                style={{ padding: 10, borderRadius: 8, border: "1px solid #e2e8f0" }}
              />
            </label>
            <label style={{ display: "grid", gap: 4, fontSize: 13, fontWeight: 500 }}>
              Company size
              <select
                value={editForm.companySize}
                onChange={(e) => setEditForm((f) => ({ ...f, companySize: e.target.value }))}
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
                value={editForm.propertyId}
                onChange={(e) => setEditForm((f) => ({ ...f, propertyId: e.target.value }))}
                style={{ padding: 10, borderRadius: 8, border: "1px solid #e2e8f0" }}
              >
                <option value="">— None —</option>
                {propsForTenant.map((p) => (
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
                value={editForm.spaceType}
                onChange={(e) => setEditForm((f) => ({ ...f, spaceType: e.target.value }))}
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
                  value={editForm.contractStart}
                  onChange={(e) => setEditForm((f) => ({ ...f, contractStart: e.target.value }))}
                  style={{ padding: 10, borderRadius: 8, border: "1px solid #e2e8f0" }}
                />
              </label>
              <label style={{ display: "grid", gap: 4, fontSize: 13, fontWeight: 500 }}>
                Contract end
                <input
                  type="date"
                  value={editForm.contractEnd}
                  onChange={(e) => setEditForm((f) => ({ ...f, contractEnd: e.target.value }))}
                  style={{ padding: 10, borderRadius: 8, border: "1px solid #e2e8f0" }}
                />
              </label>
            </div>
            <label style={{ display: "grid", gap: 4, fontSize: 13, fontWeight: 500 }}>
              Notes
              <textarea
                value={editForm.notes}
                onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))}
                rows={3}
                style={{ padding: 10, borderRadius: 8, border: "1px solid #e2e8f0" }}
              />
            </label>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  router.replace(`/admin/customers/${id}`);
                }}
                style={{ padding: "10px 16px", borderRadius: 8, border: "1px solid #e2e8f0", background: "#fff", cursor: "pointer" }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingCompany}
                style={{
                  padding: "10px 16px",
                  borderRadius: 8,
                  border: "none",
                  background: PETROL,
                  color: "#fff",
                  fontWeight: 600,
                  cursor: savingCompany ? "wait" : "pointer",
                }}
              >
                {savingCompany ? "Saving…" : "Save"}
              </button>
            </div>
          </form>
        )}
      </section>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 20 }}>
        <button
          type="button"
          onClick={() => {
            setInviteOpen("admin");
            setInviteForm({ firstName: "", lastName: "", email: "", phone: "" });
            setInviteErr(null);
          }}
          style={{
            padding: "10px 16px",
            borderRadius: 10,
            border: "none",
            background: PETROL,
            color: "#fff",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Invite Company Admin
        </button>
        <button
          type="button"
          onClick={() => {
            setInviteOpen("employee");
            setInviteForm({ firstName: "", lastName: "", email: "", phone: "" });
            setInviteErr(null);
          }}
          style={{
            padding: "10px 16px",
            borderRadius: 10,
            border: `1px solid ${PETROL}`,
            background: "#fff",
            color: PETROL,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Invite Employee
        </button>
      </div>

      {successBanner ? (
        <p style={{ color: "#15803d", fontSize: 14, background: "#f0fdf4", padding: 12, borderRadius: 8, border: "1px solid #bbf7d0" }}>
          {successBanner}
        </p>
      ) : null}

      <h2 style={{ fontSize: 18, fontWeight: 700, marginTop: 24, color: "#0f172a" }}>Employees</h2>
      <div style={{ overflowX: "auto", border: "1px solid #e5e7eb", borderRadius: 12, background: "#fff" }}>
        <table style={{ width: "100%", minWidth: 720, borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {["Name", "Email", "Phone", "Role", "Status", "Invited", "Actions"].map((h) => (
                <th key={h} style={th}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {employees.map((em) => {
              const name = [em.first_name, em.last_name].filter(Boolean).join(" ") || "—";
              return (
                <tr key={em.id}>
                  <td style={td}>{name}</td>
                  <td style={td}>{em.email}</td>
                  <td style={td}>{em.phone ?? "—"}</td>
                  <td style={td}>
                    <select
                      value={em.role}
                      onChange={(e) => void updateEmployeeRole(em.id, e.target.value)}
                      style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid #e2e8f0", fontSize: 13 }}
                    >
                      <option value="company_admin">company_admin</option>
                      <option value="employee">employee</option>
                    </select>
                  </td>
                  <td style={td}>
                    <span style={statusBadge(em.status)}>{em.status}</span>
                  </td>
                  <td style={td}>{formatDate(em.invited_at)}</td>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>
                    <button
                      type="button"
                      onClick={() => void deactivateEmployee(em.id)}
                      style={{ background: "none", border: "none", color: PETROL, cursor: "pointer", padding: 0, font: "inherit" }}
                    >
                      Deactivate
                    </button>
                    {" · "}
                    <button
                      type="button"
                      onClick={() => void removeEmployee(em.id)}
                      style={{ background: "none", border: "none", color: "#b91c1c", cursor: "pointer", padding: 0, font: "inherit" }}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {employees.length === 0 ? <p style={{ padding: 16, margin: 0, color: "#64748b" }}>No employees yet.</p> : null}
      </div>

      {inviteOpen ? (
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
          onClick={() => !inviteSaving && setInviteOpen(null)}
        >
          <div
            role="dialog"
            onClick={(ev) => ev.stopPropagation()}
            style={{ background: "#fff", borderRadius: 16, padding: 24, maxWidth: 420, width: "100%" }}
          >
            <h3 style={{ margin: "0 0 12px", fontSize: 18 }}>
              {inviteOpen === "admin" ? "Invite Company Admin" : "Invite Employee"}
            </h3>
            <form onSubmit={(e) => void submitInvite(e)} style={{ display: "grid", gap: 10 }}>
              <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
                First name
                <input
                  value={inviteForm.firstName}
                  onChange={(e) => setInviteForm((f) => ({ ...f, firstName: e.target.value }))}
                  style={{ padding: 10, borderRadius: 8, border: "1px solid #e2e8f0" }}
                />
              </label>
              <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
                Last name
                <input
                  value={inviteForm.lastName}
                  onChange={(e) => setInviteForm((f) => ({ ...f, lastName: e.target.value }))}
                  style={{ padding: 10, borderRadius: 8, border: "1px solid #e2e8f0" }}
                />
              </label>
              <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
                Email *
                <input
                  required
                  type="email"
                  value={inviteForm.email}
                  onChange={(e) => setInviteForm((f) => ({ ...f, email: e.target.value }))}
                  style={{ padding: 10, borderRadius: 8, border: "1px solid #e2e8f0" }}
                />
              </label>
              <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
                Phone
                <input
                  value={inviteForm.phone}
                  onChange={(e) => setInviteForm((f) => ({ ...f, phone: e.target.value }))}
                  style={{ padding: 10, borderRadius: 8, border: "1px solid #e2e8f0" }}
                />
              </label>
              {inviteErr ? <p style={{ color: "#b00020", margin: 0 }}>{inviteErr}</p> : null}
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 }}>
                <button type="button" onClick={() => !inviteSaving && setInviteOpen(null)} style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid #e2e8f0", background: "#fff" }}>
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={inviteSaving}
                  style={{ padding: "8px 14px", borderRadius: 8, border: "none", background: PETROL, color: "#fff", fontWeight: 600 }}
                >
                  {inviteSaving ? "Sending…" : "Send invite"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </DashboardLayout>
  );
}
