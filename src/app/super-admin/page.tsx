"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { getSupabaseClient } from "@/lib/supabase/browser";
import LogoutButton from "../dashboard/LogoutButton";

type TenantRow = {
  id: string;
  name: string;
  contact_email: string | null;
  contact_phone: string | null;
};

type PropertyRow = {
  id: string;
  tenant_id: string | null;
  name: string | null;
  address: string | null;
  postal_code: string | null;
  city: string | null;
  total_units: number | null;
  occupied_units: number | null;
  status: string | null;
};

export default function SuperAdminDashboardPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [properties, setProperties] = useState<PropertyRow[]>([]);

  const [counts, setCounts] = useState<{
    users: number;
    properties: number;
    tenants: number;
  }>({ users: 0, properties: 0, tenants: 0 });

  const [tenantName, setTenantName] = useState("");
  const [ownerUserId, setOwnerUserId] = useState("");
  const [submitLoading, setSubmitLoading] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("manager");
  const [inviteTenantId, setInviteTenantId] = useState("");
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteMessage, setInviteMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchAll() {
      const supabase = getSupabaseClient();
      setLoading(true);
      setError(null);

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.push("/login");
        return;
      }

      const { data: memberships, error: membershipsError } = await supabase
        .from("memberships")
        .select("role");

      if (membershipsError) {
        if (!cancelled) setError(membershipsError.message);
        if (!cancelled) setLoading(false);
        return;
      }

      const membershipRows = (memberships ?? []) as Array<{ role: string }>;
      const isSuperAdmin = membershipRows.some(
        (m) => (m.role ?? "").toLowerCase() === "super_admin"
      );

      if (!isSuperAdmin) {
        if (!cancelled)
          setError(
            "Not authorized to view the super admin dashboard."
          );
        if (!cancelled) setLoading(false);
        return;
      }

      const { data: tenantsData, error: tenantsError } = await supabase
        .from("tenants")
        .select("id,name,contact_email,contact_phone")
        .order("name", { ascending: true });

      if (tenantsError) {
        if (!cancelled) setError(tenantsError.message);
        if (!cancelled) setLoading(false);
        return;
      }

      const { data: propertiesData, error: propertiesError } = await supabase
        .from("properties")
        .select(
          "id,tenant_id,name,address,postal_code,city,total_units,occupied_units,status"
        )
        .order("name", { ascending: true });

      if (propertiesError) {
        if (!cancelled) setError(propertiesError.message);
        if (!cancelled) setLoading(false);
        return;
      }

      let usersCount = 0;
      try {
        const { count, error: usersCountError } = await supabase
          .from("users")
          .select("id", { count: "exact", head: true });

        if (!usersCountError && typeof count === "number") usersCount = count;
      } catch {
        // ignore; fallback below
      }

      if (!usersCount) {
        usersCount =
          (await supabase.from("users").select("id")).data?.length ?? 0;
      }

      if (!cancelled) {
        setTenants((tenantsData as TenantRow[]) ?? []);
        setProperties((propertiesData as PropertyRow[]) ?? []);
        setInviteTenantId((tenantsData as TenantRow[])?.[0]?.id ?? "");
        setCounts({
          users: usersCount,
          properties: (propertiesData ?? []).length,
          tenants: (tenantsData ?? []).length,
        });
        setLoading(false);
      }
    }

    fetchAll();
    return () => {
      cancelled = true;
    };
  }, [router]);

  const totalUnits = useMemo(
    () => properties.reduce((sum, p) => sum + (p.total_units ?? 0), 0),
    [properties]
  );
  const occupiedUnits = useMemo(
    () => properties.reduce((sum, p) => sum + (p.occupied_units ?? 0), 0),
    [properties]
  );
  const occupancyPct = useMemo(() => {
    return totalUnits > 0 ? Math.round((occupiedUnits / totalUnits) * 100) : 0;
  }, [totalUnits, occupiedUnits]);

  const tenantNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of tenants) map.set(t.id, t.name);
    return map;
  }, [tenants]);

  async function onAddTenant(e: FormEvent) {
    e.preventDefault();
    setSubmitLoading(true);
    setError(null);

    try {
      const supabase = getSupabaseClient();

      const tenantInsert = await supabase
        .from("tenants")
        .insert({ name: tenantName })
        .select("id,name")
        .single();

      if (tenantInsert.error) {
        setError(tenantInsert.error.message);
        setSubmitLoading(false);
        return;
      }

      const newTenant = tenantInsert.data as { id: string; name: string };

      const membershipInsert = await supabase.from("memberships").insert({
        tenant_id: newTenant.id,
        user_id: ownerUserId,
        role: "owner",
      });

      if (membershipInsert.error) {
        setError(membershipInsert.error.message);
        setSubmitLoading(false);
        return;
      }

      // Refresh (simple approach).
      window.location.reload();
    } finally {
      setSubmitLoading(false);
    }
  }

  async function onInviteUser(e: FormEvent) {
    e.preventDefault();
    setInviteLoading(true);
    setError(null);
    setInviteMessage(null);
    try {
      const res = await fetch("/api/invitations/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: inviteEmail.trim(),
          role: inviteRole,
          tenantId: inviteTenantId,
        }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string; invited?: boolean };
      if (!res.ok || !json.ok) {
        setError(json.error ?? "Invite failed");
        return;
      }
      setInviteMessage(
        json.invited
          ? "Invite sent. User will receive an email to set password."
          : "User already existed. Membership updated successfully."
      );
      setInviteEmail("");
      setInviteRole("manager");
      setInviteTenantId((prev) => prev || tenants[0]?.id || "");
    } finally {
      setInviteLoading(false);
    }
  }

  const linkStyle = { color: "var(--teal, #3aafa9)", fontWeight: 600 as const, textDecoration: "none" as const };

  return (
    <DashboardLayout>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div>
          <h1 style={{ margin: "0 0 8px", fontSize: "1.65rem", fontWeight: 700, color: "var(--petrol, #1a4a4a)" }}>All organizations</h1>
          <p style={{ margin: 0, color: "rgba(26, 74, 74, 0.72)", maxWidth: 560 }}>
            All organizations, all properties, system-wide occupancy.
          </p>
          <p style={{ margin: "10px 0 0", fontSize: 14, display: "flex", flexWrap: "wrap", gap: "6px 12px" }}>
            <Link href="/reports" style={linkStyle}>
              Financial reports (rent roll, net income)
            </Link>
            <span style={{ color: "rgba(26,74,74,0.35)" }}>·</span>
            <Link href="/super-admin/brands" style={linkStyle}>
              White-label brands
            </Link>
            <span style={{ color: "rgba(26,74,74,0.35)" }}>·</span>
            <Link href="/super-admin/billing" style={linkStyle}>
              Billing dashboard
            </Link>
          </p>
        </div>
        <LogoutButton />
      </div>

      {error ? (
        <p style={{ color: "#b00020", marginTop: 16 }}>{error}</p>
      ) : null}

      {loading ? (
        <p style={{ marginTop: 18, color: "rgba(26, 74, 74, 0.65)" }}>Loading...</p>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14, marginTop: 22 }}>
            <div className="vw-card" style={{ padding: 16 }}>
              <div style={{ color: "rgba(26, 74, 74, 0.6)", fontSize: 12, fontWeight: 600, letterSpacing: "0.04em" }}>Organizations</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: "var(--petrol, #1a4a4a)", marginTop: 4 }}>{counts.tenants}</div>
            </div>
            <div className="vw-card" style={{ padding: 16 }}>
              <div style={{ color: "rgba(26, 74, 74, 0.6)", fontSize: 12, fontWeight: 600, letterSpacing: "0.04em" }}>Properties</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: "var(--petrol, #1a4a4a)", marginTop: 4 }}>{counts.properties}</div>
            </div>
            <div className="vw-card" style={{ padding: 16 }}>
              <div style={{ color: "rgba(26, 74, 74, 0.6)", fontSize: 12, fontWeight: 600, letterSpacing: "0.04em" }}>Users</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: "var(--petrol, #1a4a4a)", marginTop: 4 }}>{counts.users}</div>
            </div>
            <div className="vw-card" style={{ padding: 16 }}>
              <div style={{ color: "rgba(26, 74, 74, 0.6)", fontSize: 12, fontWeight: 600, letterSpacing: "0.04em" }}>Occupancy</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: "var(--petrol, #1a4a4a)", marginTop: 4 }}>{occupancyPct}%</div>
            </div>
          </div>

          <div style={{ marginTop: 26 }}>
            <h2 style={{ margin: "0 0 12px", fontSize: 17, fontWeight: 700, color: "var(--petrol, #1a4a4a)" }}>Organizations</h2>
            {tenants.length === 0 ? (
              <p style={{ color: "rgba(26, 74, 74, 0.7)" }}>No organizations found.</p>
            ) : (
              <div className="vw-card" style={{ overflow: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ background: "var(--cream, #f4f1ec)" }}>
                      <th style={{ textAlign: "left", padding: "12px 14px", borderBottom: "1px solid rgba(26,74,74,0.1)", fontSize: 12, fontWeight: 700, color: "rgba(26,74,74,0.75)" }}>Name</th>
                      <th style={{ textAlign: "left", padding: "12px 14px", borderBottom: "1px solid rgba(26,74,74,0.1)", fontSize: 12, fontWeight: 700, color: "rgba(26,74,74,0.75)" }}>Contact email</th>
                      <th style={{ textAlign: "left", padding: "12px 14px", borderBottom: "1px solid rgba(26,74,74,0.1)", fontSize: 12, fontWeight: 700, color: "rgba(26,74,74,0.75)" }}>Contact phone</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tenants.map((t) => (
                      <tr key={t.id}>
                        <td style={{ padding: "12px 14px", borderBottom: "1px solid rgba(26,74,74,0.06)" }}>{t.name}</td>
                        <td style={{ padding: "12px 14px", borderBottom: "1px solid rgba(26,74,74,0.06)" }}>{t.contact_email ?? "-"}</td>
                        <td style={{ padding: "12px 14px", borderBottom: "1px solid rgba(26,74,74,0.06)" }}>{t.contact_phone ?? "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div style={{ marginTop: 26 }}>
            <h2 style={{ margin: "0 0 12px", fontSize: 17, fontWeight: 700, color: "var(--petrol, #1a4a4a)" }}>Properties</h2>
            {properties.length === 0 ? (
              <p style={{ color: "rgba(26, 74, 74, 0.7)" }}>No properties found.</p>
            ) : (
              <div className="vw-card" style={{ overflow: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "var(--cream, #f4f1ec)" }}>
                    <th style={{ textAlign: "left", padding: "12px 14px", borderBottom: "1px solid rgba(26,74,74,0.1)", fontSize: 12, fontWeight: 700, color: "rgba(26,74,74,0.75)" }}>Owner organization</th>
                    <th style={{ textAlign: "left", padding: "12px 14px", borderBottom: "1px solid rgba(26,74,74,0.1)", fontSize: 12, fontWeight: 700, color: "rgba(26,74,74,0.75)" }}>Property</th>
                    <th style={{ textAlign: "left", padding: "12px 14px", borderBottom: "1px solid rgba(26,74,74,0.1)", fontSize: 12, fontWeight: 700, color: "rgba(26,74,74,0.75)" }}>Address</th>
                    <th style={{ textAlign: "left", padding: "12px 14px", borderBottom: "1px solid rgba(26,74,74,0.1)", fontSize: 12, fontWeight: 700, color: "rgba(26,74,74,0.75)" }}>Occupancy</th>
                    <th style={{ textAlign: "left", padding: "12px 14px", borderBottom: "1px solid rgba(26,74,74,0.1)", fontSize: 12, fontWeight: 700, color: "rgba(26,74,74,0.75)" }}>Status</th>
                    <th style={{ textAlign: "left", padding: "12px 14px", borderBottom: "1px solid rgba(26,74,74,0.1)", fontSize: 12, fontWeight: 700, color: "rgba(26,74,74,0.75)" }}>Reports</th>
                  </tr>
                </thead>
                <tbody>
                  {properties.map((p, idx) => {
                    const total = p.total_units ?? 0;
                    const occupied = p.occupied_units ?? 0;
                    const status = (p.status ?? "").toLowerCase();
                    const statusPill =
                      status === "active"
                        ? { bg: "#e6f6ea", fg: "#1b5e20", bd: "#b7e1bf" }
                        : status === "under_renovation"
                          ? { bg: "#fff3cd", fg: "#7a5a00", bd: "#ffe69c" }
                          : { bg: "#fbe8ea", fg: "#b00020", bd: "#f3b7be" };

                    return (
                      <tr key={p.id ?? `${p.tenant_id ?? "t"}-${idx}`}>
                        <td style={{ padding: "10px", borderBottom: "1px solid #f0f0f0" }}>
                          {p.tenant_id ? tenantNameById.get(p.tenant_id) ?? "-" : "-"}
                        </td>
                        <td style={{ padding: "10px", borderBottom: "1px solid #f0f0f0" }}>
                          {p.name ?? "(no name)"}
                        </td>
                        <td style={{ padding: "10px", borderBottom: "1px solid #f0f0f0" }}>
                          <div>{p.address ?? "(no address)"}</div>
                          <div style={{ color: "#666", fontSize: 12 }}>
                            {p.postal_code ? `Postal code: ${p.postal_code}` : ""}
                          </div>
                          <div style={{ color: "#666", fontSize: 12 }}>
                            {p.city ?? ""}
                          </div>
                        </td>
                        <td style={{ padding: "10px", borderBottom: "1px solid #f0f0f0" }}>
                          {occupied}/{total}{" "}
                          <span style={{ color: "#666" }}>
                            {total > 0 ? `(${Math.round((occupied / total) * 100)}%)` : "(0%)"}
                          </span>
                        </td>
                        <td style={{ padding: "10px", borderBottom: "1px solid #f0f0f0" }}>
                          <span
                            style={{
                              display: "inline-block",
                              padding: "2px 8px",
                              borderRadius: 999,
                              background: statusPill.bg,
                              color: statusPill.fg,
                              border: `1px solid ${statusPill.bd}`,
                              fontSize: 12,
                            }}
                          >
                            {p.status ?? "inactive"}
                          </span>
                        </td>
                        <td style={{ padding: "12px 14px", borderBottom: "1px solid rgba(26,74,74,0.06)", fontSize: 13 }}>
                          {p.id ? (
                            <span style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                              <Link href={`/reports/rent-roll?propertyId=${encodeURIComponent(p.id)}`} style={linkStyle}>
                                Rent roll
                              </Link>
                              <Link href={`/reports/net-income?propertyId=${encodeURIComponent(p.id)}`} style={linkStyle}>
                                Net income
                              </Link>
                            </span>
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
            )}
          </div>

          <div className="vw-card" style={{ marginTop: 26, padding: 22, maxWidth: 600 }}>
            <h2 style={{ margin: "0 0 14px", fontSize: 17, fontWeight: 700, color: "var(--petrol, #1a4a4a)" }}>Invite user</h2>
            <form onSubmit={onInviteUser} style={{ display: "grid", gap: 14 }}>
              <label style={{ display: "grid", gap: 6, fontSize: 14, fontWeight: 600, color: "var(--petrol, #1a4a4a)" }}>
                <span>Email address</span>
                <input
                  type="email"
                  className="vw-input"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  required
                />
              </label>
              <label style={{ display: "grid", gap: 6, fontSize: 14, fontWeight: 600, color: "var(--petrol, #1a4a4a)" }}>
                <span>Role</span>
                <select
                  className="vw-input"
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value)}
                >
                  <option value="owner">Owner</option>
                  <option value="manager">Manager</option>
                  <option value="accounting">Accounting</option>
                  <option value="customer_service">Customer service</option>
                  <option value="maintenance">Maintenance</option>
                </select>
              </label>
              <label style={{ display: "grid", gap: 6, fontSize: 14, fontWeight: 600, color: "var(--petrol, #1a4a4a)" }}>
                <span>Organization</span>
                <select
                  className="vw-input"
                  value={inviteTenantId}
                  onChange={(e) => setInviteTenantId(e.target.value)}
                  required
                >
                  <option value="">Select organization…</option>
                  {tenants.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
              <button disabled={inviteLoading} type="submit" className="vw-btn-primary">
                {inviteLoading ? "Sending..." : "Send invite"}
              </button>
              {inviteMessage ? <p style={{ margin: 0, color: "#15803d", fontSize: 13 }}>{inviteMessage}</p> : null}
            </form>
          </div>

          <div className="vw-card" style={{ marginTop: 22, padding: 22, maxWidth: 560 }}>
            <h2 style={{ margin: "0 0 14px", fontSize: 17, fontWeight: 700, color: "var(--petrol, #1a4a4a)" }}>Add organization / owner</h2>
            <form onSubmit={onAddTenant} style={{ display: "grid", gap: 14 }}>
              <label style={{ display: "grid", gap: 6, fontSize: 14, fontWeight: 600, color: "var(--petrol, #1a4a4a)" }}>
                <span>Organization name (owner company)</span>
                <input
                  className="vw-input"
                  value={tenantName}
                  onChange={(e) => setTenantName(e.target.value)}
                  required
                />
              </label>
              <label style={{ display: "grid", gap: 6, fontSize: 14, fontWeight: 600, color: "var(--petrol, #1a4a4a)" }}>
                <span>Owner user id (UUID from Supabase Auth)</span>
                <input
                  className="vw-input"
                  value={ownerUserId}
                  onChange={(e) => setOwnerUserId(e.target.value)}
                  required
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                />
              </label>
              <button disabled={submitLoading} type="submit" className="vw-btn-primary">
                {submitLoading ? "Adding..." : "Add organization/owner"}
              </button>
              <p style={{ margin: 0, color: "rgba(26, 74, 74, 0.65)", fontSize: 12, lineHeight: 1.45 }}>
                You’ll need the owner’s user UUID from Supabase Auth (since the browser cannot look up auth user ids).
              </p>
            </form>
          </div>
        </>
      )}
    </DashboardLayout>
  );
}

