"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";
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

  return (
    <main>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: "0 0 8px" }}>All organizations</h1>
          <p style={{ margin: 0, color: "#555" }}>All organizations, all properties, system-wide occupancy.</p>
          <p style={{ margin: "10px 0 0", fontSize: 14 }}>
            <Link href="/reports">Financial reports (rent roll, net income)</Link>
            {" · "}
            <Link href="/super-admin/brands">White-label brands</Link>
            {" · "}
            <Link href="/super-admin/billing">Billing dashboard</Link>
          </p>
        </div>
        <LogoutButton />
      </div>

      {error ? (
        <p style={{ color: "#b00020" }}>{error}</p>
      ) : null}

      {loading ? (
        <p>Loading...</p>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginTop: 18 }}>
            <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 14 }}>
              <div style={{ color: "#666", fontSize: 12 }}>Organizations</div>
              <div style={{ fontSize: 26, fontWeight: 700 }}>{counts.tenants}</div>
            </div>
            <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 14 }}>
              <div style={{ color: "#666", fontSize: 12 }}>Properties</div>
              <div style={{ fontSize: 26, fontWeight: 700 }}>{counts.properties}</div>
            </div>
            <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 14 }}>
              <div style={{ color: "#666", fontSize: 12 }}>Users</div>
              <div style={{ fontSize: 26, fontWeight: 700 }}>{counts.users}</div>
            </div>
            <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 14 }}>
              <div style={{ color: "#666", fontSize: 12 }}>Occupancy</div>
              <div style={{ fontSize: 26, fontWeight: 700 }}>{occupancyPct}%</div>
            </div>
          </div>

          <div style={{ marginTop: 22 }}>
            <h2 style={{ margin: "0 0 10px", fontSize: 16 }}>Organizations</h2>
            {tenants.length === 0 ? (
              <p>No organizations found.</p>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", border: "1px solid #ddd" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", padding: "10px", borderBottom: "1px solid #ddd" }}>Name</th>
                    <th style={{ textAlign: "left", padding: "10px", borderBottom: "1px solid #ddd" }}>Contact email</th>
                    <th style={{ textAlign: "left", padding: "10px", borderBottom: "1px solid #ddd" }}>Contact phone</th>
                  </tr>
                </thead>
                <tbody>
                  {tenants.map((t) => (
                    <tr key={t.id}>
                      <td style={{ padding: "10px", borderBottom: "1px solid #f0f0f0" }}>{t.name}</td>
                      <td style={{ padding: "10px", borderBottom: "1px solid #f0f0f0" }}>{t.contact_email ?? "-"}</td>
                      <td style={{ padding: "10px", borderBottom: "1px solid #f0f0f0" }}>{t.contact_phone ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div style={{ marginTop: 22 }}>
            <h2 style={{ margin: "0 0 10px", fontSize: 16 }}>Properties</h2>
            {properties.length === 0 ? (
              <p>No properties found.</p>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", border: "1px solid #ddd" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", padding: "10px", borderBottom: "1px solid #ddd" }}>Owner organization</th>
                    <th style={{ textAlign: "left", padding: "10px", borderBottom: "1px solid #ddd" }}>Property</th>
                    <th style={{ textAlign: "left", padding: "10px", borderBottom: "1px solid #ddd" }}>Address</th>
                    <th style={{ textAlign: "left", padding: "10px", borderBottom: "1px solid #ddd" }}>Occupancy</th>
                    <th style={{ textAlign: "left", padding: "10px", borderBottom: "1px solid #ddd" }}>Status</th>
                    <th style={{ textAlign: "left", padding: "10px", borderBottom: "1px solid #ddd" }}>Reports</th>
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
                        <td style={{ padding: "10px", borderBottom: "1px solid #f0f0f0", fontSize: 13 }}>
                          {p.id ? (
                            <span style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                              <Link href={`/reports/rent-roll?propertyId=${encodeURIComponent(p.id)}`}>Rent roll</Link>
                              <Link href={`/reports/net-income?propertyId=${encodeURIComponent(p.id)}`}>Net income</Link>
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
            )}
          </div>

          <div style={{ marginTop: 22, borderTop: "1px solid #eee", paddingTop: 18 }}>
            <h2 style={{ margin: "0 0 10px", fontSize: 16 }}>Invite user</h2>
            <form onSubmit={onInviteUser} style={{ display: "grid", gap: 12, maxWidth: 560 }}>
              <label style={{ display: "grid", gap: 6 }}>
                <span>Email address</span>
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  required
                  style={{ padding: 10, borderRadius: 8, border: "1px solid #ddd" }}
                />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span>Role</span>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value)}
                  style={{ padding: 10, borderRadius: 8, border: "1px solid #ddd" }}
                >
                  <option value="owner">Owner</option>
                  <option value="manager">Manager</option>
                  <option value="accounting">Accounting</option>
                  <option value="customer_service">Customer service</option>
                  <option value="maintenance">Maintenance</option>
                </select>
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span>Organization</span>
                <select
                  value={inviteTenantId}
                  onChange={(e) => setInviteTenantId(e.target.value)}
                  required
                  style={{ padding: 10, borderRadius: 8, border: "1px solid #ddd" }}
                >
                  <option value="">Select organization…</option>
                  {tenants.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                disabled={inviteLoading}
                type="submit"
                style={{
                  padding: "10px 14px",
                  borderRadius: 10,
                  border: "1px solid #ddd",
                  background: "#111",
                  color: "#fff",
                  cursor: inviteLoading ? "not-allowed" : "pointer",
                }}
              >
                {inviteLoading ? "Sending..." : "Send invite"}
              </button>
              {inviteMessage ? <p style={{ margin: 0, color: "#1b5e20", fontSize: 13 }}>{inviteMessage}</p> : null}
            </form>
          </div>

          <div style={{ marginTop: 22, borderTop: "1px solid #eee", paddingTop: 18 }}>
            <h2 style={{ margin: "0 0 10px", fontSize: 16 }}>Add organization / owner</h2>
            <form onSubmit={onAddTenant} style={{ display: "grid", gap: 12, maxWidth: 520 }}>
              <label style={{ display: "grid", gap: 6 }}>
                <span>Organization name (owner company)</span>
                <input
                  value={tenantName}
                  onChange={(e) => setTenantName(e.target.value)}
                  required
                  style={{ padding: 10, borderRadius: 8, border: "1px solid #ddd" }}
                />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span>Owner user id (UUID from Supabase Auth)</span>
                <input
                  value={ownerUserId}
                  onChange={(e) => setOwnerUserId(e.target.value)}
                  required
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  style={{ padding: 10, borderRadius: 8, border: "1px solid #ddd" }}
                />
              </label>
              <button
                disabled={submitLoading}
                type="submit"
                style={{
                  padding: "10px 14px",
                  borderRadius: 10,
                  border: "1px solid #ddd",
                  background: "#111",
                  color: "#fff",
                  cursor: submitLoading ? "not-allowed" : "pointer",
                }}
              >
                {submitLoading ? "Adding..." : "Add organization/owner"}
              </button>
              <p style={{ margin: 0, color: "#666", fontSize: 12 }}>
                You’ll need the owner’s user UUID from Supabase Auth (since the browser cannot look up auth user ids).
              </p>
            </form>
          </div>
        </>
      )}
    </main>
  );
}

