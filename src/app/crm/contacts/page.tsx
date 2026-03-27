"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { getSupabaseClient } from "@/lib/supabase/browser";
import { LEAD_STAGE_LABEL, LEAD_STAGES, type LeadStage } from "@/lib/crm";
import { formatPropertyLabel } from "@/lib/properties/label";
import { formatDate } from "@/lib/date/format";

type Role = "super_admin" | "owner" | "manager" | "customer_service" | "agent" | string;
type MembershipRow = { tenant_id: string | null; role: string | null };
type PropertyRow = { id: string; name: string | null; city: string | null; tenant_id: string };
type LeadRow = {
  id: string;
  tenant_id: string;
  property_id: string | null;
  company_name: string;
  contact_person_name: string;
  contact_title: string | null;
  email: string;
  phone: string | null;
  source: string;
  stage: LeadStage;
  approx_budget_eur_month: number | null;
  preferred_move_in_date: string | null;
  assigned_agent_user_id: string | null;
  business_id: string | null;
  company_size: string | null;
  industry_sector: string | null;
  interested_space_type: string | null;
  created_at: string;
  updated_at: string;
  archived: boolean | null;
  created_by_user_id: string | null;
};
type ProposalRow = {
  id: string;
  property_id: string;
  lead_id: string | null;
  tenant_company_name: string;
  contact_person: string;
  status: string;
  created_at: string;
};
type ContractRow = {
  id: string;
  tenant_id: string;
  property_id: string;
  status: string;
  start_date: string;
  end_date: string | null;
  created_at: string;
  source_proposal_id: string | null;
};
type UserRow = { id: string; display_name: string | null; email: string | null };

type ContactStatus = "pipeline_lead" | "active_tenant" | "past_tenant";
type ContactRecord = {
  id: string;
  companyName: string;
  contactName: string;
  contactTitle: string | null;
  email: string | null;
  phone: string | null;
  status: ContactStatus;
  propertyName: string | null;
  propertyId: string | null;
  stage: LeadStage | null;
  source: string | null;
  companySize: string | null;
  industry: string | null;
  budget: number | null;
  moveInDate: string | null;
  addedAt: string;
  updatedAt: string;
  assignedAgentName: string | null;
  spaceType: string | null;
  yTunnus: string | null;
  tenantId: string | null;
  leadId: string | null;
  readonly: boolean;
};

type SortBy = "company_az" | "recent_added" | "recent_updated" | "budget_desc" | "move_in_soon";
type ViewMode = "table" | "card";
type StatusFilter = "all" | ContactStatus;

const cardStyle: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  padding: 12,
};

function badgeStyle(status: ContactStatus): React.CSSProperties {
  const map: Record<ContactStatus, { bg: string; fg: string; label: string }> = {
    pipeline_lead: { bg: "#dbeafe", fg: "#1d4ed8", label: "Pipeline lead" },
    active_tenant: { bg: "#dcfce7", fg: "#15803d", label: "Active tenant" },
    past_tenant: { bg: "#e2e8f0", fg: "#334155", label: "Past tenant" },
  };
  return {
    display: "inline-block",
    fontSize: 12,
    padding: "2px 8px",
    borderRadius: 999,
    background: map[status].bg,
    color: map[status].fg,
  };
}

function statusLabel(status: ContactStatus): string {
  if (status === "pipeline_lead") return "Pipeline lead";
  if (status === "active_tenant") return "Active tenant";
  return "Past tenant";
}

function toDateKey(d: string | null): number {
  if (!d) return Number.POSITIVE_INFINITY;
  const t = +new Date(d);
  return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
}

export default function CrmContactsPage() {
  const supabase = useMemo(() => getSupabaseClient(), []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);

  const [properties, setProperties] = useState<PropertyRow[]>([]);
  const [records, setRecords] = useState<ContactRecord[]>([]);

  const [search, setSearch] = useState("");
  const [showFilters, setShowFilters] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [propertyFilter, setPropertyFilter] = useState("all");
  const [spaceTypeFilter, setSpaceTypeFilter] = useState("all");
  const [stageFilter, setStageFilter] = useState<LeadStage | "all">("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [companySizeFilter, setCompanySizeFilter] = useState("all");
  const [industryFilter, setIndustryFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sortBy, setSortBy] = useState<SortBy>("recent_added");
  const [viewMode, setViewMode] = useState<ViewMode>("table");

  async function loadAll() {
    setLoading(true);
    setError(null);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setError("Unauthorized");
      setLoading(false);
      return;
    }

    const { data: memRows, error: mErr } = await supabase.from("memberships").select("tenant_id, role").eq("user_id", user.id);
    if (mErr) {
      setError(mErr.message);
      setLoading(false);
      return;
    }
    const memberships = (memRows ?? []) as MembershipRow[];
    const roles = memberships.map((m) => (m.role ?? "").toLowerCase() as Role);
    const tenantIds = [...new Set(memberships.map((m) => m.tenant_id).filter(Boolean))] as string[];
    const superAdmin = roles.includes("super_admin");
    setIsSuperAdmin(superAdmin);
    const editAllowed = roles.some((r) => ["super_admin", "manager", "owner", "agent"].includes(r));
    setCanEdit(editAllowed);

    let pq = supabase.from("properties").select("id,name,city,tenant_id").order("name", { ascending: true });
    if (!superAdmin) {
      if (!tenantIds.length) {
        setProperties([]);
        setRecords([]);
        setLoading(false);
        return;
      }
      pq = pq.in("tenant_id", tenantIds);
    }
    const { data: propRows, error: pErr } = await pq;
    if (pErr) {
      setError(pErr.message);
      setLoading(false);
      return;
    }
    const props = (propRows ?? []) as PropertyRow[];
    setProperties(props);
    const allowedPropertyIds = props.map((p) => p.id);
    const propertiesById = new Map(props.map((p) => [p.id, p]));

    let leadsQuery = supabase.from("leads").select("*").order("created_at", { ascending: false });
    if (!superAdmin) {
      leadsQuery = leadsQuery.in("tenant_id", tenantIds);
    }
    const { data: leadRows, error: lErr } = await leadsQuery;
    if (lErr) {
      setError(lErr.message);
      setLoading(false);
      return;
    }

    // Owner-specific visibility: only own contacts.
    let leads = ((leadRows ?? []) as LeadRow[]).filter((l) => !l.archived);
    if (!superAdmin && roles.includes("owner") && !roles.includes("manager")) {
      leads = leads.filter((l) => l.assigned_agent_user_id === user.id || l.created_by_user_id === user.id);
    }

    let contractQuery = supabase
      .from("room_contracts")
      .select("id,tenant_id,property_id,status,start_date,end_date,created_at,source_proposal_id")
      .order("created_at", { ascending: false });
    if (!superAdmin) contractQuery = contractQuery.in("tenant_id", tenantIds);
    const { data: contractRows, error: cErr } = await contractQuery;
    if (cErr) {
      setError(cErr.message);
      setLoading(false);
      return;
    }
    const contracts = (contractRows ?? []) as ContractRow[];

    const proposalIds = [...new Set(contracts.map((c) => c.source_proposal_id).filter(Boolean))] as string[];
    let proposalMap = new Map<string, ProposalRow>();
    if (proposalIds.length) {
      const { data: propProposalRows } = await supabase
        .from("room_proposals")
        .select("id,property_id,lead_id,tenant_company_name,contact_person,status,created_at")
        .in("id", proposalIds);
      const proposals = (propProposalRows ?? []) as ProposalRow[];
      proposalMap = new Map(proposals.map((p) => [p.id, p]));
    }

    const agentIds = [...new Set(leads.map((l) => l.assigned_agent_user_id).filter(Boolean))] as string[];
    const userNameMap = new Map<string, string>();
    if (agentIds.length) {
      const { data: users } = await supabase.from("users").select("id,display_name,email").in("id", agentIds);
      ((users ?? []) as UserRow[]).forEach((u) => userNameMap.set(u.id, u.display_name ?? u.email ?? u.id.slice(0, 8)));
    }

    const merged = new Map<string, ContactRecord>();
    for (const l of leads) {
      const id = `lead_${l.id}`;
      merged.set(id, {
        id,
        companyName: l.company_name,
        contactName: l.contact_person_name,
        contactTitle: l.contact_title,
        email: l.email,
        phone: l.phone,
        status: "pipeline_lead",
        propertyName: l.property_id ? propertiesById.get(l.property_id)?.name ?? null : null,
        propertyId: l.property_id,
        stage: l.stage,
        source: l.source,
        companySize: l.company_size,
        industry: l.industry_sector,
        budget: l.approx_budget_eur_month,
        moveInDate: l.preferred_move_in_date,
        addedAt: l.created_at,
        updatedAt: l.updated_at ?? l.created_at,
        assignedAgentName: l.assigned_agent_user_id ? userNameMap.get(l.assigned_agent_user_id) ?? null : null,
        spaceType: l.interested_space_type,
        yTunnus: l.business_id,
        tenantId: l.tenant_id,
        leadId: l.id,
        readonly: !editAllowed || roles.includes("customer_service"),
      });
    }

    for (const c of contracts) {
      const p = c.source_proposal_id ? proposalMap.get(c.source_proposal_id) : null;
      const company = p?.tenant_company_name?.trim() || `Organization ${c.tenant_id.slice(0, 8)}`;
      const key = `tenant_${c.tenant_id}_${company.toLowerCase().replace(/\s+/g, "_")}`;
      const status: ContactStatus =
        c.status === "active" && (!c.end_date || +new Date(c.end_date) >= +new Date()) ? "active_tenant" : "past_tenant";
      const existing = merged.get(key);
      const addedAt = existing ? (toDateKey(existing.addedAt) < toDateKey(c.created_at) ? existing.addedAt : c.created_at) : c.created_at;
      const updatedAt = existing ? (toDateKey(existing.updatedAt) > toDateKey(c.created_at) ? existing.updatedAt : c.created_at) : c.created_at;
      merged.set(key, {
        id: key,
        companyName: company,
        contactName: p?.contact_person ?? existing?.contactName ?? "—",
        contactTitle: existing?.contactTitle ?? null,
        email: existing?.email ?? null,
        phone: existing?.phone ?? null,
        status: existing?.status === "active_tenant" ? "active_tenant" : status,
        propertyName: propertiesById.get(c.property_id)?.name ?? existing?.propertyName ?? null,
        propertyId: c.property_id,
        stage: existing?.stage ?? null,
        source: existing?.source ?? null,
        companySize: existing?.companySize ?? null,
        industry: existing?.industry ?? null,
        budget: existing?.budget ?? null,
        moveInDate: existing?.moveInDate ?? c.start_date,
        addedAt,
        updatedAt,
        assignedAgentName: existing?.assignedAgentName ?? null,
        spaceType: existing?.spaceType ?? null,
        yTunnus: existing?.yTunnus ?? null,
        tenantId: c.tenant_id,
        leadId: existing?.leadId ?? p?.lead_id ?? null,
        readonly: true,
      });
    }

    setRecords([...merged.values()]);
    setLoading(false);
  }

  useEffect(() => {
    void loadAll();
  }, []);

  const sourceOptions = useMemo(() => [...new Set(records.map((r) => r.source).filter(Boolean))] as string[], [records]);
  const sizeOptions = useMemo(() => [...new Set(records.map((r) => r.companySize).filter(Boolean))] as string[], [records]);
  const industryOptions = useMemo(() => [...new Set(records.map((r) => r.industry).filter(Boolean))] as string[], [records]);
  const spaceTypeOptions = useMemo(() => [...new Set(records.map((r) => r.spaceType).filter(Boolean))] as string[], [records]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = records.filter((r) => {
      if (!q) return true;
      return [r.companyName, r.contactName, r.email ?? "", r.phone ?? "", r.yTunnus ?? ""].join(" ").toLowerCase().includes(q);
    });
    if (statusFilter !== "all") rows = rows.filter((r) => r.status === statusFilter);
    if (propertyFilter !== "all") rows = rows.filter((r) => r.propertyId === propertyFilter);
    if (spaceTypeFilter !== "all") rows = rows.filter((r) => r.spaceType === spaceTypeFilter);
    if (stageFilter !== "all") rows = rows.filter((r) => r.stage === stageFilter);
    if (sourceFilter !== "all") rows = rows.filter((r) => r.source === sourceFilter);
    if (companySizeFilter !== "all") rows = rows.filter((r) => r.companySize === companySizeFilter);
    if (industryFilter !== "all") rows = rows.filter((r) => r.industry === industryFilter);
    if (dateFrom) rows = rows.filter((r) => +new Date(r.addedAt) >= +new Date(dateFrom));
    if (dateTo) rows = rows.filter((r) => +new Date(r.addedAt) <= +new Date(`${dateTo}T23:59:59`));

    rows.sort((a, b) => {
      if (sortBy === "company_az") return a.companyName.localeCompare(b.companyName);
      if (sortBy === "recent_added") return +new Date(b.addedAt) - +new Date(a.addedAt);
      if (sortBy === "recent_updated") return +new Date(b.updatedAt) - +new Date(a.updatedAt);
      if (sortBy === "budget_desc") return (b.budget ?? -1) - (a.budget ?? -1);
      if (sortBy === "move_in_soon") return toDateKey(a.moveInDate) - toDateKey(b.moveInDate);
      return 0;
    });
    return rows;
  }, [records, search, statusFilter, propertyFilter, spaceTypeFilter, stageFilter, sourceFilter, companySizeFilter, industryFilter, dateFrom, dateTo, sortBy]);

  function exportCsv() {
    const head = [
      "company_name",
      "contact_name",
      "email",
      "phone",
      "status",
      "property",
      "stage",
      "source",
      "company_size",
      "industry",
      "budget",
      "move_in_date",
      "assigned_agent",
      "y_tunnus",
      "added_date",
    ];
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const body = filtered
      .map((r) =>
        [
          r.companyName,
          r.contactName,
          r.email ?? "",
          r.phone ?? "",
          statusLabel(r.status),
          r.propertyName ?? "",
          r.stage ? LEAD_STAGE_LABEL[r.stage] : "",
          r.source ?? "",
          r.companySize ?? "",
          r.industry ?? "",
          r.budget ?? "",
          r.moveInDate ?? "",
          r.assignedAgentName ?? "",
          r.yTunnus ?? "",
          r.addedAt,
        ]
          .map(esc)
          .join(","),
      )
      .join("\n");
    const csv = `${head.join(",")}\n${body}`;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "crm_contacts_filtered.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportExcel() {
    const rows = filtered.map((r) => ({
      company_name: r.companyName,
      contact_name: r.contactName,
      email: r.email ?? "",
      phone: r.phone ?? "",
      status: statusLabel(r.status),
      property: r.propertyName ?? "",
      stage: r.stage ? LEAD_STAGE_LABEL[r.stage] : "",
      source: r.source ?? "",
      company_size: r.companySize ?? "",
      industry: r.industry ?? "",
      budget: r.budget ?? "",
      move_in_date: r.moveInDate ?? "",
      assigned_agent: r.assignedAgentName ?? "",
      y_tunnus: r.yTunnus ?? "",
      added_date: r.addedAt,
      updated_date: r.updatedAt,
    }));
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, "Contacts");
    XLSX.writeFile(wb, "crm_contacts_filtered.xlsx");
  }

  async function archiveLead(record: ContactRecord) {
    if (!record.leadId || !canEdit || record.readonly) return;
    const ok = window.confirm(`Archive lead ${record.companyName}?`);
    if (!ok) return;
    const { error: uErr } = await supabase.from("leads").update({ archived: true }).eq("id", record.leadId);
    if (uErr) {
      alert(uErr.message);
      return;
    }
    await loadAll();
  }

  if (loading) return <p>Loading contacts…</p>;
  if (error) return <p style={{ color: "#b91c1c" }}>{error}</p>;

  return (
    <main style={{ display: "grid", gap: 14 }}>
      <section style={{ ...cardStyle, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>Contacts / Client database</h1>
        <span style={{ flex: 1 }} />
        <Link href="/crm" style={{ color: "#2563eb" }}>CRM Pipeline</Link>
        <Link href="/crm/contacts" style={{ color: "#0f172a", fontWeight: 700 }}>Contacts</Link>
        <Link href="/crm/import" style={{ color: "#2563eb" }}>Import contacts</Link>
      </section>

      <section style={{ ...cardStyle, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search company, contact, email, phone, Y-tunnus..."
          style={{ padding: 10, minWidth: 320, flex: 1 }}
        />
        <button type="button" onClick={() => setShowFilters((v) => !v)} style={{ padding: "10px 12px" }}>
          {showFilters ? "Hide filters" : "Show filters"}
        </button>
        <select value={sortBy} onChange={(e) => setSortBy(e.target.value as SortBy)} style={{ padding: 10 }}>
          <option value="company_az">Company name A-Z</option>
          <option value="recent_added">Recently added</option>
          <option value="recent_updated">Recently updated</option>
          <option value="budget_desc">Budget high to low</option>
          <option value="move_in_soon">Move-in date soonest</option>
        </select>
        <button type="button" onClick={() => setViewMode("table")} style={{ padding: "10px 12px" }}>Table</button>
        <button type="button" onClick={() => setViewMode("card")} style={{ padding: "10px 12px" }}>Cards</button>
        <button type="button" onClick={exportExcel} style={{ padding: "10px 12px" }}>Export Excel</button>
        <button type="button" onClick={exportCsv} style={{ padding: "10px 12px" }}>Export CSV</button>
      </section>

      <div style={{ display: "grid", gridTemplateColumns: showFilters ? "280px 1fr" : "1fr", gap: 12 }}>
        {showFilters ? (
          <aside style={{ ...cardStyle, height: "fit-content", display: "grid", gap: 8 }}>
            <h3 style={{ margin: 0, fontSize: 16 }}>Filters</h3>
            <label style={{ display: "grid", gap: 4 }}>
              Status
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)} style={{ padding: 8 }}>
                <option value="all">All</option>
                <option value="pipeline_lead">Pipeline lead</option>
                <option value="active_tenant">Active tenant</option>
                <option value="past_tenant">Past tenant</option>
              </select>
            </label>
            <label style={{ display: "grid", gap: 4 }}>
              Property
              <select value={propertyFilter} onChange={(e) => setPropertyFilter(e.target.value)} style={{ padding: 8 }}>
                <option value="all">All</option>
                {properties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {formatPropertyLabel(p, { includeCity: true })}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "grid", gap: 4 }}>
              Space type
              <select value={spaceTypeFilter} onChange={(e) => setSpaceTypeFilter(e.target.value)} style={{ padding: 8 }}>
                <option value="all">All</option>
                {spaceTypeOptions.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </label>
            <label style={{ display: "grid", gap: 4 }}>
              Stage
              <select value={stageFilter} onChange={(e) => setStageFilter(e.target.value as LeadStage | "all")} style={{ padding: 8 }}>
                <option value="all">All</option>
                {LEAD_STAGES.map((s) => (
                  <option key={s} value={s}>{LEAD_STAGE_LABEL[s]}</option>
                ))}
              </select>
            </label>
            <label style={{ display: "grid", gap: 4 }}>
              Source
              <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)} style={{ padding: 8 }}>
                <option value="all">All</option>
                {sourceOptions.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </label>
            <label style={{ display: "grid", gap: 4 }}>
              Company size
              <select value={companySizeFilter} onChange={(e) => setCompanySizeFilter(e.target.value)} style={{ padding: 8 }}>
                <option value="all">All</option>
                {sizeOptions.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </label>
            <label style={{ display: "grid", gap: 4 }}>
              Industry
              <select value={industryFilter} onChange={(e) => setIndustryFilter(e.target.value)} style={{ padding: 8 }}>
                <option value="all">All</option>
                {industryOptions.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </label>
            <label style={{ display: "grid", gap: 4 }}>
              Added from
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} style={{ padding: 8 }} />
            </label>
            <label style={{ display: "grid", gap: 4 }}>
              Added to
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} style={{ padding: 8 }} />
            </label>
          </aside>
        ) : null}

        <section style={{ ...cardStyle }}>
          <p style={{ marginTop: 0, color: "#64748b" }}>
            {filtered.length} contact{filtered.length === 1 ? "" : "s"}{isSuperAdmin ? " (super admin scope)" : ""}
          </p>

          {viewMode === "table" ? (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr>
                    {["Company", "Contact", "Email", "Phone", "Status", "Property", "Stage", "Source", "Added", "Assigned agent", "Actions"].map((h) => (
                      <th key={h} style={{ textAlign: "left", borderBottom: "1px solid #e5e7eb", padding: "8px 6px" }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => (
                    <tr key={r.id}>
                      <td style={{ padding: "8px 6px", borderBottom: "1px solid #f1f5f9" }}>
                        <Link href={`/crm/contacts/${encodeURIComponent(r.id)}`}>{r.companyName}</Link>
                      </td>
                      <td style={{ padding: "8px 6px", borderBottom: "1px solid #f1f5f9" }}>{r.contactName}</td>
                      <td style={{ padding: "8px 6px", borderBottom: "1px solid #f1f5f9" }}>{r.email ?? "—"}</td>
                      <td style={{ padding: "8px 6px", borderBottom: "1px solid #f1f5f9" }}>{r.phone ?? "—"}</td>
                      <td style={{ padding: "8px 6px", borderBottom: "1px solid #f1f5f9" }}>
                        <span style={badgeStyle(r.status)}>{statusLabel(r.status)}</span>
                      </td>
                      <td style={{ padding: "8px 6px", borderBottom: "1px solid #f1f5f9" }}>{r.propertyName ?? "—"}</td>
                      <td style={{ padding: "8px 6px", borderBottom: "1px solid #f1f5f9" }}>{r.stage ? LEAD_STAGE_LABEL[r.stage] : "—"}</td>
                      <td style={{ padding: "8px 6px", borderBottom: "1px solid #f1f5f9" }}>{r.source ?? "—"}</td>
                      <td style={{ padding: "8px 6px", borderBottom: "1px solid #f1f5f9" }}>{formatDate(r.addedAt)}</td>
                      <td style={{ padding: "8px 6px", borderBottom: "1px solid #f1f5f9" }}>{r.assignedAgentName ?? "—"}</td>
                      <td style={{ padding: "8px 6px", borderBottom: "1px solid #f1f5f9", whiteSpace: "nowrap" }}>
                        <Link href={`/crm/contacts/${encodeURIComponent(r.id)}`}>View</Link>
                        {r.leadId && canEdit && !r.readonly ? (
                          <>
                            {" · "}
                            <Link href={`/crm/leads/${r.leadId}`}>Edit</Link>
                            {" · "}
                            <button type="button" onClick={() => void archiveLead(r)} style={{ fontSize: 12 }}>
                              Delete
                            </button>
                          </>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(250px,1fr))", gap: 10 }}>
              {filtered.map((r) => (
                <article key={r.id} style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 12 }}>
                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <div style={{ width: 34, height: 34, borderRadius: 999, background: "#e2e8f0", display: "grid", placeItems: "center", fontWeight: 700 }}>
                      {r.companyName.slice(0, 1).toUpperCase()}
                    </div>
                    <div>
                      <Link href={`/crm/contacts/${encodeURIComponent(r.id)}`} style={{ fontWeight: 700 }}>{r.companyName}</Link>
                      <div style={{ fontSize: 12, color: "#64748b" }}>{r.contactName}{r.contactTitle ? ` · ${r.contactTitle}` : ""}</div>
                    </div>
                  </div>
                  <div style={{ marginTop: 8, fontSize: 13 }}>{r.email ?? "—"}</div>
                  <div style={{ fontSize: 13 }}>{r.phone ?? "—"}</div>
                  <div style={{ marginTop: 8 }}>
                    <span style={badgeStyle(r.status)}>{statusLabel(r.status)}</span>
                  </div>
                  <div style={{ marginTop: 8, fontSize: 12, color: "#475569" }}>
                    {r.propertyName ? `Property: ${r.propertyName}` : "Property: —"}
                    <br />
                    {r.stage ? `Stage: ${LEAD_STAGE_LABEL[r.stage]}` : "Stage: —"}
                  </div>
                  <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
                    <Link href={`/crm/contacts/${encodeURIComponent(r.id)}`}>View</Link>
                    {r.leadId && canEdit && !r.readonly ? <Link href={`/crm/leads/${r.leadId}`}>Edit</Link> : null}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
