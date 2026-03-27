"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/browser";
import { LEAD_STAGE_LABEL, LEAD_STAGES, type LeadStage } from "@/lib/crm";
import { CustomerImportModal } from "@/components/crm/CustomerImportModal";
import { LeadFormModal } from "@/components/crm/LeadFormModal";

type LeadRow = {
  id: string;
  tenant_id: string;
  pipeline_owner: string;
  property_id: string | null;
  company_name: string;
  contact_person_name: string;
  business_id?: string | null;
  vat_number?: string | null;
  company_type?: string | null;
  industry_sector?: string | null;
  company_size?: string | null;
  company_website?: string | null;
  billing_street?: string | null;
  billing_postal_code?: string | null;
  billing_city?: string | null;
  billing_email?: string | null;
  e_invoice_address?: string | null;
  e_invoice_operator_code?: string | null;
  contact_first_name?: string | null;
  contact_last_name?: string | null;
  contact_title?: string | null;
  contact_direct_phone?: string | null;
  email: string;
  phone: string | null;
  source: string;
  interested_space_type: string | null;
  approx_size_m2: number | null;
  approx_budget_eur_month: number | null;
  preferred_move_in_date: string | null;
  notes: string | null;
  assigned_agent_user_id: string | null;
  stage: LeadStage;
  archived?: boolean;
  created_at: string;
};

type PropertyRow = { id: string; name: string | null; city: string | null };
type MembershipRow = { tenant_id: string | null; role: string | null };

type ViewMode = "kanban" | "list";

const cardStyle: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #e6e6e6",
  borderRadius: 12,
  padding: 12,
};

function stageBadge(stage: LeadStage): React.CSSProperties {
  const colors: Record<LeadStage, string> = {
    new: "#1d4ed8",
    contacted: "#7c3aed",
    viewing: "#0f766e",
    offer_sent: "#b45309",
    negotiation: "#be123c",
    won: "#15803d",
    lost: "#475569",
  };
  return {
    display: "inline-block",
    borderRadius: 999,
    padding: "2px 8px",
    fontSize: 12,
    color: "#fff",
    background: colors[stage],
  };
}

function countOpenProposals(rows: { lead_id: string | null; status: string }[] | null, leadId: string): number {
  return (rows ?? []).filter(
    (r) => r.lead_id === leadId && ["draft", "sent", "negotiating"].includes(r.status)
  ).length;
}

export default function CRMPage() {
  const router = useRouter();
  const supabase = useMemo(() => getSupabaseClient(), []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("kanban");
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [properties, setProperties] = useState<PropertyRow[]>([]);
  const [memberships, setMemberships] = useState<MembershipRow[]>([]);
  const [proposalIndex, setProposalIndex] = useState<{ lead_id: string | null; status: string }[]>([]);
  const [search, setSearch] = useState("");
  const [propertyFilter, setPropertyFilter] = useState("all");
  const [sortBy, setSortBy] = useState<"created_at" | "company_name" | "stage">("created_at");
  const [showArchived, setShowArchived] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [addLeadOpen, setAddLeadOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editingLead, setEditingLead] = useState<LeadRow | null>(null);

  const primaryTenantId = useMemo(() => {
    const prefer = memberships.filter(
      (m) => m.tenant_id && ["super_admin", "owner", "manager"].includes((m.role ?? "").toLowerCase())
    );
    return prefer[0]?.tenant_id ?? memberships.find((m) => m.tenant_id)?.tenant_id ?? null;
  }, [memberships]);

  const myRoles = useMemo(() => new Set(memberships.map((m) => (m.role ?? "").toLowerCase())), [memberships]);
  const canManageLeads =
    myRoles.has("super_admin") || myRoles.has("owner") || myRoles.has("manager") || myRoles.has("agent");

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    let leadsQuery = supabase.from("leads").select("*").order("created_at", { ascending: false });
    if (!showArchived) {
      leadsQuery = leadsQuery.or("archived.eq.false,archived.is.null");
    }
    const [leadsQ, propertiesQ, membershipsQ] = await Promise.all([
      leadsQuery,
      supabase.from("properties").select("id,name,city").order("name", { ascending: true }),
      supabase.from("memberships").select("tenant_id,role"),
    ]);
    if (leadsQ.error) {
      setError(leadsQ.error.message);
      setLoading(false);
      return;
    }
    const leadRows = (leadsQ.data as LeadRow[]) ?? [];
    setLeads(leadRows);
    setProperties((propertiesQ.data as PropertyRow[]) ?? []);
    setMemberships((membershipsQ.data as MembershipRow[]) ?? []);

    const ids = leadRows.map((l) => l.id);
    if (ids.length) {
      const { data: propRows } = await supabase.from("room_proposals").select("lead_id,status").in("lead_id", ids);
      setProposalIndex((propRows as { lead_id: string | null; status: string }[]) ?? []);
    } else {
      setProposalIndex([]);
    }
    setLoading(false);
  }, [supabase, showArchived]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const filteredLeads = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = [...leads];
    if (propertyFilter !== "all") rows = rows.filter((l) => l.property_id === propertyFilter);
    if (q) {
      rows = rows.filter((l) =>
        [l.company_name, l.contact_person_name, l.email, l.phone ?? "", l.source].join(" ").toLowerCase().includes(q)
      );
    }
    rows.sort((a, b) => {
      if (sortBy === "company_name") return a.company_name.localeCompare(b.company_name);
      if (sortBy === "stage") return LEAD_STAGES.indexOf(a.stage) - LEAD_STAGES.indexOf(b.stage);
      return +new Date(b.created_at) - +new Date(a.created_at);
    });
    return rows;
  }, [leads, propertyFilter, search, sortBy]);

  const leadsByStage = useMemo(() => {
    const m = new Map<LeadStage, LeadRow[]>();
    for (const s of LEAD_STAGES) m.set(s, []);
    for (const row of filteredLeads) m.get(row.stage)?.push(row);
    return m;
  }, [filteredLeads]);

  const patchLead = useCallback(
    async (leadId: string, patch: Record<string, unknown>) => {
      setBusyId(leadId);
      const { error: uErr } = await supabase.from("leads").update(patch).eq("id", leadId);
      setBusyId(null);
      if (uErr) {
        setError(uErr.message);
        return false;
      }
      await loadAll();
      return true;
    },
    [loadAll, supabase]
  );

  async function onDropLead(leadId: string, toStage: LeadStage) {
    const lead = leads.find((l) => l.id === leadId);
    if (!lead || lead.stage === toStage) return;

    if (toStage === "negotiation") {
      setBusyId(leadId);
      const res = await fetch("/api/crm/leads/negotiation-drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId }),
      });
      const j = (await res.json()) as { error?: string };
      setBusyId(null);
      if (!res.ok) {
        setError(j.error ?? "Could not start negotiation");
        router.push(`/crm/leads/${leadId}?focus=negotiation`);
        return;
      }
      await loadAll();
      router.push(`/crm/leads/${leadId}`);
      return;
    }

    if (["offer_sent", "won", "lost"].includes(toStage)) {
      const focus = toStage === "offer_sent" ? "offer" : toStage === "won" ? "won" : "lost";
      router.push(`/crm/leads/${leadId}?focus=${focus}`);
      return;
    }

    const stageNote = window.prompt(`Optional note for moving ${lead.company_name} to ${LEAD_STAGE_LABEL[toStage]}`, "") ?? "";
    await patchLead(leadId, {
      stage: toStage,
      stage_notes: stageNote || null,
      stage_changed_at: new Date().toISOString(),
    });
  }

  if (loading) return <p>Loading CRM...</p>;
  if (error) return <p style={{ color: "#b91c1c" }}>{error}</p>;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <section style={{ ...cardStyle, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>CRM & Sales Pipeline</h1>
        <span style={{ flex: 1 }} />
        <Link href="/crm" style={{ fontWeight: 700 }}>
          CRM Pipeline
        </Link>
        <Link href="/crm/contacts">Contacts</Link>
        <Link href="/crm/import">Import contacts</Link>
        {canManageLeads ? (
          <>
            <button
              type="button"
              onClick={() => setAddLeadOpen(true)}
              disabled={!primaryTenantId}
              style={{
                padding: "10px 16px",
                fontWeight: 700,
                background: primaryTenantId ? "#15803d" : "#94a3b8",
                color: "#fff",
                border: "none",
                borderRadius: 10,
                cursor: primaryTenantId ? "pointer" : "not-allowed",
              }}
            >
              + Add lead
            </button>
            <button
              type="button"
              onClick={() => setImportOpen(true)}
              disabled={!primaryTenantId}
              style={{
                padding: "10px 16px",
                fontWeight: 600,
                background: primaryTenantId ? "#1d4ed8" : "#94a3b8",
                color: "#fff",
                border: "none",
                borderRadius: 10,
                cursor: primaryTenantId ? "pointer" : "not-allowed",
              }}
            >
              Import customers
            </button>
          </>
        ) : null}
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14 }}>
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          Show archived (lost)
        </label>
        <button type="button" onClick={() => setViewMode("kanban")} style={{ padding: "8px 10px" }}>
          Kanban
        </button>
        <button type="button" onClick={() => setViewMode("list")} style={{ padding: "8px 10px" }}>
          List
        </button>
      </section>

      {!primaryTenantId && canManageLeads ? (
        <p style={{ margin: 0, fontSize: 14, color: "#b45309" }}>
          Add lead / import requires a membership with an organization. Ask an admin to add you to a tenant.
        </p>
      ) : null}

      <section style={{ ...cardStyle, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search company, contact name, email, phone…"
          style={{ padding: 8, minWidth: 280 }}
        />
        <select value={propertyFilter} onChange={(e) => setPropertyFilter(e.target.value)} style={{ padding: 8 }}>
          <option value="all">All properties</option>
          {properties.map((p) => (
            <option key={p.id} value={p.id}>
              {(p.name ?? "Unnamed property") + (p.city ? ` (${p.city})` : "")}
            </option>
          ))}
        </select>
        <select value={sortBy} onChange={(e) => setSortBy(e.target.value as "created_at" | "company_name" | "stage")} style={{ padding: 8 }}>
          <option value="created_at">Sort: newest</option>
          <option value="company_name">Sort: company</option>
          <option value="stage">Sort: pipeline stage</option>
        </select>
        <span style={{ fontSize: 13, color: "#64748b" }}>
          Search applies to both Kanban and List. Drag to Offer / Negotiation / Won / Lost opens the lead detail to complete the step.
        </span>
      </section>

      {viewMode === "kanban" ? (
        <section style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(210px, 1fr))", gap: 12, overflowX: "auto" }}>
          {LEAD_STAGES.map((stage) => (
            <div
              key={stage}
              style={{ ...cardStyle, minHeight: 380, background: "#fafafa" }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const leadId = e.dataTransfer.getData("text/plain");
                if (leadId) void onDropLead(leadId, stage);
              }}
            >
              <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
                <strong>{LEAD_STAGE_LABEL[stage]}</strong>
                <span style={{ marginLeft: "auto", color: "#666", fontSize: 12 }}>{(leadsByStage.get(stage) ?? []).length}</span>
              </div>
              <div style={{ display: "grid", gap: 8 }}>
                {(leadsByStage.get(stage) ?? []).map((lead) => {
                  const n = countOpenProposals(proposalIndex, lead.id);
                  return (
                    <div
                      key={lead.id}
                      draggable
                      onDragStart={(e) => e.dataTransfer.setData("text/plain", lead.id)}
                      style={{
                        border: "1px solid #e2e8f0",
                        borderRadius: 10,
                        background: "#fff",
                        padding: 10,
                        cursor: "grab",
                        opacity: busyId === lead.id ? 0.6 : 1,
                      }}
                    >
                      <Link
                        href={`/crm/leads/${lead.id}`}
                        onClick={(e) => e.stopPropagation()}
                        style={{ color: "#111", textDecoration: "none", fontWeight: 600 }}
                      >
                        {lead.company_name}
                      </Link>
                      <div style={{ fontSize: 13, color: "#374151" }}>{lead.contact_person_name}</div>
                      <div style={{ fontSize: 12, color: "#666", marginTop: 6 }}>{lead.email}</div>
                      {lead.phone ? <div style={{ fontSize: 12, color: "#666" }}>{lead.phone}</div> : null}
                      <div style={{ marginTop: 8, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                        <span style={stageBadge(lead.stage)}>{LEAD_STAGE_LABEL[lead.stage]}</span>
                        {n > 0 ? (
                          <span
                            style={{
                              fontSize: 11,
                              padding: "2px 8px",
                              borderRadius: 999,
                              background: "#e0f2fe",
                              color: "#0369a1",
                            }}
                          >
                            {n} proposal{n === 1 ? "" : "s"}
                          </span>
                        ) : null}
                        {canManageLeads ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setEditingLead(lead);
                            }}
                            style={{
                              marginLeft: "auto",
                              fontSize: 12,
                              padding: "4px 8px",
                              borderRadius: 6,
                              border: "1px solid #cbd5e1",
                              background: "#fff",
                              cursor: "pointer",
                            }}
                          >
                            Edit
                          </button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </section>
      ) : null}

      {viewMode === "list" ? (
        <section style={cardStyle}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["Company", "Contact", "Email", "Phone", "Proposals", "Stage", "Actions"].map((h) => (
                    <th key={h} style={{ textAlign: "left", borderBottom: "1px solid #e5e7eb", padding: "8px 6px" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredLeads.map((lead) => {
                  const n = countOpenProposals(proposalIndex, lead.id);
                  return (
                    <tr key={lead.id}>
                      <td style={{ padding: "8px 6px", borderBottom: "1px solid #f1f5f9" }}>{lead.company_name}</td>
                      <td style={{ padding: "8px 6px", borderBottom: "1px solid #f1f5f9" }}>{lead.contact_person_name}</td>
                      <td style={{ padding: "8px 6px", borderBottom: "1px solid #f1f5f9" }}>{lead.email}</td>
                      <td style={{ padding: "8px 6px", borderBottom: "1px solid #f1f5f9" }}>{lead.phone ?? "—"}</td>
                      <td style={{ padding: "8px 6px", borderBottom: "1px solid #f1f5f9" }}>{n}</td>
                      <td style={{ padding: "8px 6px", borderBottom: "1px solid #f1f5f9" }}>
                        <span style={stageBadge(lead.stage)}>{LEAD_STAGE_LABEL[lead.stage]}</span>
                      </td>
                      <td style={{ padding: "8px 6px", borderBottom: "1px solid #f1f5f9" }}>
                        <Link href={`/crm/leads/${lead.id}`} style={{ marginRight: 10 }}>
                          Open
                        </Link>
                        {canManageLeads ? (
                          <button type="button" onClick={() => setEditingLead(lead)} style={{ fontSize: 13 }}>
                            Edit
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {primaryTenantId ? (
        <LeadFormModal
          open={addLeadOpen}
          mode="create"
          tenantId={primaryTenantId}
          properties={properties}
          onClose={() => setAddLeadOpen(false)}
          onSaved={loadAll}
        />
      ) : null}

      {editingLead ? (
        <LeadFormModal
          open={!!editingLead}
          mode="edit"
          leadId={editingLead.id}
          tenantId={editingLead.tenant_id}
          properties={properties}
          initial={{
            company_name: editingLead.company_name,
            contact_person_name: editingLead.contact_person_name,
            contact_first_name: editingLead.contact_first_name,
            contact_last_name: editingLead.contact_last_name,
            contact_title: editingLead.contact_title,
            contact_direct_phone: editingLead.contact_direct_phone,
            email: editingLead.email,
            phone: editingLead.phone,
            source: editingLead.source,
            property_id: editingLead.property_id,
            interested_space_type: editingLead.interested_space_type,
            approx_size_m2: editingLead.approx_size_m2,
            approx_budget_eur_month: editingLead.approx_budget_eur_month,
            preferred_move_in_date: editingLead.preferred_move_in_date,
            notes: editingLead.notes,
            business_id: editingLead.business_id,
            vat_number: editingLead.vat_number,
            company_type: editingLead.company_type,
            industry_sector: editingLead.industry_sector,
            company_size: editingLead.company_size,
            company_website: editingLead.company_website,
            billing_street: editingLead.billing_street,
            billing_postal_code: editingLead.billing_postal_code,
            billing_city: editingLead.billing_city,
            billing_email: editingLead.billing_email,
            e_invoice_address: editingLead.e_invoice_address,
            e_invoice_operator_code: editingLead.e_invoice_operator_code,
          }}
          onClose={() => setEditingLead(null)}
          onSaved={loadAll}
        />
      ) : null}

      <CustomerImportModal
        open={importOpen}
        tenantId={primaryTenantId}
        onClose={() => setImportOpen(false)}
        onImported={loadAll}
      />
    </div>
  );
}
