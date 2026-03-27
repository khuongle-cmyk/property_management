"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { getSupabaseClient } from "@/lib/supabase/browser";
import LogoutButton from "./LogoutButton";

type PropertyRow = {
  tenant_id: string | null;
  name: string | null;
  address: string | null;
  postal_code: string | null;
  city: string | null;
  total_units: number | null;
  occupied_units: number | null;
  status: string | null;
};

type MembershipRow = {
  tenant_id: string | null;
  role: string;
};

type TenantRow = { id: string; name: string };
type PipelineSettingsRow = {
  tenant_id: string;
  enabled: boolean;
  contact_slug: string | null;
  inbound_email: string | null;
  custom_stages: string[] | null;
  auto_assign_rules: Record<string, unknown> | null;
};

export default function DashboardPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<PropertyRow[]>([]);
  const [ownerTenantIds, setOwnerTenantIds] = useState<string[]>([]);
  const [ownerTenants, setOwnerTenants] = useState<TenantRow[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("manager");
  const [inviteTenantId, setInviteTenantId] = useState("");
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteMessage, setInviteMessage] = useState<string | null>(null);
  const [pipelineTenantId, setPipelineTenantId] = useState("");
  const [pipelineEnabled, setPipelineEnabled] = useState(false);
  const [pipelineSlug, setPipelineSlug] = useState("");
  const [pipelineInboundEmail, setPipelineInboundEmail] = useState("");
  const [pipelineStagesText, setPipelineStagesText] = useState("");
  const [pipelineAutoAssignText, setPipelineAutoAssignText] = useState("{}");
  const [pipelineSaving, setPipelineSaving] = useState(false);
  const [pipelineMessage, setPipelineMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const supabase = getSupabaseClient();
      setLoading(true);
      setError(null);

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError) {
        if (!cancelled) setError(userError.message);
        if (!cancelled) setLoading(false);
        return;
      }

      if (!user) {
        router.push("/login");
        return;
      }

      const { data: memberships, error: membershipsError } = await supabase
        .from("memberships")
        .select("tenant_id,role");

      if (membershipsError) {
        if (!cancelled) setError(membershipsError.message);
        if (!cancelled) setLoading(false);
        return;
      }

      const membershipRows = (memberships ?? []) as MembershipRow[];
      const isSuperAdmin = membershipRows.some((m) => (m.role ?? "").toLowerCase() === "super_admin");
      const ownerTenantIds = membershipRows
        .filter((m) => (m.role ?? "").toLowerCase() === "owner")
        .map((m) => m.tenant_id)
        .filter(Boolean) as string[];
      if (!cancelled) setOwnerTenantIds(ownerTenantIds);

      if (isSuperAdmin) {
        router.replace("/super-admin");
        return;
      }

      if (!isSuperAdmin && ownerTenantIds.length === 0) {
        if (!cancelled) {
          setError("Not authorized to view the owner dashboard.");
          setRows([]);
          setLoading(false);
        }
        return;
      }

      let propertiesQuery = supabase
        .from("properties")
        .select(
          "tenant_id,name,address,postal_code,city,total_units,occupied_units,status"
        );

      if (!isSuperAdmin) {
        propertiesQuery = propertiesQuery.in("tenant_id", ownerTenantIds);
      }

      const { data: properties, error: propertiesError } = await propertiesQuery.order("name", {
        ascending: true,
      });

      if (propertiesError) {
        if (!cancelled) setError(propertiesError.message);
        if (!cancelled) setLoading(false);
        return;
      }

      if (!cancelled) setRows((properties as PropertyRow[]) ?? []);
      if (!cancelled && ownerTenantIds.length > 0) {
        const { data: tRows } = await supabase
          .from("tenants")
          .select("id,name")
          .in("id", ownerTenantIds)
          .order("name", { ascending: true });
        setOwnerTenants((tRows as TenantRow[]) ?? []);
        setInviteTenantId((prev) => prev || (tRows as TenantRow[])?.[0]?.id || "");
        const initialTenant = (tRows as TenantRow[])?.[0]?.id || "";
        setPipelineTenantId((prev) => prev || initialTenant);
      }
      if (!cancelled) setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [router]);

  const summary = useMemo(() => {
    const totalUnits = rows.reduce((sum, p) => sum + (p.total_units ?? 0), 0);
    const occupiedUnits = rows.reduce((sum, p) => sum + (p.occupied_units ?? 0), 0);
    const occupancyPct =
      totalUnits > 0 ? Math.round((occupiedUnits / totalUnits) * 100) : 0;

    return { totalUnits, occupiedUnits, occupancyPct };
  }, [rows]);

  async function onInviteTeamMember(e: FormEvent) {
    e.preventDefault();
    setInviteLoading(true);
    setInviteMessage(null);
    setError(null);
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
          ? "Invite sent. Team member will receive an email to set password."
          : "User already existed. Membership updated."
      );
      setInviteEmail("");
      setInviteRole("manager");
    } finally {
      setInviteLoading(false);
    }
  }

  async function loadPipelineSettings(tenantId: string) {
    if (!tenantId) return;
    const res = await fetch(`/api/leads/pipeline-settings?tenantId=${encodeURIComponent(tenantId)}`);
    const json = (await res.json()) as { settings?: PipelineSettingsRow | null; error?: string };
    if (!res.ok) {
      setError(json.error ?? "Failed to load pipeline settings");
      return;
    }
    const s = json.settings;
    setPipelineEnabled(!!s?.enabled);
    setPipelineSlug(s?.contact_slug ?? "");
    setPipelineInboundEmail(s?.inbound_email ?? "");
    setPipelineStagesText((s?.custom_stages ?? []).join(", "));
    setPipelineAutoAssignText(JSON.stringify(s?.auto_assign_rules ?? {}, null, 2));
  }

  async function onSavePipelineSettings(e: FormEvent) {
    e.preventDefault();
    if (!pipelineTenantId) return;
    setPipelineSaving(true);
    setPipelineMessage(null);
    setError(null);
    try {
      let parsedRules: Record<string, unknown> = {};
      try {
        parsedRules = JSON.parse(pipelineAutoAssignText || "{}") as Record<string, unknown>;
      } catch {
        setError("Auto-assign rules must be valid JSON.");
        return;
      }
      const customStages = pipelineStagesText
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const res = await fetch("/api/leads/pipeline-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId: pipelineTenantId,
          enabled: pipelineEnabled,
          contactSlug: pipelineSlug || null,
          inboundEmail: pipelineInboundEmail || null,
          customStages: customStages.length ? customStages : null,
          autoAssignRules: parsedRules,
        }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        setError(json.error ?? "Failed to save pipeline settings");
        return;
      }
      setPipelineMessage("Pipeline settings saved.");
    } finally {
      setPipelineSaving(false);
    }
  }

  useEffect(() => {
    if (!pipelineTenantId) return;
    void loadPipelineSettings(pipelineTenantId);
  }, [pipelineTenantId]);

  return (
    <main>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: "0 0 8px" }}>Dashboard</h1>
          <p style={{ margin: 0, color: "#555" }}>
            Occupancy across your subscribed properties.
          </p>
          <p style={{ margin: "10px 0 0", fontSize: 14 }}>
            <Link href="/bookings">Meeting rooms, offices &amp; desks</Link>
          </p>
        </div>
        <LogoutButton />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginTop: 18 }}>
        <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 14 }}>
          <div style={{ color: "#666", fontSize: 12 }}>Properties</div>
          <div style={{ fontSize: 26, fontWeight: 700 }}>
            {loading ? "..." : rows.length}
          </div>
        </div>
        <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 14 }}>
          <div style={{ color: "#666", fontSize: 12 }}>Units (total)</div>
          <div style={{ fontSize: 26, fontWeight: 700 }}>
            {loading ? "..." : summary.totalUnits}
          </div>
        </div>
        <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 14 }}>
          <div style={{ color: "#666", fontSize: 12 }}>Occupied</div>
          <div style={{ fontSize: 26, fontWeight: 700 }}>
            {loading ? "..." : summary.occupiedUnits}
          </div>
        </div>
        <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 14 }}>
          <div style={{ color: "#666", fontSize: 12 }}>Occupancy</div>
          <div style={{ fontSize: 26, fontWeight: 700 }}>
            {loading ? "..." : summary.occupancyPct}%
          </div>
        </div>
      </div>

      <div style={{ marginTop: 22 }}>
        {ownerTenantIds.length > 0 ? (
          <div style={{ marginBottom: 18, border: "1px solid #eee", borderRadius: 12, padding: 14 }}>
            <h2 style={{ margin: "0 0 10px", fontSize: 16 }}>Invite team member</h2>
            <form onSubmit={onInviteTeamMember} style={{ display: "grid", gap: 10, maxWidth: 520 }}>
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
                  <option value="manager">Manager</option>
                  <option value="accounting">Accounting</option>
                  <option value="customer_service">Customer service</option>
                  <option value="maintenance">Maintenance</option>
                </select>
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span>Tenant</span>
                <select
                  value={inviteTenantId}
                  onChange={(e) => setInviteTenantId(e.target.value)}
                  required
                  style={{ padding: 10, borderRadius: 8, border: "1px solid #ddd" }}
                >
                  <option value="">Select tenant…</option>
                  {ownerTenants.map((t) => (
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
        ) : null}

        {ownerTenantIds.length > 0 ? (
          <div style={{ marginBottom: 18, border: "1px solid #eee", borderRadius: 12, padding: 14 }}>
            <h2 style={{ margin: "0 0 10px", fontSize: 16 }}>Owner pipeline settings</h2>
            <form onSubmit={onSavePipelineSettings} style={{ display: "grid", gap: 10, maxWidth: 640 }}>
              <label style={{ display: "grid", gap: 6 }}>
                <span>Tenant</span>
                <select
                  value={pipelineTenantId}
                  onChange={(e) => setPipelineTenantId(e.target.value)}
                  style={{ padding: 10, borderRadius: 8, border: "1px solid #ddd" }}
                >
                  {ownerTenants.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="checkbox"
                  checked={pipelineEnabled}
                  onChange={(e) => setPipelineEnabled(e.target.checked)}
                />
                <span>Enable owner pipeline (off by default)</span>
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span>Contact form slug</span>
                <input
                  value={pipelineSlug}
                  onChange={(e) => setPipelineSlug(e.target.value)}
                  placeholder="their-property-slug"
                  style={{ padding: 10, borderRadius: 8, border: "1px solid #ddd" }}
                />
              </label>
              {pipelineSlug ? (
                <p style={{ margin: 0, fontSize: 13, color: "#555" }}>
                  Public URL: /contact/{pipelineSlug}
                </p>
              ) : null}
              <label style={{ display: "grid", gap: 6 }}>
                <span>Inbound lead email (optional)</span>
                <input
                  type="email"
                  value={pipelineInboundEmail}
                  onChange={(e) => setPipelineInboundEmail(e.target.value)}
                  placeholder="leads@their-domain.com"
                  style={{ padding: 10, borderRadius: 8, border: "1px solid #ddd" }}
                />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span>Custom pipeline stages (comma separated)</span>
                <input
                  value={pipelineStagesText}
                  onChange={(e) => setPipelineStagesText(e.target.value)}
                  placeholder="new, contacted, viewing, offer_sent, negotiation, won, lost"
                  style={{ padding: 10, borderRadius: 8, border: "1px solid #ddd" }}
                />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span>Auto-assign rules (JSON)</span>
                <textarea
                  rows={4}
                  value={pipelineAutoAssignText}
                  onChange={(e) => setPipelineAutoAssignText(e.target.value)}
                  style={{ padding: 10, borderRadius: 8, border: "1px solid #ddd", fontFamily: "monospace" }}
                />
              </label>
              <button
                disabled={pipelineSaving}
                type="submit"
                style={{
                  padding: "10px 14px",
                  borderRadius: 10,
                  border: "1px solid #ddd",
                  background: "#111",
                  color: "#fff",
                  cursor: pipelineSaving ? "not-allowed" : "pointer",
                  width: 180,
                }}
              >
                {pipelineSaving ? "Saving..." : "Save settings"}
              </button>
              {pipelineMessage ? <p style={{ margin: 0, color: "#1b5e20", fontSize: 13 }}>{pipelineMessage}</p> : null}
            </form>
          </div>
        ) : null}

        {error ? (
          <p style={{ color: "#b00020" }}>Failed to load: {error}</p>
        ) : loading ? (
          <p>Loading...</p>
        ) : rows.length === 0 ? (
          <p>
            This account isn&apos;t connected to any owner tenant (or they have
            no properties yet).
          </p>
        ) : (
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              border: "1px solid #ddd",
            }}
          >
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: "10px", borderBottom: "1px solid #ddd" }}>
                  Property
                </th>
                <th style={{ textAlign: "left", padding: "10px", borderBottom: "1px solid #ddd" }}>
                  Address
                </th>
                <th style={{ textAlign: "left", padding: "10px", borderBottom: "1px solid #ddd" }}>
                  City
                </th>
                <th style={{ textAlign: "left", padding: "10px", borderBottom: "1px solid #ddd" }}>
                  Occupancy
                </th>
                <th style={{ textAlign: "left", padding: "10px", borderBottom: "1px solid #ddd" }}>
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p, idx) => {
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
                  <tr key={`${p.tenant_id ?? "t"}-${idx}`}>
                    <td style={{ padding: "10px", borderBottom: "1px solid #f0f0f0" }}>
                      {p.name ?? "(no name)"}
                    </td>
                    <td style={{ padding: "10px", borderBottom: "1px solid #f0f0f0" }}>
                      <div>{p.address ?? "(no address)"}</div>
                      <div style={{ color: "#666", fontSize: 12 }}>
                        {p.postal_code ? `Postal code: ${p.postal_code}` : ""}
                      </div>
                    </td>
                    <td style={{ padding: "10px", borderBottom: "1px solid #f0f0f0" }}>
                      {p.city ?? "(no city)"}
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
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </main>
  );
}

