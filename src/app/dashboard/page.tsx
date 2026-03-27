"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { getSupabaseClient } from "@/lib/supabase/browser";
import { VILLAGEWORKS_BRAND } from "@/lib/brand/villageworks";

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
  const c = VILLAGEWORKS_BRAND.colors;
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
          "id,tenant_id,name,address,postal_code,city,total_units,occupied_units,status"
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
  const kpiCards = useMemo(
    () => [
      { title: "Overall occupancy", value: `${summary.occupancyPct}%`, sub: `${summary.occupiedUnits}/${summary.totalUnits} units`, tone: c.primary },
      { title: "Monthly revenue", value: "€ --", sub: "Connect accounting feed for totals", tone: c.secondary },
      { title: "Active contracts", value: "--", sub: "Expiring soon: --", tone: c.info },
      { title: "Open invoices", value: "--", sub: "Outstanding: € --", tone: c.danger },
    ],
    [c.danger, c.info, c.primary, c.secondary, summary.occupancyPct, summary.occupiedUnits, summary.totalUnits],
  );
  const revenueTrendData = useMemo(() => {
    const labels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return labels.map((m) => ({ month: m, actual: null, target: null }));
  }, []);
  const occupancyByProperty = useMemo(
    () =>
      rows.slice(0, 8).map((r) => {
        const total = Number(r.total_units ?? 0);
        const occupied = Number(r.occupied_units ?? 0);
        const pct = total > 0 ? Math.round((occupied / total) * 100) : 0;
        return { name: r.name ?? "Property", occupancy: pct };
      }),
    [rows],
  );

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
    <main style={{ display: "grid", gap: 14 }}>
      <section style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <div>
          <h1 style={{ margin: 0, fontWeight: 600, letterSpacing: "-0.02em" }}>Dashboard</h1>
          <p style={{ margin: "6px 0 0", color: "#4b6b6a", lineHeight: 1.45 }}>
            Overview of occupancy, revenue and property operations.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link href="/bookings" style={{ textDecoration: "none", color: c.white, background: c.primary, borderRadius: 8, padding: "9px 12px", fontWeight: 600 }}>
            Calendar
          </Link>
          <Link href="/reports" style={{ textDecoration: "none", color: c.primary, background: c.white, border: `1px solid ${c.primary}`, borderRadius: 8, padding: "9px 12px", fontWeight: 600 }}>
            Reports
          </Link>
        </div>
      </section>

      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 12 }}>
        {kpiCards.map((card) => (
          <article key={card.title} style={{ background: c.white, border: `1px solid ${c.border}`, borderRadius: 12, boxShadow: "0 8px 24px rgba(13,61,59,0.06)", padding: 14 }}>
            <div style={{ borderLeft: `4px solid ${card.tone}`, paddingLeft: 10 }}>
              <div style={{ color: "#4f6767", fontSize: 12 }}>{card.title}</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: c.text, marginTop: 4 }}>{loading ? "..." : card.value}</div>
              <div style={{ color: "#6a8080", fontSize: 12 }}>{card.sub}</div>
            </div>
          </article>
        ))}
      </section>

      <section className="vw-dash-grid-two" style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12 }}>
        <article style={{ background: c.white, border: `1px solid ${c.border}`, borderRadius: 12, boxShadow: "0 8px 24px rgba(13,61,59,0.06)", padding: 14, minWidth: 0 }}>
          <h2 style={{ margin: "0 0 8px", fontSize: 16 }}>Revenue last 12 months</h2>
          <div style={{ width: "100%", height: 280, minWidth: 0 }}>
            <ResponsiveContainer>
              <BarChart data={revenueTrendData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e8f0f0" />
                <XAxis dataKey="month" stroke="#557272" />
                <YAxis stroke="#557272" />
                <Tooltip contentStyle={{ borderRadius: 10, border: `1px solid ${c.border}` }} />
                <Bar dataKey="actual" fill={c.primary} radius={[6, 6, 0, 0]} />
                <Line type="monotone" dataKey="target" stroke={c.secondary} strokeWidth={2} dot={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p style={{ margin: 0, fontSize: 12, color: "#6a8080" }}>Financial series appears after importing revenue history.</p>
        </article>
        <article style={{ background: c.white, border: `1px solid ${c.border}`, borderRadius: 12, boxShadow: "0 8px 24px rgba(13,61,59,0.06)", padding: 14, minWidth: 0 }}>
          <h2 style={{ margin: "0 0 8px", fontSize: 16 }}>Occupancy by property</h2>
          <div style={{ width: "100%", height: 280, minWidth: 0 }}>
            <ResponsiveContainer>
              <BarChart data={occupancyByProperty} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#e8f0f0" />
                <XAxis type="number" domain={[0, 100]} stroke="#557272" />
                <YAxis type="category" dataKey="name" stroke="#557272" width={100} />
                <Tooltip contentStyle={{ borderRadius: 10, border: `1px solid ${c.border}` }} />
                <Bar dataKey="occupancy" fill={c.secondary} radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </article>
      </section>

      <section className="vw-dash-grid-two" style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 12 }}>
        <article style={{ background: c.white, border: `1px solid ${c.border}`, borderRadius: 12, boxShadow: "0 8px 24px rgba(13,61,59,0.06)", padding: 14 }}>
          <h2 style={{ margin: "0 0 8px", fontSize: 16 }}>Recent activity</h2>
          <ul style={{ margin: 0, paddingLeft: 18, color: "#3f5757", lineHeight: 1.6 }}>
            <li>Property data loaded and synchronized.</li>
            <li>Owner dashboard viewed.</li>
            <li>Latest occupancy snapshot updated.</li>
            <li>Reports module available.</li>
          </ul>
        </article>
        <article style={{ background: c.white, border: `1px solid ${c.border}`, borderRadius: 12, boxShadow: "0 8px 24px rgba(13,61,59,0.06)", padding: 14 }}>
          <h2 style={{ margin: "0 0 8px", fontSize: 16 }}>Upcoming tasks</h2>
          <ul style={{ margin: 0, paddingLeft: 18, color: "#3f5757", lineHeight: 1.6 }}>
            <li>Review contracts expiring soon.</li>
            <li>Follow up overdue invoices.</li>
            <li>Check leads needing response.</li>
            <li>Confirm scheduled viewings.</li>
          </ul>
        </article>
      </section>

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
                <span>Organization</span>
                <select
                  value={inviteTenantId}
                  onChange={(e) => setInviteTenantId(e.target.value)}
                  required
                  style={{ padding: 10, borderRadius: 8, border: "1px solid #ddd" }}
                >
                  <option value="">Select organization…</option>
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
                <span>Organization</span>
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
            This account isn&apos;t connected to any owner organization (or they have
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
                <th style={{ textAlign: "left", padding: "10px", borderBottom: "1px solid #ddd" }}>
                  Reports
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
                  <tr key={p.id ?? `${p.tenant_id ?? "t"}-${idx}`}>
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
      <style>{`
        @media (max-width: 960px) {
          .vw-dash-grid-two {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </main>
  );
}

