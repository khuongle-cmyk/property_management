"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { getSupabaseClient } from "@/lib/supabase/browser";
import { LEAD_SOURCES, LEAD_STAGE_LABEL, LEAD_STAGES, type LeadStage } from "@/lib/crm";
import { normalizeSpaceType } from "@/lib/crm/lead-import-parse";
import CreateContactModal from "@/components/shared/CreateContactModal";
import ConvertToCustomerModal, {
  type ConvertToCustomerLead,
} from "@/components/shared/ConvertToCustomerModal";
import EditContactModal from "@/components/shared/EditContactModal";
import ConfirmModal from "@/components/shared/ConfirmModal";
import EmailComposer from "@/components/shared/EmailComposer";
import { formatPropertyLabel } from "@/lib/properties/label";

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
  notes: string | null;
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
  notes: string | null;
  archived?: boolean | null;
};

type SortBy = "recent_added" | "company_az" | "contact_az" | "contact_za";
type ViewMode = "table" | "card";
type StatusFilter = "all" | ContactStatus;

/** CRM UI uses public.leads for pipeline contacts (see sql/contract_tool_schema.sql). */
/** VillageWorks brand (inline hex — no Tailwind dark:). */
const VW = {
  petrol: "#21524F",
  beige: "#F3DFC6",
  white: "#FFFFFF",
  pageBg: "#F8F6F1",
  border: "#E8E4DD",
  text: "#1A1A1A",
  textSecondary: "#6B6560",
} as const;
const PETROL = VW.petrol;

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

/** Map filter UI label to DB `interested_space_type` (see CreateContactModal). */
function spaceTypeUiToDb(ui: string): string | null {
  if (ui === "Virtual Office") return null;
  const raw =
    ui === "Office"
      ? "office"
      : ui === "Meeting room"
        ? "meeting_room"
        : ui === "Venue"
          ? "venue"
          : ui === "Coworking"
            ? "hot_desk"
            : "";
  return normalizeSpaceType(raw ?? undefined);
}

function contactInitials(name: string): string {
  const p = name.trim().split(/\s+/).filter(Boolean);
  if (p.length === 0) return "?";
  if (p.length === 1) return p[0].slice(0, 2).toUpperCase();
  return `${p[0][0] ?? ""}${p[p.length - 1][0] ?? ""}`.toUpperCase();
}

const cardStyle: React.CSSProperties = {
  background: VW.white,
  border: `1px solid ${VW.border}`,
  borderRadius: 12,
  padding: 12,
};

const filterSelectStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 8,
  border: `1px solid ${VW.border}`,
  background: VW.white,
  fontSize: 14,
  fontFamily: "'DM Sans', sans-serif",
  color: VW.text,
  boxSizing: "border-box",
};

function badgeStyle(status: ContactStatus): React.CSSProperties {
  const map: Record<ContactStatus, { bg: string; fg: string }> = {
    pipeline_lead: { bg: "#E8F5F0", fg: VW.petrol },
    active_tenant: { bg: "#E8F5F0", fg: "#15803d" },
    past_tenant: { bg: "#F3EDE4", fg: VW.textSecondary },
  };
  return {
    display: "inline-block",
    fontSize: 12,
    padding: "4px 10px",
    borderRadius: 999,
    background: map[status].bg,
    color: map[status].fg,
    fontWeight: 600,
    fontFamily: "'DM Sans', sans-serif",
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
  const [editContact, setEditContact] = useState<ContactRecord | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [assignableUsers, setAssignableUsers] = useState<UserRow[]>([]);
  const [defaultTenantId, setDefaultTenantId] = useState("");

  const [emailTarget, setEmailTarget] = useState<ContactRecord | null>(null);
  const [showConvertModal, setShowConvertModal] = useState(false);
  const [convertLead, setConvertLead] = useState<ConvertToCustomerLead | null>(null);
  const [archiveConfirm, setArchiveConfirm] = useState<ContactRecord | null>(null);

  const [activeTab, setActiveTab] = useState<"contacts" | "archive">("contacts");
  const [archivedLeads, setArchivedLeads] = useState<ContactRecord[]>([]);
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [permanentDeleteConfirm, setPermanentDeleteConfirm] = useState<ContactRecord | null>(null);
  const [importExportMenuOpen, setImportExportMenuOpen] = useState(false);
  const importExportMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!importExportMenuOpen) return;
    const close = (e: MouseEvent) => {
      if (importExportMenuRef.current && !importExportMenuRef.current.contains(e.target as Node)) {
        setImportExportMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [importExportMenuOpen]);

  const fetchArchivedLeads = useCallback(async () => {
    setArchiveLoading(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setArchivedLeads([]);
        return;
      }
      const { data: memRows } = await supabase.from("memberships").select("tenant_id, role").eq("user_id", user.id);
      const memberships = (memRows ?? []) as MembershipRow[];
      const roles = memberships.map((m) => (m.role ?? "").toLowerCase() as Role);
      const superAdmin = roles.includes("super_admin");
      const tenantIds = [...new Set(memberships.map((m) => m.tenant_id).filter(Boolean))] as string[];
      const editAllowed = roles.some((r) => ["super_admin", "manager", "owner", "agent"].includes(r));

      let query = supabase.from("leads").select("*").or("archived.eq.true,stage.eq.lost,stage.eq.won");
      if (!superAdmin) {
        if (!tenantIds.length) {
          setArchivedLeads([]);
          return;
        }
        query = query.in("tenant_id", tenantIds);
      }
      const { data, error } = await query.order("updated_at", { ascending: false });
      if (error) throw error;
      let rows = (data ?? []) as LeadRow[];
      if (!superAdmin && roles.includes("owner") && !roles.includes("manager")) {
        rows = rows.filter((l) => l.assigned_agent_user_id === user.id || l.created_by_user_id === user.id);
      }
      const mapped: ContactRecord[] = rows.map((l) => ({
        id: `lead_${l.id}`,
        companyName: l.company_name || "—",
        contactName: l.contact_person_name || "—",
        contactTitle: l.contact_title,
        email: l.email || null,
        phone: l.phone,
        status:
          l.archived === true
            ? "pipeline_lead"
            : l.stage === "won"
              ? ("active_tenant" as ContactStatus)
              : ("pipeline_lead" as ContactStatus),
        propertyName: null,
        propertyId: l.property_id,
        stage: l.stage,
        source: l.source,
        companySize: l.company_size,
        industry: l.industry_sector,
        budget: l.approx_budget_eur_month,
        moveInDate: l.preferred_move_in_date,
        addedAt: l.created_at,
        updatedAt: l.updated_at ?? l.created_at,
        assignedAgentName: null,
        spaceType: l.interested_space_type,
        yTunnus: l.business_id,
        tenantId: l.tenant_id,
        leadId: l.id,
        customerCompanyId: l.customer_company_id ?? null,
        readonly: !editAllowed || roles.includes("customer_service"),
        notes: l.notes ?? null,
        archived: l.archived,
      }));
      setArchivedLeads(mapped);
    } catch (err) {
      console.error("Error fetching archived leads:", err);
    } finally {
      setArchiveLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    if (activeTab === "archive") void fetchArchivedLeads();
  }, [activeTab, fetchArchivedLeads]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(t);
  }, [toast]);

  const [industryFacets, setIndustryFacets] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.from("leads").select("industry_sector").limit(5000);
      if (cancelled || error) return;
      const u = [...new Set((data ?? []).map((r) => (r as { industry_sector: string | null }).industry_sector).filter(Boolean))] as string[];
      u.sort((a, b) => a.localeCompare(b));
      setIndustryFacets(u);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  const loadAll = useCallback(async () => {
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

    let leadsQuery = supabase.from("leads").select("*").eq("archived", false);
    if (!superAdmin) {
      leadsQuery = leadsQuery.in("tenant_id", tenantIds);
    }
    if (propertyFilter !== "all") leadsQuery = leadsQuery.eq("property_id", propertyFilter);
    if (stageFilter !== "all") leadsQuery = leadsQuery.eq("stage", stageFilter);
    if (sourceFilter !== "all") leadsQuery = leadsQuery.eq("source", sourceFilter);
    if (companySizeFilter !== "all") leadsQuery = leadsQuery.eq("company_size", companySizeFilter);
    if (industryFilter !== "all") leadsQuery = leadsQuery.eq("industry_sector", industryFilter);
    if (dateFrom) leadsQuery = leadsQuery.gte("created_at", `${dateFrom}T00:00:00.000Z`);
    if (dateTo) leadsQuery = leadsQuery.lte("created_at", `${dateTo}T23:59:59.999Z`);
    if (spaceTypeFilter === "Virtual Office") {
      leadsQuery = leadsQuery.is("interested_space_type", null);
    } else if (spaceTypeFilter !== "all") {
      const dbSt = spaceTypeUiToDb(spaceTypeFilter);
      if (dbSt) leadsQuery = leadsQuery.eq("interested_space_type", dbSt);
    }
    leadsQuery = leadsQuery.order("created_at", { ascending: false });

    const { data: leadRows, error: lErr } = await leadsQuery;
    if (lErr) {
      setError(lErr.message);
      setLoading(false);
      return;
    }

    // Owner-specific visibility: only own contacts.
    let leads = (leadRows ?? []) as LeadRow[];
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
    let contracts = (contractRows ?? []) as ContractRow[];
    if (propertyFilter !== "all") {
      contracts = contracts.filter((c) => c.property_id === propertyFilter);
    }

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
        notes: l.notes ?? null,
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
        notes: existing?.notes ?? null,
      });
    }

    setRecords([...merged.values()]);
    setLoading(false);
  }, [
    supabase,
    propertyFilter,
    spaceTypeFilter,
    stageFilter,
    sourceFilter,
    companySizeFilter,
    industryFilter,
    dateFrom,
    dateTo,
  ]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

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
      if (sortBy === "contact_az") return a.contactName.localeCompare(b.contactName);
      if (sortBy === "contact_za") return b.contactName.localeCompare(a.contactName);
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

  async function archiveLeadById(leadId: string) {
    const { error: uErr } = await supabase.from("leads").update({ archived: true }).eq("id", leadId);
    if (uErr) throw new Error(uErr.message);
  }

  async function performArchiveLead(record: ContactRecord) {
    if (!record.leadId || !canEdit || record.readonly) return;
    try {
      await archiveLeadById(record.leadId);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Could not archive.");
      return;
    }
    await loadAll();
  }

  async function permanentDeleteLead(leadId: string) {
    const { error: upErr } = await supabase
      .from("leads")
      .update({
        won_room_id: null,
        won_proposal_id: null,
        assigned_agent_user_id: null,
        interested_property_id: null,
      })
      .eq("id", leadId);
    if (upErr) {
      console.error("Error clearing lead references:", upErr);
      alert("Failed to prepare delete: " + upErr.message);
      return;
    }
    const { error } = await supabase.from("leads").delete().eq("id", leadId);
    if (error) {
      console.error("Error permanently deleting lead:", error);
      alert("Failed to delete: " + error.message);
    } else {
      void fetchArchivedLeads();
    }
  }

  async function restoreLead(leadId: string) {
    const { error } = await supabase.from("leads").update({ archived: false, stage: "new" }).eq("id", leadId);
    if (error) {
      console.error("Error restoring lead:", error);
    } else {
      void fetchArchivedLeads();
      void loadAll();
    }
  }

  async function openConvertToCustomer(r: ContactRecord) {
    if (!r.leadId || !r.tenantId) return;
    const { data, error: qErr } = await supabase.from("leads").select("*").eq("id", r.leadId).maybeSingle();
    if (qErr || !data) {
      setToast(qErr?.message ?? "Could not load lead.");
      return;
    }
    setConvertLead(data as ConvertToCustomerLead);
    setShowConvertModal(true);
  }

  function tryOpenEditForRow(r: ContactRecord) {
    if (r.leadId && canEdit && !r.readonly) setEditContact(r);
  }

  if (loading) {
    return (
      <div
        style={{
          minHeight: "50vh",
          display: "grid",
          placeItems: "center",
          background: VW.pageBg,
          fontFamily: "'DM Sans', sans-serif",
          color: VW.textSecondary,
          fontSize: 15,
        }}
      >
        Loading contacts…
      </div>
    );
  }
  if (error) {
    return (
      <div style={{ padding: 24, background: VW.pageBg, color: "#b91c1c", fontFamily: "'DM Sans', sans-serif" }}>{error}</div>
    );
  }

  const pageShell: React.CSSProperties = {
    width: "100%",
    maxWidth: "100%",
    overflow: "hidden",
    boxSizing: "border-box",
    padding: "20px 24px 32px",
    background: VW.pageBg,
  };

  const tabInactive: React.CSSProperties = {
    padding: "10px 16px",
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 600,
    textDecoration: "none",
    fontFamily: "'DM Sans', sans-serif",
    border: `1px solid ${VW.border}`,
    background: VW.white,
    color: VW.text,
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
  };
  const tabActiveNav: React.CSSProperties = {
    ...tabInactive,
    background: VW.petrol,
    color: VW.white,
    borderColor: VW.petrol,
  };
  const outlineBtn: React.CSSProperties = {
    padding: "10px 16px",
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 600,
    fontFamily: "'DM Sans', sans-serif",
    border: `1px solid ${VW.border}`,
    background: VW.white,
    color: VW.text,
    cursor: "pointer",
  };

  return (
    <main style={{ ...pageShell, display: "grid", gap: 18 }}>
      {toast ? (
        <div
          role="status"
          style={{
            position: "fixed",
            top: 20,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 10001,
            background: VW.petrol,
            color: "#fff",
            padding: "12px 20px",
            borderRadius: 10,
            fontSize: 14,
            fontWeight: 600,
            boxShadow: "0 8px 24px rgba(0,0,0,0.15)",
            fontFamily: "'DM Sans', sans-serif",
          }}
        >
          {toast}
        </div>
      ) : null}

      {/* Header row */}
      <header
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 12,
          alignItems: "center",
          justifyContent: "space-between",
          maxWidth: "100%",
        }}
      >
        <h1
          style={{
            margin: 0,
            fontSize: 28,
            fontWeight: 400,
            color: VW.text,
            fontFamily: "'Instrument Serif', serif",
            lineHeight: 1.2,
          }}
        >
          Contacts / Client database
        </h1>
        <nav style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <Link
            href="/crm/contacts"
            onClick={() => {
              setActiveTab("contacts");
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
            style={{
              ...(activeTab === "contacts" ? tabActiveNav : tabInactive),
              cursor: "pointer",
            }}
          >
            Contacts
          </Link>
          <button
            type="button"
            onClick={() => setActiveTab(activeTab === "archive" ? "contacts" : "archive")}
            style={activeTab === "archive" ? tabActiveNav : tabInactive}
          >
            Archive
          </button>
          {canEdit && activeTab === "contacts" ? (
            <button
              type="button"
              onClick={() => setShowCreateModal(true)}
              style={{
                ...tabActiveNav,
                border: "none",
                cursor: "pointer",
              }}
            >
              + Create Contact
            </button>
          ) : null}
        </nav>
      </header>

      {activeTab === "contacts" && (
        <>
      {/* Toolbar */}
      <section
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 10,
          alignItems: "center",
          maxWidth: "100%",
          minWidth: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            flex: "1 1 280px",
            minWidth: 0,
            padding: "0 12px",
            borderRadius: 10,
            border: `1px solid ${VW.border}`,
            background: VW.white,
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden style={{ flexShrink: 0 }}>
            <circle cx="11" cy="11" r="7" stroke={VW.textSecondary} strokeWidth="2" />
            <path d="M21 21l-4.3-4.3" stroke={VW.textSecondary} strokeWidth="2" strokeLinecap="round" />
          </svg>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search company, contact, email, phone, Y-tunnus"
            style={{
              flex: 1,
              minWidth: 0,
              padding: "12px 0",
              border: "none",
              outline: "none",
              fontSize: 14,
              fontFamily: "'DM Sans', sans-serif",
              color: VW.text,
              background: "transparent",
            }}
          />
        </div>
        <button type="button" style={outlineBtn} onClick={() => setShowFilters((v) => !v)}>
          {showFilters ? "Hide filters" : "Show filters"}
        </button>
        <select style={{ ...filterSelectStyle, width: "auto", minWidth: 160 }} value={sortBy} onChange={(e) => setSortBy(e.target.value as SortBy)}>
          <option value="recent_added">Recently added</option>
          <option value="company_az">Company A-Z</option>
          <option value="contact_az">Contact name A-Z</option>
          <option value="contact_za">Contact name Z-A</option>
        </select>
        <div style={{ display: "inline-flex", borderRadius: 8, overflow: "hidden", border: `1px solid ${VW.border}` }}>
          <button
            type="button"
            onClick={() => setViewMode("table")}
            style={{
              padding: "10px 14px",
              border: "none",
              fontSize: 13,
              fontWeight: 600,
              fontFamily: "'DM Sans', sans-serif",
              cursor: "pointer",
              background: viewMode === "table" ? VW.petrol : VW.white,
              color: viewMode === "table" ? VW.white : VW.text,
            }}
            title="Table view"
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              Table
            </span>
          </button>
          <button
            type="button"
            onClick={() => setViewMode("card")}
            style={{
              padding: "10px 14px",
              border: "none",
              borderLeft: `1px solid ${VW.border}`,
              fontSize: 13,
              fontWeight: 600,
              fontFamily: "'DM Sans', sans-serif",
              cursor: "pointer",
              background: viewMode === "card" ? VW.petrol : VW.white,
              color: viewMode === "card" ? VW.white : VW.text,
            }}
            title="Cards view"
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                <rect x="3" y="3" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="2" />
                <rect x="14" y="3" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="2" />
                <rect x="3" y="14" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="2" />
                <rect x="14" y="14" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="2" />
              </svg>
              Cards
            </span>
          </button>
        </div>
        <div ref={importExportMenuRef} style={{ position: "relative" }}>
          <button
            type="button"
            style={{ ...outlineBtn, display: "inline-flex", alignItems: "center", gap: 6 }}
            aria-expanded={importExportMenuOpen}
            aria-haspopup="menu"
            onClick={() => setImportExportMenuOpen((o) => !o)}
          >
            Import / Export
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden style={{ flexShrink: 0 }}>
              <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          {importExportMenuOpen ? (
            <div
              role="menu"
              style={{
                position: "absolute",
                top: "100%",
                right: 0,
                marginTop: 6,
                minWidth: 220,
                background: VW.white,
                border: `1px solid ${VW.border}`,
                borderRadius: 10,
                boxShadow: "0 8px 24px rgba(0,0,0,0.1)",
                zIndex: 50,
                overflow: "hidden",
                fontFamily: "'DM Sans', sans-serif",
              }}
            >
              <Link
                href="/crm/import"
                role="menuitem"
                onClick={() => setImportExportMenuOpen(false)}
                style={{
                  display: "block",
                  padding: "12px 16px",
                  fontSize: 14,
                  fontWeight: 600,
                  color: VW.text,
                  textDecoration: "none",
                  borderBottom: `1px solid ${VW.border}`,
                }}
              >
                Import contacts
              </Link>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  exportExcel();
                  setImportExportMenuOpen(false);
                }}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "12px 16px",
                  fontSize: 14,
                  fontWeight: 600,
                  color: VW.text,
                  border: "none",
                  background: VW.white,
                  cursor: "pointer",
                  fontFamily: "'DM Sans', sans-serif",
                  borderBottom: `1px solid ${VW.border}`,
                }}
              >
                Export Excel
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  exportCsv();
                  setImportExportMenuOpen(false);
                }}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "12px 16px",
                  fontSize: 14,
                  fontWeight: 600,
                  color: VW.text,
                  border: "none",
                  background: VW.white,
                  cursor: "pointer",
                  fontFamily: "'DM Sans', sans-serif",
                }}
              >
                Export CSV
              </button>
            </div>
          ) : null}
        </div>
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
          <aside
            style={{
              ...cardStyle,
              width: 272,
              flexShrink: 0,
              height: "fit-content",
              display: "grid",
              gap: 12,
              maxWidth: "100%",
              boxSizing: "border-box",
            }}
          >
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: VW.text, fontFamily: "'DM Sans', sans-serif" }}>Filters</h3>
            <label style={{ display: "grid", gap: 6, fontSize: 12, fontWeight: 600, color: VW.textSecondary, fontFamily: "'DM Sans', sans-serif" }}>
              Status
              <select style={filterSelectStyle} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}>
                <option value="all">All</option>
                <option value="pipeline_lead">Pipeline lead</option>
                <option value="active_tenant">Active tenant</option>
                <option value="past_tenant">Past tenant</option>
              </select>
            </label>
            <label style={{ display: "grid", gap: 6, fontSize: 12, fontWeight: 600, color: VW.textSecondary, fontFamily: "'DM Sans', sans-serif" }}>
              Property
              <select style={filterSelectStyle} value={propertyFilter} onChange={(e) => setPropertyFilter(e.target.value)}>
                <option value="all">All</option>
                {properties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {formatPropertyLabel(p, { includeCity: true })}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "grid", gap: 6, fontSize: 12, fontWeight: 600, color: VW.textSecondary, fontFamily: "'DM Sans', sans-serif" }}>
              Space type
              <select style={filterSelectStyle} value={spaceTypeFilter} onChange={(e) => setSpaceTypeFilter(e.target.value)}>
                <option value="all">All</option>
                {SPACE_TYPE_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "grid", gap: 6, fontSize: 12, fontWeight: 600, color: VW.textSecondary, fontFamily: "'DM Sans', sans-serif" }}>
              Stage
              <select style={filterSelectStyle} value={stageFilter} onChange={(e) => setStageFilter(e.target.value as LeadStage | "all")}>
                <option value="all">All</option>
                {LEAD_STAGES.map((s) => (
                  <option key={s} value={s}>
                    {LEAD_STAGE_LABEL[s]}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "grid", gap: 6, fontSize: 12, fontWeight: 600, color: VW.textSecondary, fontFamily: "'DM Sans', sans-serif" }}>
              Source
              <select style={filterSelectStyle} value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}>
                <option value="all">All</option>
                {LEAD_SOURCES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "grid", gap: 6, fontSize: 12, fontWeight: 600, color: VW.textSecondary, fontFamily: "'DM Sans', sans-serif" }}>
              Company size
              <select style={filterSelectStyle} value={companySizeFilter} onChange={(e) => setCompanySizeFilter(e.target.value)}>
                <option value="all">All</option>
                {COMPANY_SIZE_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "grid", gap: 6, fontSize: 12, fontWeight: 600, color: VW.textSecondary, fontFamily: "'DM Sans', sans-serif" }}>
              Industry
              <select style={filterSelectStyle} value={industryFilter} onChange={(e) => setIndustryFilter(e.target.value)}>
                <option value="all">All</option>
                {industryFacets.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "grid", gap: 6, fontSize: 12, fontWeight: 600, color: VW.textSecondary, fontFamily: "'DM Sans', sans-serif" }}>
              Added from
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} style={filterSelectStyle} />
            </label>
            <label style={{ display: "grid", gap: 6, fontSize: 12, fontWeight: 600, color: VW.textSecondary, fontFamily: "'DM Sans', sans-serif" }}>
              Added to
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} style={filterSelectStyle} />
            </label>
          </aside>
        ) : null}

        <section style={{ flex: 1, minWidth: 0, maxWidth: "100%", overflow: "hidden", boxSizing: "border-box" }}>
          <p style={{ marginTop: 0, marginBottom: 12, color: VW.textSecondary, fontSize: 14, fontFamily: "'DM Sans', sans-serif" }}>
            {filtered.length} contact{filtered.length === 1 ? "" : "s"}
            {isSuperAdmin ? " (super admin scope)" : ""}
          </p>

          {viewMode === "table" ? (
            <div
              style={{
                background: VW.white,
                borderRadius: 12,
                border: `1px solid ${VW.border}`,
                overflow: "hidden",
              }}
            >
              <div style={{ overflowX: "auto", width: "100%", WebkitOverflowScrolling: "touch", scrollbarWidth: "thin" }}>
                <table style={{ width: "100%", minWidth: "max-content", borderCollapse: "collapse", fontSize: 13, fontFamily: "'DM Sans', sans-serif" }}>
                  <thead>
                    <tr style={{ background: "#FAFAF8" }}>
                      {["Company", "Y-tunnus", "Contact", "Email", "Phone", "Status", "Property", "Stage", "Source", "Actions"].map((h) => (
                        <th
                          key={h}
                          style={{
                            textAlign: "left",
                            borderBottom: `1px solid ${VW.border}`,
                            padding: "12px 10px",
                            color: VW.textSecondary,
                            fontSize: 12,
                            fontWeight: 600,
                            whiteSpace: "nowrap",
                          }}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((r) => (
                      <tr
                        key={r.id}
                        onClick={() => tryOpenEditForRow(r)}
                        style={{
                          cursor: r.leadId && canEdit && !r.readonly ? "pointer" : "default",
                          transition: "background 0.12s ease",
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = "#F3EDE4";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = "transparent";
                        }}
                      >
                        <td style={{ padding: "10px", borderBottom: `1px solid ${VW.border}`, color: VW.text, maxWidth: 200 }} onClick={(e) => e.stopPropagation()}>
                          <Link href={`/crm/contacts/${encodeURIComponent(r.id)}`} style={{ color: VW.petrol, fontWeight: 600 }}>
                            {r.companyName}
                          </Link>
                        </td>
                        <td style={{ padding: "10px", borderBottom: `1px solid ${VW.border}`, color: VW.text }}>{r.yTunnus ?? "—"}</td>
                        <td style={{ padding: "10px", borderBottom: `1px solid ${VW.border}` }} onClick={(e) => e.stopPropagation()}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <div
                              style={{
                                width: 32,
                                height: 32,
                                borderRadius: 999,
                                background: VW.beige,
                                color: VW.petrol,
                                display: "grid",
                                placeItems: "center",
                                fontSize: 11,
                                fontWeight: 700,
                                flexShrink: 0,
                              }}
                            >
                              {contactInitials(r.contactName)}
                            </div>
                            <span style={{ color: VW.text }}>{r.contactName}</span>
                          </div>
                        </td>
                        <td style={{ padding: "10px", borderBottom: `1px solid ${VW.border}`, color: VW.text }}>{r.email ?? "—"}</td>
                        <td style={{ padding: "10px", borderBottom: `1px solid ${VW.border}`, color: VW.text }}>{r.phone ?? "—"}</td>
                        <td style={{ padding: "10px", borderBottom: `1px solid ${VW.border}` }}>
                          <span style={badgeStyle(r.status)}>{statusLabel(r.status)}</span>
                        </td>
                        <td style={{ padding: "10px", borderBottom: `1px solid ${VW.border}`, color: VW.text }}>{r.propertyName ?? "—"}</td>
                        <td style={{ padding: "10px", borderBottom: `1px solid ${VW.border}`, color: VW.text }}>{r.stage ? LEAD_STAGE_LABEL[r.stage] : "—"}</td>
                        <td style={{ padding: "10px", borderBottom: `1px solid ${VW.border}`, color: VW.text }}>{r.source ?? "—"}</td>
                        <td style={{ padding: "10px", borderBottom: `1px solid ${VW.border}`, whiteSpace: "nowrap" }} onClick={(e) => e.stopPropagation()}>
                          <Link href={`/crm/contacts/${encodeURIComponent(r.id)}`} style={{ color: VW.petrol, fontWeight: 600, fontSize: 12 }}>
                            View
                          </Link>
                          {r.leadId && r.email && canEdit && !r.readonly ? (
                            <>
                              {" · "}
                              <button
                                type="button"
                                onClick={() => setEmailTarget(r)}
                                style={{ fontSize: 12, color: VW.petrol, fontWeight: 600, background: "none", border: "none", padding: 0, cursor: "pointer" }}
                              >
                                Send email
                              </button>
                            </>
                          ) : null}
                          {r.leadId && canEdit && !r.readonly ? (
                            <>
                              {" · "}
                              <button
                                type="button"
                                onClick={() => setEditContact(r)}
                                style={{ fontSize: 12, color: VW.petrol, fontWeight: 600, background: "none", border: "none", padding: 0, cursor: "pointer" }}
                              >
                                Edit
                              </button>
                              {r.customerCompanyId ? null : (
                                <>
                                  {" · "}
                                  <button
                                    type="button"
                                    onClick={() => openConvertToCustomer(r)}
                                    style={{ fontSize: 12, color: VW.petrol, fontWeight: 600, background: "none", border: "none", padding: 0, cursor: "pointer" }}
                                  >
                                    Convert to Customer
                                  </button>
                                </>
                              )}
                              {" · "}
                              <button
                                type="button"
                                onClick={() => setArchiveConfirm(r)}
                                style={{ fontSize: 12, color: VW.textSecondary, background: "none", border: "none", padding: 0, cursor: "pointer" }}
                              >
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
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(min(260px,100%),1fr))", gap: 12, width: "100%", minWidth: 0 }}>
              {filtered.map((r) => (
                <article
                  key={r.id}
                  onClick={() => tryOpenEditForRow(r)}
                  style={{
                    border: `1px solid ${VW.border}`,
                    borderRadius: 12,
                    padding: 14,
                    background: VW.white,
                    cursor: r.leadId && canEdit && !r.readonly ? "pointer" : "default",
                    transition: "box-shadow 0.15s ease",
                    fontFamily: "'DM Sans', sans-serif",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.boxShadow = "0 4px 14px rgba(33, 82, 79, 0.08)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.boxShadow = "none";
                  }}
                >
                  <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                    <div
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: 999,
                        background: VW.beige,
                        color: VW.petrol,
                        display: "grid",
                        placeItems: "center",
                        fontWeight: 700,
                        fontSize: 13,
                        flexShrink: 0,
                      }}
                    >
                      {contactInitials(r.contactName)}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div onClick={(e) => e.stopPropagation()}>
                        <Link href={`/crm/contacts/${encodeURIComponent(r.id)}`} style={{ fontWeight: 700, color: VW.text, fontSize: 15 }}>
                          {r.companyName}
                        </Link>
                      </div>
                      <div style={{ fontSize: 13, color: VW.text, marginTop: 2 }}>{r.contactName}</div>
                      {r.contactTitle ? <div style={{ fontSize: 11, color: VW.textSecondary }}>{r.contactTitle}</div> : null}
                    </div>
                  </div>
                  <div style={{ marginTop: 10, fontSize: 13, color: VW.text }}>{r.email ?? "—"}</div>
                  <div style={{ fontSize: 13, color: VW.text }}>{r.phone ?? "—"}</div>
                  <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                    <span style={badgeStyle(r.status)}>{statusLabel(r.status)}</span>
                    {r.propertyName ? (
                      <span
                        style={{
                          fontSize: 11,
                          padding: "3px 8px",
                          borderRadius: 6,
                          background: "#F3EDE4",
                          color: VW.textSecondary,
                          fontWeight: 600,
                        }}
                      >
                        {r.propertyName}
                      </span>
                    ) : null}
                    {r.stage ? (
                      <span
                        style={{
                          fontSize: 11,
                          padding: "3px 8px",
                          borderRadius: 6,
                          background: "#E8F5F0",
                          color: VW.petrol,
                          fontWeight: 600,
                        }}
                      >
                        {LEAD_STAGE_LABEL[r.stage]}
                      </span>
                    ) : null}
                  </div>
                  <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }} onClick={(e) => e.stopPropagation()}>
                    <Link href={`/crm/contacts/${encodeURIComponent(r.id)}`} style={{ fontSize: 12, color: VW.petrol, fontWeight: 600 }}>
                      View
                    </Link>
                    {r.leadId && r.email && canEdit && !r.readonly ? (
                      <button
                        type="button"
                        onClick={() => setEmailTarget(r)}
                        style={{ fontSize: 12, color: VW.petrol, fontWeight: 600, background: "none", border: "none", padding: 0, cursor: "pointer" }}
                      >
                        Send email
                      </button>
                    ) : null}
                    {r.leadId && canEdit && !r.readonly ? (
                      <button
                        type="button"
                        onClick={() => setEditContact(r)}
                        style={{ fontSize: 12, color: VW.petrol, fontWeight: 600, background: "none", border: "none", padding: 0, cursor: "pointer" }}
                      >
                        Edit
                      </button>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
        </>
      )}

      {activeTab === "archive" && (
        <div style={{ padding: "20px 0" }}>
          <h2
            style={{
              fontFamily: "'Instrument Serif', serif",
              fontSize: 22,
              fontWeight: 400,
              color: VW.text,
              marginBottom: 16,
            }}
          >
            Archived & Closed Leads
          </h2>
          <p style={{ fontSize: 13, color: VW.textSecondary, marginBottom: 20 }}>
            Archived leads, won deals, and lost leads. You can restore or permanently delete records here.
          </p>

          {archiveLoading ? (
            <p style={{ color: VW.textSecondary }}>Loading archived data...</p>
          ) : archivedLeads.length === 0 ? (
            <p style={{ color: VW.textSecondary }}>No archived leads found.</p>
          ) : (
            <div style={{ border: `1px solid ${VW.border}`, borderRadius: 12, overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: VW.pageBg }}>
                    <th
                      style={{
                        textAlign: "left",
                        padding: "12px 16px",
                        fontWeight: 600,
                        fontSize: 12,
                        textTransform: "uppercase",
                        letterSpacing: "0.04em",
                        borderBottom: `1px solid ${VW.border}`,
                      }}
                    >
                      Company
                    </th>
                    <th
                      style={{
                        textAlign: "left",
                        padding: "12px 16px",
                        fontWeight: 600,
                        fontSize: 12,
                        textTransform: "uppercase",
                        letterSpacing: "0.04em",
                        borderBottom: `1px solid ${VW.border}`,
                      }}
                    >
                      Contact
                    </th>
                    <th
                      style={{
                        textAlign: "left",
                        padding: "12px 16px",
                        fontWeight: 600,
                        fontSize: 12,
                        textTransform: "uppercase",
                        letterSpacing: "0.04em",
                        borderBottom: `1px solid ${VW.border}`,
                      }}
                    >
                      Email
                    </th>
                    <th
                      style={{
                        textAlign: "left",
                        padding: "12px 16px",
                        fontWeight: 600,
                        fontSize: 12,
                        textTransform: "uppercase",
                        letterSpacing: "0.04em",
                        borderBottom: `1px solid ${VW.border}`,
                      }}
                    >
                      Stage
                    </th>
                    <th
                      style={{
                        textAlign: "left",
                        padding: "12px 16px",
                        fontWeight: 600,
                        fontSize: 12,
                        textTransform: "uppercase",
                        letterSpacing: "0.04em",
                        borderBottom: `1px solid ${VW.border}`,
                      }}
                    >
                      Reason
                    </th>
                    <th
                      style={{
                        textAlign: "left",
                        padding: "12px 16px",
                        fontWeight: 600,
                        fontSize: 12,
                        textTransform: "uppercase",
                        letterSpacing: "0.04em",
                        borderBottom: `1px solid ${VW.border}`,
                      }}
                    >
                      Archived
                    </th>
                    <th
                      style={{
                        textAlign: "left",
                        padding: "12px 16px",
                        fontWeight: 600,
                        fontSize: 12,
                        textTransform: "uppercase",
                        letterSpacing: "0.04em",
                        borderBottom: `1px solid ${VW.border}`,
                      }}
                    >
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {archivedLeads.map((lead, i) => (
                    <tr key={lead.id} style={{ borderBottom: i < archivedLeads.length - 1 ? `1px solid ${VW.border}` : "none" }}>
                      <td style={{ padding: "12px 16px", fontWeight: 600 }}>{lead.companyName}</td>
                      <td style={{ padding: "12px 16px" }}>{lead.contactName}</td>
                      <td style={{ padding: "12px 16px", color: VW.textSecondary }}>{lead.email || "—"}</td>
                      <td style={{ padding: "12px 16px" }}>
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            padding: "3px 10px",
                            borderRadius: 6,
                            color: lead.stage === "won" ? "#27ae60" : lead.stage === "lost" ? "#c0392b" : VW.textSecondary,
                            background: lead.stage === "won" ? "#eafaf1" : lead.stage === "lost" ? "#fdf0ee" : VW.beige,
                          }}
                        >
                          {lead.stage === "won" ? "Won" : lead.stage === "lost" ? "Lost" : lead.stage ? LEAD_STAGE_LABEL[lead.stage] : "—"}
                        </span>
                      </td>
                      <td style={{ padding: "12px 16px", color: VW.textSecondary, fontSize: 12 }}>{lead.notes || "—"}</td>
                      <td style={{ padding: "12px 16px", color: VW.textSecondary, fontSize: 12 }}>{lead.archived ? "Yes" : "No"}</td>
                      <td style={{ padding: "12px 16px" }}>
                        <div style={{ display: "flex", gap: 8 }}>
                          {lead.leadId && canEdit && !lead.readonly ? (
                            <>
                              <button
                                type="button"
                                onClick={() => lead.leadId && void restoreLead(lead.leadId)}
                                style={{
                                  fontSize: 12,
                                  color: VW.petrol,
                                  background: "none",
                                  border: "none",
                                  cursor: "pointer",
                                  fontWeight: 600,
                                  textDecoration: "underline",
                                }}
                              >
                                Restore
                              </button>
                              <button
                                type="button"
                                onClick={() => setPermanentDeleteConfirm(lead)}
                                style={{
                                  fontSize: 12,
                                  color: "#c0392b",
                                  background: "none",
                                  border: "none",
                                  cursor: "pointer",
                                  fontWeight: 600,
                                  textDecoration: "underline",
                                }}
                              >
                                Delete forever
                              </button>
                            </>
                          ) : (
                            <span style={{ fontSize: 12, color: VW.textSecondary }}>—</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {permanentDeleteConfirm && (
            <ConfirmModal
              isOpen={true}
              title="Permanently delete lead?"
              message={`Are you sure you want to permanently delete "${permanentDeleteConfirm.companyName}"? This action cannot be undone and all associated data will be removed.`}
              confirmLabel="Delete permanently"
              variant="danger"
              onConfirm={() => {
                if (permanentDeleteConfirm.leadId) void permanentDeleteLead(permanentDeleteConfirm.leadId);
                setPermanentDeleteConfirm(null);
              }}
              onCancel={() => setPermanentDeleteConfirm(null)}
            />
          )}
        </div>
      )}

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

      <EditContactModal
        isOpen={editContact !== null && !!editContact.leadId}
        canEdit={!!editContact && !!editContact.leadId && canEdit && !editContact.readonly}
        contact={
          editContact?.leadId
            ? {
                leadId: editContact.leadId,
                companyName: editContact.companyName,
                contactName: editContact.contactName,
                email: editContact.email,
                phone: editContact.phone,
                yTunnus: editContact.yTunnus,
                companySize: editContact.companySize,
                source: editContact.source,
                notes: editContact.notes,
                stage: editContact.stage,
              }
            : null
        }
        onClose={() => setEditContact(null)}
        onSaved={() => {
          setToast("Contact updated.");
          void loadAll();
        }}
        onArchived={() => {
          setToast("Contact archived.");
          void loadAll();
        }}
        onArchive={async (leadId) => {
          await archiveLeadById(leadId);
        }}
      />

      <ConvertToCustomerModal
        lead={convertLead}
        isOpen={showConvertModal && convertLead !== null}
        onClose={() => {
          setShowConvertModal(false);
          setConvertLead(null);
        }}
        onSuccess={() => {
          setShowConvertModal(false);
          setConvertLead(null);
          setToast("Customer company created and contact linked.");
          void loadAll();
        }}
        onError={(msg) => setToast(msg)}
      />

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
