"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useCustomerPortal } from "@/context/CustomerPortalContext";
import { getSupabaseClient } from "@/lib/supabase/browser";

const PETROL = "#0D4F4F";

type EmployeeRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  phone: string | null;
  role: string;
  status: string;
};

export default function CustomerPortalCompanyPage() {
  const router = useRouter();
  const { company, customerUser, refetch: refetchPortal } = useCustomerPortal();
  const supabase = useMemo(() => getSupabaseClient(), []);
  const isAdmin = String(customerUser?.role ?? "").toLowerCase() === "company_admin";

  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteMsg, setInviteMsg] = useState<string | null>(null);
  const [inviteLoading, setInviteLoading] = useState(false);

  const [form, setForm] = useState({
    name: "",
    business_id: "",
    email: "",
    phone: "",
    address_line: "",
    city: "",
    postal_code: "",
    industry: "",
    company_size: "",
  });

  useEffect(() => {
    if (!isAdmin) {
      router.replace("/portal");
    }
  }, [isAdmin, router]);

  useEffect(() => {
    const c = company as Record<string, unknown> | null;
    if (!c) return;
    setForm({
      name: String(c.name ?? ""),
      business_id: String(c.business_id ?? ""),
      email: String(c.email ?? ""),
      phone: String(c.phone ?? ""),
      address_line: String(c.address_line ?? ""),
      city: String(c.city ?? ""),
      postal_code: String(c.postal_code ?? ""),
      industry: String(c.industry ?? ""),
      company_size: String(c.company_size ?? ""),
    });
  }, [company]);

  const loadEmployees = useCallback(async () => {
    if (!customerUser?.company_id || !isAdmin) return;
    setLoadErr(null);
    const { data, error } = await supabase
      .from("customer_users")
      .select("id, first_name, last_name, email, phone, role, status")
      .eq("company_id", customerUser.company_id)
      .order("email", { ascending: true });
    if (error) {
      setLoadErr(error.message);
      setEmployees([]);
      return;
    }
    setEmployees((data as EmployeeRow[]) ?? []);
  }, [customerUser?.company_id, isAdmin, supabase]);

  useEffect(() => {
    void loadEmployees();
  }, [loadEmployees]);

  async function saveCompany() {
    if (!company?.id) return;
    setSaving(true);
    setLoadErr(null);
    const { error } = await supabase
      .from("customer_companies")
      .update({
        name: form.name.trim() || "Company",
        business_id: form.business_id.trim() || null,
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        address_line: form.address_line.trim() || null,
        city: form.city.trim() || null,
        postal_code: form.postal_code.trim() || null,
        industry: form.industry.trim() || null,
        company_size: form.company_size.trim() || null,
      } as never)
      .eq("id", company.id);
    setSaving(false);
    if (error) {
      setLoadErr(error.message);
      return;
    }
    setEditing(false);
    await refetchPortal();
  }

  async function updateEmployeeRole(id: string, role: string) {
    setLoadErr(null);
    const { error } = await supabase.from("customer_users").update({ role } as never).eq("id", id);
    if (error) {
      setLoadErr(error.message);
      return;
    }
    void loadEmployees();
  }

  async function toggleEmployeeStatus(id: string, next: "active" | "inactive") {
    if (!confirm(next === "inactive" ? "Deactivate this employee?" : "Activate this employee?")) return;
    setLoadErr(null);
    const { error } = await supabase.from("customer_users").update({ status: next } as never).eq("id", id);
    if (error) {
      setLoadErr(error.message);
      return;
    }
    void loadEmployees();
  }

  async function submitInvite(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!customerUser?.company_id) return;
    const fd = new FormData(e.currentTarget);
    const firstName = String(fd.get("firstName") ?? "").trim();
    const lastName = String(fd.get("lastName") ?? "").trim();
    const email = String(fd.get("email") ?? "").trim().toLowerCase();
    const phone = String(fd.get("phone") ?? "").trim() || null;
    setInviteLoading(true);
    setInviteMsg(null);
    const res = await fetch("/api/admin/invite-customer", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        firstName,
        lastName,
        email,
        phone,
        companyId: customerUser.company_id,
        role: "employee",
      }),
    });
    const json = (await res.json()) as { ok?: boolean; message?: string; error?: string };
    setInviteLoading(false);
    if (!res.ok) {
      setInviteMsg(json.error ?? "Invite failed.");
      return;
    }
    setInviteMsg(json.message ?? "Invitation sent.");
    setInviteOpen(false);
    void loadEmployees();
    (e.target as HTMLFormElement).reset();
  }

  const th: CSSProperties = {
    textAlign: "left",
    padding: "10px 12px",
    background: PETROL,
    color: "#fff",
    fontWeight: 600,
    fontSize: 13,
  };
  const td: CSSProperties = { padding: "10px 12px", borderBottom: "1px solid #e5e7eb", fontSize: 13 };

  if (!isAdmin) {
    return <p style={{ color: "#64748b" }}>Redirecting…</p>;
  }

  if (!company?.id) {
    return <p style={{ color: "#64748b" }}>Loading company…</p>;
  }

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700, color: PETROL }}>My company</h1>
      {loadErr ? <p style={{ color: "#b91c1c" }}>{loadErr}</p> : null}
      {inviteMsg ? (
        <p style={{ color: "#15803d", background: "#ecfdf5", padding: 12, borderRadius: 8, margin: 0 }}>{inviteMsg}</p>
      ) : null}

      <section
        style={{
          background: "#fff",
          border: "1px solid #e5e7eb",
          borderRadius: 12,
          padding: 20,
          maxWidth: 640,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: PETROL }}>Company profile</h2>
          {!editing ? (
            <button type="button" className="vw-btn-secondary" onClick={() => setEditing(true)}>
              Edit
            </button>
          ) : (
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" className="vw-btn-secondary" onClick={() => setEditing(false)} disabled={saving}>
                Cancel
              </button>
              <button type="button" className="vw-btn-primary" onClick={() => void saveCompany()} disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          )}
        </div>
        <div style={{ display: "grid", gap: 12, marginTop: 16 }}>
          {(
            [
              ["name", "Company name"],
              ["business_id", "Y-tunnus"],
              ["email", "Email"],
              ["phone", "Phone"],
              ["address_line", "Address"],
              ["city", "City"],
              ["postal_code", "Postal code"],
              ["industry", "Industry"],
              ["company_size", "Company size"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} style={{ display: "grid", gap: 4, fontSize: 14, fontWeight: 500 }}>
              {label}
              <input
                className="vw-input"
                disabled={!editing}
                value={form[key]}
                onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
              />
            </label>
          ))}
        </div>
      </section>

      <section>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: PETROL }}>Employees</h2>
          <button type="button" className="vw-btn-primary" onClick={() => setInviteOpen(true)}>
            Invite employee
          </button>
        </div>
        <div style={{ overflowX: "auto", marginTop: 12, border: "1px solid #e5e7eb", borderRadius: 12, background: "#fff" }}>
          <table style={{ width: "100%", minWidth: 720, borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Name", "Email", "Phone", "Role", "Status", "Actions"].map((h) => (
                  <th key={h} style={th}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {employees.map((emp) => {
                const name = [emp.first_name, emp.last_name].filter(Boolean).join(" ") || "—";
                const roleLower = (emp.role ?? "").toLowerCase();
                return (
                  <tr key={emp.id}>
                    <td style={td}>{name}</td>
                    <td style={td}>{emp.email}</td>
                    <td style={td}>{emp.phone ?? "—"}</td>
                    <td style={td}>
                      <span
                        style={{
                          display: "inline-block",
                          padding: "2px 8px",
                          borderRadius: 8,
                          fontSize: 12,
                          fontWeight: 600,
                          background: roleLower === "company_admin" ? "#e0f2fe" : "#f1f5f9",
                          color: roleLower === "company_admin" ? "#0369a1" : "#475569",
                        }}
                      >
                        {roleLower === "company_admin" ? "Admin" : "Employee"}
                      </span>
                    </td>
                    <td style={td}>
                      <span
                        style={{
                          display: "inline-block",
                          padding: "2px 8px",
                          borderRadius: 8,
                          fontSize: 12,
                          fontWeight: 600,
                          background: emp.status === "active" ? "#dcfce7" : "#fee2e2",
                          color: emp.status === "active" ? "#15803d" : "#b91c1c",
                        }}
                      >
                        {emp.status}
                      </span>
                    </td>
                    <td style={td}>
                      {emp.id !== customerUser?.id ? (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                          <select
                            className="vw-input"
                            style={{ padding: "6px 8px", fontSize: 12, maxWidth: 140 }}
                            value={roleLower === "company_admin" ? "company_admin" : "employee"}
                            onChange={(e) => void updateEmployeeRole(emp.id, e.target.value)}
                            aria-label={`Role for ${emp.email}`}
                          >
                            <option value="employee">Employee</option>
                            <option value="company_admin">Company admin</option>
                          </select>
                          <button
                            type="button"
                            className="vw-btn-secondary"
                            style={{ padding: "6px 10px", fontSize: 12 }}
                            onClick={() =>
                              void toggleEmployeeStatus(emp.id, emp.status === "active" ? "inactive" : "active")
                            }
                          >
                            {emp.status === "active" ? "Deactivate" : "Activate"}
                          </button>
                        </div>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {inviteOpen ? (
        <div
          role="dialog"
          aria-modal
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15, 23, 42, 0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            zIndex: 50,
          }}
          onClick={() => setInviteOpen(false)}
        >
          <div
            style={{ background: "#fff", borderRadius: 12, padding: 24, maxWidth: 400, width: "100%" }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: "0 0 16px", fontSize: 18, color: PETROL }}>Invite employee</h3>
            <form onSubmit={(e) => void submitInvite(e)} style={{ display: "grid", gap: 12 }}>
              <label style={{ display: "grid", gap: 4, fontSize: 14 }}>
                First name
                <input name="firstName" className="vw-input" required />
              </label>
              <label style={{ display: "grid", gap: 4, fontSize: 14 }}>
                Last name
                <input name="lastName" className="vw-input" required />
              </label>
              <label style={{ display: "grid", gap: 4, fontSize: 14 }}>
                Email
                <input name="email" type="email" className="vw-input" required />
              </label>
              <label style={{ display: "grid", gap: 4, fontSize: 14 }}>
                Phone
                <input name="phone" type="tel" className="vw-input" />
              </label>
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button type="button" className="vw-btn-secondary" onClick={() => setInviteOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className="vw-btn-primary" disabled={inviteLoading}>
                  {inviteLoading ? "Sending…" : "Send invite"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
