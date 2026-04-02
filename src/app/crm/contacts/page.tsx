"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { getSupabaseClient } from "@/lib/supabase/browser";
import { LEAD_STAGE_LABEL, LEAD_STAGES, type LeadStage } from "@/lib/crm";
import { normalizeSpaceType } from "@/lib/crm/lead-import-parse";
import CreateContactModal from "@/components/shared/CreateContactModal";
import ConfirmModal from "@/components/shared/ConfirmModal";
import EmailComposer from "@/components/shared/EmailComposer";
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
  customer_company_id: string | null;
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
  customerCompanyId: string | null;
  readonly: boolean;
};

type SortBy = "company_az" | "recent_added" | "recent_updated" | "budget_desc" | "move_in_soon";
type ViewMode = "table" | "card";
type StatusFilter = "all" | ContactStatus;

/** CRM UI uses public.leads for pipeline contacts (see sql/contract_tool_schema.sql). */
const PETROL = "#0D4F4F";
const PETROL_HOVER = "#0a3f3f";

const SPACE_TYPE_OPTIONS = ["Office", "Meeting room", "Venue", "Coworking", "Virtual Office"] as const;
const COMPANY_SIZE_OPTIONS = ["1-5", "6-10", "11-25", "26-50", "51-100", "100+"] as const;

function spaceTypeDbToUi(raw: string | null | undefined): (typeof SPACE_TYPE_OPTIONS)[number] | "" {
  const n = normalizeSpaceType(raw ?? undefined);
  if (n === "office") return "Office";
  if (n === "meeting_room") return "Meeting room";
  if (n === "venue") return "Venue";
  if (n === "hot_desk") return "Coworking";
  return "";
}

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

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [assignableUsers, setAssignableUsers] = useState<UserRow[]>([]);
  const [defaultTenantId, setDefaultTenantId] = useState("");

  const [emailTarget, setEmailTarget] = useState<ContactRecord | null>(null);
  const [showConvertModal, setShowConvertModal] = useState(false);
  const [archiveConfirm, setArchiveConfirm] = useState<ContactRecord | null>(null);
  const [convertSubmitting, setConvertSubmitting] = useState(false);
  const [convertError, setConvertError] = useState<string | null>(null);
  const [convertForm, setConvertForm] = useState({
    tenantId: "",
    name: "",
    businessId: "",
    email: "",
    phone: "",
    addressLine: "",
    city: "",
    postalCode: "",
    industry: "",
    companySize: "",
    propertyId: "",
    spaceType: "Office" as (typeof SPACE_TYPE_OPTIONS)[number],
    contractStart: "",
    contractEnd: "",
    notes: "",
    leadId: "",
  });

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(t);
  }, [toast]);

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
    const propertiesById = new Map(props.map((p) => [p.id, p]));

    let scopeTenantIds = tenantIds;
    if (superAdmin && scopeTenantIds.length === 0 && props.length > 0) {
      scopeTenantIds = [...new Set(props.map((p) => p.tenant_id).filter(Boolean))] as string[];
    }
    setDefaultTenantId(scopeTenantIds[0] ?? "");

    let assignable: UserRow[] = [];
    if (scopeTenantIds.length > 0) {
      const { data: roleMems } = await supabase
        .from("memberships")
        .select("user_id")
        .in("tenant_id", scopeTenantIds)
        .in("role", ["owner", "manager", "agent", "super_admin"]);
      const assignIds = [...new Set((roleMems ?? []).map((m) => m.user_id).filter(Boolean))] as string[];
      if (assignIds.length) {
        const { data: urows } = await supabase
          .from("users")
          .select("id, display_name, email")
          .in("id", assignIds)
          .order("display_name", { ascending: true });
        assignable = (urows ?? []) as UserRow[];
      }
    }
    setAssignableUsers(assignable);

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
        customerCompanyId: l.customer_company_id ?? null,
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
        customerCompanyId: existing?.customerCompanyId ?? null,
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

  async function performArchiveLead(record: ContactRecord) {
    if (!record.leadId || !canEdit || record.readonly) return;
    const { error: uErr } = await supabase.from("leads").update({ archived: true }).eq("id", record.leadId);
    if (uErr) {
      alert(uErr.message);
      return;
    }
    await loadAll();
  }

  function openConvertToCustomer(r: ContactRecord) {
    if (!r.leadId || !r.tenantId) return;
    setConvertForm({
      tenantId: r.tenantId,
      name: r.companyName,
      businessId: r.yTunnus ?? "",
      email: r.email ?? "",
      phone: r.phone ?? "",
      addressLine: "",
      city: "",
      postalCode: "",
      industry: r.industry ?? "",
      companySize: r.companySize ?? "",
      propertyId: r.propertyId ?? "",
      spaceType: (spaceTypeDbToUi(r.spaceType) || "Office") as (typeof SPACE_TYPE_OPTIONS)[number],
      contractStart: "",
      contractEnd: "",
      notes: "",
      leadId: r.leadId,
    });
    setConvertError(null);
    setShowConvertModal(true);
  }

  async function submitConvertToCustomer(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canEdit) return;
    setConvertSubmitting(true);
    setConvertError(null);
    const res = await fetch("/api/customer-companies", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenantId: convertForm.tenantId,
        propertyId: convertForm.propertyId || null,
        name: convertForm.name.trim(),
        businessId: convertForm.businessId || null,
        email: convertForm.email || null,
        phone: convertForm.phone || null,
        addressLine: convertForm.addressLine || null,
        city: convertForm.city || null,
        postalCode: convertForm.postalCode || null,
        industry: convertForm.industry || null,
        companySize: convertForm.companySize || null,
        spaceType: convertForm.spaceType || null,
        contractStart: convertForm.contractStart || null,
        contractEnd: convertForm.contractEnd || null,
        notes: convertForm.notes || null,
        leadId: convertForm.leadId,
      }),
    });
    const json = (await res.json()) as { error?: string };
    setConvertSubmitting(false);
    if (!res.ok) {
      setConvertError(json.error ?? "Could not create customer company.");
      return;
    }
    setShowConvertModal(false);
    setToast("Customer company created and contact linked.");
    await loadAll();
  }

  if (loading) return <p>Loading contacts…</p>;
  if (error) return <p style={{ color: "#b91c1c" }}>{error}</p>;

  const pageShell: React.CSSProperties = {
    width: "100%",
    maxWidth: "100%",
    overflow: "hidden",
    boxSizing: "border-box",
    padding: "16px",
  };

  const modalInput: React.CSSProperties = {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 8,
    border: "1px solid #e5e7eb",
    fontSize: 14,
    boxSizing: "border-box",
  };
  const modalLabel: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: "#334155", display: "block", marginBottom: 6 };

  return (
    <main style={{ ...pageShell, display: "grid", gap: 14 }}>
      {toast ? (
        <div
          role="status"
          style={{
            position: "fixed",
            top: 20,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 10001,
            background: PETROL,
            color: "#fff",
            padding: "12px 20px",
            borderRadius: 10,
            fontSize: 14,
            fontWeight: 600,
            boxShadow: "0 8px 24px rgba(0,0,0,0.15)",
          }}
        >
          {toast}
        </div>
      ) : null}

      <section style={{ ...cardStyle, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", maxWidth: "100%", minWidth: 0 }}>
        <h1 className="vw-admin-page-title" style={{ margin: 0 }}>Contacts / Client database</h1>
        <span style={{ flex: 1, minWidth: 8 }} />
        <Link href="/crm" className="vw-btn-secondary" style={{ textDecoration: "none" }}>
          CRM Pipeline
        </Link>
        <Link href="/crm/contacts" className="vw-tab-active" style={{ textDecoration: "none" }}>
          Contacts
        </Link>
        <Link href="/crm/import" className="vw-btn-secondary" style={{ textDecoration: "none" }}>
          Import contacts
        </Link>
        {canEdit ? (
          <button type="button" className="vw-btn-primary" onClick={() => setShowCreateModal(true)}>
            + Create Contact
          </button>
        ) : null}
      </section>

      <section
        style={{
          ...cardStyle,
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          alignItems: "center",
          marginBottom: 4,
          maxWidth: "100%",
          minWidth: 0,
        }}
      >
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search company, contact, email, phone, Y-tunnus..."
          style={{ padding: 10, minWidth: 0, flex: "1 1 200px", maxWidth: "100%" }}
        />
        <button type="button" className="vw-btn-secondary" onClick={() => setShowFilters((v) => !v)}>
          {showFilters ? "Hide filters" : "Show filters"}
        </button>
        <select className="vw-select" value={sortBy} onChange={(e) => setSortBy(e.target.value as SortBy)}>
          <option value="company_az">Company name A-Z</option>
          <option value="recent_added">Recently added</option>
          <option value="recent_updated">Recently updated</option>
          <option value="budget_desc">Budget high to low</option>
          <option value="move_in_soon">Move-in date soonest</option>
        </select>
        <button type="button" className={viewMode === "table" ? "vw-tab-active" : "vw-tab-inactive"} onClick={() => setViewMode("table")}>
          Table
        </button>
        <button type="button" className={viewMode === "card" ? "vw-tab-active" : "vw-tab-inactive"} onClick={() => setViewMode("card")}>
          Cards
        </button>
        <button type="button" className="vw-btn-secondary" onClick={exportExcel}>
          Export Excel
        </button>
        <button type="button" className="vw-btn-secondary" onClick={exportCsv}>
          Export CSV
        </button>
      </section>

      <div
        style={{
          display: "flex",
          flexDirection: "row",
          gap: 12,
          alignItems: "flex-start",
          width: "100%",
          maxWidth: "100%",
          minWidth: 0,
        }}
      >
        {showFilters ? (
          <aside style={{ ...cardStyle, width: 256, flexShrink: 0, height: "fit-content", display: "grid", gap: 8, maxWidth: "100%", boxSizing: "border-box" }}>
            <h3 style={{ margin: 0, fontSize: 16 }}>Filters</h3>
            <label style={{ display: "grid", gap: 4 }}>
              Status
              <select
                className="vw-select"
                style={{ width: "100%" }}
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
              >
                <option value="all">All</option>
                <option value="pipeline_lead">Pipeline lead</option>
                <option value="active_tenant">Active tenant</option>
                <option value="past_tenant">Past tenant</option>
              </select>
            </label>
            <label style={{ display: "grid", gap: 4 }}>
              Property
              <select
                className="vw-select"
                style={{ width: "100%" }}
                value={propertyFilter}
                onChange={(e) => setPropertyFilter(e.target.value)}
              >
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
              <select
                className="vw-select"
                style={{ width: "100%" }}
                value={spaceTypeFilter}
                onChange={(e) => setSpaceTypeFilter(e.target.value)}
              >
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
              <select
                className="vw-select"
                style={{ width: "100%" }}
                value={sourceFilter}
                onChange={(e) => setSourceFilter(e.target.value)}
              >
                <option value="all">All</option>
                {sourceOptions.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </label>
            <label style={{ display: "grid", gap: 4 }}>
              Company size
              <select
                className="vw-select"
                style={{ width: "100%" }}
                value={companySizeFilter}
                onChange={(e) => setCompanySizeFilter(e.target.value)}
              >
                <option value="all">All</option>
                {sizeOptions.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </label>
            <label style={{ display: "grid", gap: 4 }}>
              Industry
              <select
                className="vw-select"
                style={{ width: "100%" }}
                value={industryFilter}
                onChange={(e) => setIndustryFilter(e.target.value)}
              >
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
              <input
                type="date"
                className="vw-select"
                style={{ width: "100%" }}
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </label>
          </aside>
        ) : null}

        <section style={{ ...cardStyle, flex: 1, minWidth: 0, maxWidth: "100%", overflow: "hidden", boxSizing: "border-box" }}>
          <p style={{ marginTop: 0, color: "#64748b" }}>
            {filtered.length} contact{filtered.length === 1 ? "" : "s"}{isSuperAdmin ? " (super admin scope)" : ""}
          </p>

          {viewMode === "table" ? (
            <div style={{ overflowX: "auto", width: "100%", WebkitOverflowScrolling: "touch" }}>
              <table style={{ width: "100%", minWidth: "max-content", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr>
                    {["Company", "Y-tunnus", "Contact", "Email", "Phone", "Status", "Property", "Stage", "Source", "Added", "Assigned agent", "Actions"].map((h) => (
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
                      <td style={{ padding: "8px 6px", borderBottom: "1px solid #f1f5f9" }}>{r.yTunnus ?? "—"}</td>
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
                        {r.leadId && r.email && canEdit && !r.readonly ? (
                          <>
                            {" · "}
                            <button
                              type="button"
                              onClick={() => setEmailTarget(r)}
                              style={{ fontSize: 12, color: PETROL, fontWeight: 600, background: "none", border: "none", padding: 0, cursor: "pointer" }}
                            >
                              Send email
                            </button>
                          </>
                        ) : null}
                        {r.leadId && canEdit && !r.readonly ? (
                          <>
                            {" · "}
                            <Link href={`/crm/leads/${r.leadId}`}>Edit</Link>
                            {r.customerCompanyId ? null : (
                              <>
                                {" · "}
                                <button
                                  type="button"
                                  onClick={() => openConvertToCustomer(r)}
                                  style={{ fontSize: 12, color: PETROL, fontWeight: 600, background: "none", border: "none", padding: 0, cursor: "pointer" }}
                                >
                                  Convert to Customer
                                </button>
                              </>
                            )}
                            {" · "}
                            <button type="button" onClick={() => setArchiveConfirm(r)} style={{ fontSize: 12 }}>
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
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(min(250px,100%),1fr))", gap: 10, width: "100%", minWidth: 0 }}>
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
                  <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <Link href={`/crm/contacts/${encodeURIComponent(r.id)}`}>View</Link>
                    {r.leadId && r.email && canEdit && !r.readonly ? (
                      <button
                        type="button"
                        onClick={() => setEmailTarget(r)}
                        style={{ fontSize: 12, color: PETROL, fontWeight: 600, background: "none", border: "none", padding: 0, cursor: "pointer" }}
                      >
                        Send email
                      </button>
                    ) : null}
                    {r.leadId && canEdit && !r.readonly ? <Link href={`/crm/leads/${r.leadId}`}>Edit</Link> : null}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>

      {emailTarget && emailTarget.leadId && emailTarget.tenantId ? (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15,23,42,0.45)",
            display: "grid",
            placeItems: "center",
            zIndex: 60,
            padding: 16,
          }}
          onClick={() => setEmailTarget(null)}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: 12,
              padding: 20,
              maxWidth: 560,
              width: "100%",
              maxHeight: "90vh",
              overflow: "auto",
              boxShadow: "0 20px 40px rgba(0,0,0,0.12)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ marginTop: 0, fontSize: 18 }}>Send email</h2>
            <p style={{ marginTop: 0, fontSize: 13, color: "#64748b" }}>{emailTarget.companyName}</p>
            <EmailComposer
              source="crm"
              mode="single"
              tenantId={emailTarget.tenantId}
              leadId={emailTarget.leadId}
              relatedType="lead"
              defaultTo={emailTarget.email ?? ""}
              onCancel={() => setEmailTarget(null)}
              onSent={() => {
                setEmailTarget(null);
                setToast("Email sent.");
              }}
            />
          </div>
        </div>
      ) : null}

      <CreateContactModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        initialCompanyName=""
        properties={properties}
        defaultTenantId={defaultTenantId}
        assignableUsers={assignableUsers}
        onCreated={() => {
          setToast("Contact created successfully.");
          void loadAll();
        }}
      />

      {showConvertModal ? (
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
            overflowY: "auto",
          }}
          onClick={() => !convertSubmitting && setShowConvertModal(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="convert-customer-title"
            onClick={(ev) => ev.stopPropagation()}
            style={{
              background: "#fff",
              borderRadius: 16,
              padding: 24,
              maxWidth: 520,
              width: "100%",
              maxHeight: "min(90vh, 900px)",
              overflowY: "auto",
              boxSizing: "border-box",
            }}
          >
            <h2 id="convert-customer-title" style={{ margin: "0 0 8px", fontSize: 20, fontWeight: 700, color: "#0f172a" }}>
              Convert to Customer Company
            </h2>
            <p style={{ margin: "0 0 16px", fontSize: 13, color: "#64748b", lineHeight: 1.45 }}>
              Creates a customer company and links this CRM contact. You can invite portal users from Admin → Customers.
            </p>
            <form onSubmit={(e) => void submitConvertToCustomer(e)} style={{ display: "grid", gap: 12 }}>
              <label style={modalLabel}>
                Company name *
                <input
                  required
                  value={convertForm.name}
                  onChange={(e) => setConvertForm((f) => ({ ...f, name: e.target.value }))}
                  style={modalInput}
                />
              </label>
              <label style={modalLabel}>
                Y-tunnus
                <input
                  value={convertForm.businessId}
                  onChange={(e) => setConvertForm((f) => ({ ...f, businessId: e.target.value }))}
                  style={modalInput}
                />
              </label>
              <label style={modalLabel}>
                Email
                <input
                  type="email"
                  value={convertForm.email}
                  onChange={(e) => setConvertForm((f) => ({ ...f, email: e.target.value }))}
                  style={modalInput}
                />
              </label>
              <label style={modalLabel}>
                Phone
                <input
                  value={convertForm.phone}
                  onChange={(e) => setConvertForm((f) => ({ ...f, phone: e.target.value }))}
                  style={modalInput}
                />
              </label>
              <label style={modalLabel}>
                Address
                <input
                  value={convertForm.addressLine}
                  onChange={(e) => setConvertForm((f) => ({ ...f, addressLine: e.target.value }))}
                  style={modalInput}
                />
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <label style={modalLabel}>
                  City
                  <input
                    value={convertForm.city}
                    onChange={(e) => setConvertForm((f) => ({ ...f, city: e.target.value }))}
                    style={modalInput}
                  />
                </label>
                <label style={modalLabel}>
                  Postal code
                  <input
                    value={convertForm.postalCode}
                    onChange={(e) => setConvertForm((f) => ({ ...f, postalCode: e.target.value }))}
                    style={modalInput}
                  />
                </label>
              </div>
              <label style={modalLabel}>
                Industry
                <input
                  value={convertForm.industry}
                  onChange={(e) => setConvertForm((f) => ({ ...f, industry: e.target.value }))}
                  style={modalInput}
                />
              </label>
              <label style={modalLabel}>
                Company size
                <select
                  className="vw-select"
                  style={{ width: "100%", boxSizing: "border-box" }}
                  value={convertForm.companySize}
                  onChange={(e) => setConvertForm((f) => ({ ...f, companySize: e.target.value }))}
                >
                  <option value="">—</option>
                  {COMPANY_SIZE_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
              <label style={modalLabel}>
                Property
                <select
                  className="vw-select"
                  style={{ width: "100%", boxSizing: "border-box" }}
                  value={convertForm.propertyId}
                  onChange={(e) => setConvertForm((f) => ({ ...f, propertyId: e.target.value }))}
                >
                  <option value="">— None —</option>
                  {properties.map((p) => (
                    <option key={p.id} value={p.id}>
                      {formatPropertyLabel(p, { includeCity: true })}
                    </option>
                  ))}
                </select>
              </label>
              <label style={modalLabel}>
                Space type
                <select
                  className="vw-select"
                  style={{ width: "100%", boxSizing: "border-box" }}
                  value={convertForm.spaceType}
                  onChange={(e) =>
                    setConvertForm((f) => ({ ...f, spaceType: e.target.value as (typeof SPACE_TYPE_OPTIONS)[number] }))
                  }
                >
                  {SPACE_TYPE_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <label style={modalLabel}>
                  Contract start
                  <input
                    type="date"
                    value={convertForm.contractStart}
                    onChange={(e) => setConvertForm((f) => ({ ...f, contractStart: e.target.value }))}
                    style={modalInput}
                  />
                </label>
                <label style={modalLabel}>
                  Contract end
                  <input
                    type="date"
                    value={convertForm.contractEnd}
                    onChange={(e) => setConvertForm((f) => ({ ...f, contractEnd: e.target.value }))}
                    style={modalInput}
                  />
                </label>
              </div>
              <label style={modalLabel}>
                Notes
                <textarea
                  value={convertForm.notes}
                  onChange={(e) => setConvertForm((f) => ({ ...f, notes: e.target.value }))}
                  rows={3}
                  style={{ ...modalInput, resize: "vertical", fontFamily: "inherit" }}
                />
              </label>
              {convertError ? <p style={{ margin: 0, fontSize: 13, color: "#b91c1c" }}>{convertError}</p> : null}
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, flexWrap: "wrap" }}>
                <button
                  type="button"
                  disabled={convertSubmitting}
                  onClick={() => !convertSubmitting && setShowConvertModal(false)}
                  style={{
                    padding: "10px 18px",
                    borderRadius: 8,
                    border: "1px solid #e5e7eb",
                    background: "#fff",
                    fontWeight: 600,
                    cursor: convertSubmitting ? "not-allowed" : "pointer",
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={convertSubmitting}
                  style={{
                    padding: "10px 18px",
                    borderRadius: 8,
                    border: "none",
                    background: PETROL,
                    color: "#fff",
                    fontWeight: 600,
                    cursor: convertSubmitting ? "not-allowed" : "pointer",
                    opacity: convertSubmitting ? 0.85 : 1,
                  }}
                >
                  {convertSubmitting ? "Creating…" : "Create & link"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      <ConfirmModal
        isOpen={!!archiveConfirm}
        title="Archive lead"
        message={
          archiveConfirm
            ? `Are you sure you want to archive lead ${archiveConfirm.companyName}?`
            : ""
        }
        confirmLabel="Archive"
        variant="danger"
        onConfirm={() => {
          const r = archiveConfirm;
          setArchiveConfirm(null);
          if (r) void performArchiveLead(r);
        }}
        onCancel={() => setArchiveConfirm(null)}
      />
    </main>
  );
}
