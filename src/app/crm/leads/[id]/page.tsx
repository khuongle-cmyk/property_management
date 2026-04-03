"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { LEAD_STAGE_LABEL, LEAD_STAGES, type LeadStage, LOST_REASONS } from "@/lib/crm";
import { sumProposalMonthlyRent } from "@/lib/crm/proposal-items";
import { getSupabaseClient } from "@/lib/supabase/browser";
import { LeadFormModal } from "@/components/crm/LeadFormModal";
import OfferEditor from "@/components/OfferEditor";
import { ytunnusFormatWarning, vatFiFormatWarning } from "@/lib/crm/finnish-company";
import { formatDateTime } from "@/lib/date/format";

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
  stage_notes: string | null;
  stage_changed_at: string;
  next_action: string | null;
  next_action_date: string | null;
  lost_reason: string | null;
  won_room_id: string | null;
  won_proposal_id: string | null;
  won_client_tenant_id: string | null;
  archived: boolean;
  created_at: string;
};

type ProposalItemRow = {
  id: string;
  space_id: string;
  proposed_monthly_rent: number | null;
  proposed_hourly_rate: number | null;
  notes: string | null;
  bookable_spaces?: { room_name: string | null; room_number: string | null } | null;
};

type ProposalRow = {
  id: string;
  property_id: string;
  lead_id: string | null;
  tenant_company_name: string;
  contact_person: string;
  proposed_start_date: string;
  lease_length_months: number | null;
  special_conditions: string | null;
  valid_until: string;
  status: string;
  created_at: string;
  room_proposal_items?: ProposalItemRow[];
};

type ContractItemRow = {
  space_id: string;
  monthly_rent: number;
  hourly_rate: number | null;
  notes: string | null;
  bookable_spaces?: { room_name: string | null; room_number: string | null } | null;
};

type ContractRow = {
  id: string;
  room_id: string | null;
  source_proposal_id: string | null;
  negotiation_version: number;
  contract_terms: string | null;
  status: string;
  monthly_rent: number;
  start_date: string;
  end_date: string | null;
  room_contract_items?: ContractItemRow[];
};

type ActivityRow = { id: string; activity_type: string; summary: string; details: string | null; occurred_at: string };
type StageHistoryRow = { id: string; from_stage: string | null; to_stage: string; notes: string | null; changed_at: string };
type CrmPropertyRow = { id: string; name: string | null; city: string | null };

type LeadOfferRow = { id: string; status: string | null };

function spaceLabel(
  row: { room_name: string | null; room_number: string | null } | null | undefined,
  fallbackId: string
): string {
  if (!row) return fallbackId;
  return `${row.room_name ?? "Room"}${row.room_number ? ` (${row.room_number})` : ""}`;
}

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
    offer: "#b45309",
    contract: "#be123c",
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

function LeadDetailPageInner() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const leadId = params.id as string;
  const supabase = useMemo(() => getSupabaseClient(), []);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lead, setLead] = useState<LeadRow | null>(null);
  const [proposals, setProposals] = useState<ProposalRow[]>([]);
  const [contracts, setContracts] = useState<ContractRow[]>([]);
  const [leadOffers, setLeadOffers] = useState<LeadOfferRow[]>([]);
  const [activities, setActivities] = useState<ActivityRow[]>([]);
  const [history, setHistory] = useState<StageHistoryRow[]>([]);
  const [memberships, setMemberships] = useState<{ role: string | null }[]>([]);
  const [crmProperties, setCrmProperties] = useState<CrmPropertyRow[]>([]);
  const [editLeadOpen, setEditLeadOpen] = useState(false);
  const [noteText, setNoteText] = useState("");

  const [offerOpen, setOfferOpen] = useState(false);
  const [wonOpen, setWonOpen] = useState(false);
  const [lostOpen, setLostOpen] = useState(false);

  const [authUserId, setAuthUserId] = useState<string | null>(null);

  const myRoles = useMemo(() => new Set(memberships.map((m) => (m.role ?? "").toLowerCase())), [memberships]);
  const canManage = myRoles.has("super_admin") || myRoles.has("owner") || myRoles.has("manager");

  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => setAuthUserId(data.user?.id ?? null));
  }, [supabase]);

  const loadLead = useCallback(async () => {
    if (!leadId) return;
    setLoading(true);
    setError(null);

    const { data: leadRow, error: lErr } = await supabase.from("leads").select("*").eq("id", leadId).maybeSingle();
    if (lErr || !leadRow) {
      setError(lErr?.message ?? "Lead not found");
      setLoading(false);
      return;
    }
    setLead(leadRow as LeadRow);

    const { data: m } = await supabase.from("memberships").select("role");
    setMemberships((m as { role: string | null }[]) ?? []);

    const { data: propList } = await supabase.from("properties").select("id,name,city").order("name", { ascending: true });
    setCrmProperties((propList as CrmPropertyRow[]) ?? []);

    let props: ProposalRow[] | null = null;
    const propsQ = await supabase
      .from("room_proposals")
      .select(
        "*, room_proposal_items(id, space_id, proposed_monthly_rent, proposed_hourly_rate, notes, bookable_spaces(room_name, room_number))"
      )
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false });
    if (propsQ.error) {
      const simple = await supabase.from("room_proposals").select("*").eq("lead_id", leadId).order("created_at", { ascending: false });
      props = (simple.data as ProposalRow[]) ?? [];
    } else {
      props = (propsQ.data as ProposalRow[]) ?? [];
    }
    setProposals(props ?? []);

    const { data: offerRows } = await supabase
      .from("offers")
      .select("id,status")
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false });
    setLeadOffers((offerRows as LeadOfferRow[]) ?? []);

    const ctrsQ = await supabase
      .from("room_contracts")
      .select(
        "id, room_id, source_proposal_id, negotiation_version, contract_terms, status, monthly_rent, start_date, end_date, room_contract_items(space_id, monthly_rent, hourly_rate, notes, bookable_spaces(room_name, room_number))"
      )
      .eq("lead_id", leadId)
      .order("negotiation_version", { ascending: false });
    const ctrs = ctrsQ.error
      ? (
          await supabase
            .from("room_contracts")
            .select("id, room_id, source_proposal_id, negotiation_version, contract_terms, status, monthly_rent, start_date, end_date")
            .eq("lead_id", leadId)
            .order("negotiation_version", { ascending: false })
        ).data
      : ctrsQ.data;
    setContracts((ctrs as ContractRow[]) ?? []);

    const [actQ, histQ] = await Promise.all([
      supabase.from("lead_activities").select("*").eq("lead_id", leadId).order("occurred_at", { ascending: false }),
      supabase.from("lead_stage_history").select("*").eq("lead_id", leadId).order("changed_at", { ascending: false }),
    ]);
    setActivities((actQ.data as ActivityRow[]) ?? []);
    setHistory((histQ.data as StageHistoryRow[]) ?? []);

    setLoading(false);
  }, [leadId, supabase]);

  useEffect(() => {
    loadLead();
  }, [loadLead]);

  useEffect(() => {
    const focus = searchParams.get("focus");
    if (focus === "offer") setOfferOpen(true);
    if (focus === "won") setWonOpen(true);
    if (focus === "lost") setLostOpen(true);
  }, [searchParams]);

  async function patchLead(patch: Partial<LeadRow>) {
    if (!lead) return;
    const { error: uErr } = await supabase.from("leads").update(patch).eq("id", lead.id);
    if (uErr) {
      setError(uErr.message);
      return;
    }
    await loadLead();
  }

  async function onStageSelect(next: LeadStage) {
    if (!lead || next === lead.stage) return;
    if (next === "offer") {
      setOfferOpen(true);
      return;
    }
    if (next === "contract") {
      await enterNegotiation();
      return;
    }
    if (next === "won") {
      setWonOpen(true);
      return;
    }
    if (next === "lost") {
      setLostOpen(true);
      return;
    }
    await patchLead({ stage: next, stage_changed_at: new Date().toISOString() });
  }

  async function finalizeOfferStage() {
    if (!lead) return;
    const hasRoomProposals = proposals.some((p) => ["draft", "sent", "negotiating"].includes(p.status));
    const hasContractOffers = leadOffers.some((o) => {
      const s = (o.status ?? "").toLowerCase();
      return s.length > 0 && !["declined", "expired"].includes(s);
    });
    if (!hasRoomProposals && !hasContractOffers) {
      setError("Save at least one contract offer (above) or add a legacy room proposal before Offer.");
      return;
    }
    setError(null);
    await patchLead({ stage: "offer" });
    setOfferOpen(false);
    router.replace(`/crm/leads/${lead.id}`);
  }

  async function enterNegotiation() {
    if (!lead) return;
    const res = await fetch("/api/crm/leads/negotiation-drafts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leadId: lead.id }),
    });
    const j = (await res.json()) as { error?: string };
    if (!res.ok) {
      setError(j.error ?? "Could not start negotiation");
      return;
    }
    await loadLead();
  }

  async function completeWon(proposalId: string) {
    if (!lead) return;
    setError(null);
    const res = await fetch("/api/crm/leads/won", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leadId: lead.id, proposalId }),
    });
    const j = (await res.json()) as { error?: string };
    if (!res.ok) {
      setError(j.error ?? "Could not complete Won");
      return;
    }
    setWonOpen(false);
    await loadLead();
  }

  async function completeLost(reason: string) {
    if (!lead) return;
    setError(null);
    const res = await fetch("/api/crm/leads/lost", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leadId: lead.id, lostReason: reason }),
    });
    const j = (await res.json()) as { error?: string };
    if (!res.ok) {
      setError(j.error ?? "Could not archive lead");
      return;
    }
    setLostOpen(false);
    await loadLead();
  }

  async function saveContractTerms(contractId: string, terms: string) {
    const res = await fetch(`/api/crm/contracts/${contractId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contractTerms: terms }),
    });
    const j = (await res.json()) as { error?: string };
    if (!res.ok) setError(j.error ?? "Could not save contract terms");
    else await loadLead();
  }

  async function newContractVersion(proposalId: string) {
    const res = await fetch("/api/crm/contracts/version", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceProposalId: proposalId }),
    });
    const j = (await res.json()) as { error?: string };
    if (!res.ok) setError(j.error ?? "Could not create version");
    else await loadLead();
  }

  async function addNote() {
    if (!lead || !noteText.trim()) return;
    const { error: aErr } = await supabase.from("lead_activities").insert({
      lead_id: lead.id,
      activity_type: "note_added",
      summary: "Note added",
      details: noteText.trim(),
    });
    if (aErr) setError(aErr.message);
    else {
      setNoteText("");
      await loadLead();
    }
  }

  if (loading) return <p>Loading…</p>;
  if (error && !lead) return <p style={{ color: "#b91c1c" }}>{error}</p>;
  if (!lead) return <p>Lead not found.</p>;

  const openProposals = proposals.filter((p) => ["draft", "sent", "negotiating"].includes(p.status));
  const wonCandidates = proposals.filter((p) => ["draft", "sent", "negotiating"].includes(p.status));

  const canEditCustomer =
    canManage || (myRoles.has("agent") && lead.assigned_agent_user_id === authUserId);

  const businessIdWarning = lead.business_id ? ytunnusFormatWarning(lead.business_id) : null;
  const vatWarnDetail = lead.vat_number ? vatFiFormatWarning(lead.vat_number) : null;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <Link href="/crm" style={{ color: "#2563eb" }}>← Pipeline</Link>
        <h1 className="vw-admin-page-title" style={{ margin: 0 }}>{lead.company_name}</h1>
        <span style={stageBadge(lead.stage)}>{LEAD_STAGE_LABEL[lead.stage]}</span>
        {lead.archived ? <span style={{ fontSize: 13, color: "#64748b" }}>Archived</span> : null}
        {canEditCustomer ? (
          <button type="button" onClick={() => setEditLeadOpen(true)} style={{ padding: "8px 14px", marginLeft: "auto" }}>
            Edit customer
          </button>
        ) : null}
      </div>

      {error ? <p style={{ color: "#b91c1c", margin: 0 }}>{error}</p> : null}

      {searchParams.get("focus") === "contract" ? (
        <p style={{ margin: 0, padding: 12, background: "#eff6ff", borderRadius: 8, fontSize: 14 }}>
          You moved this lead to <strong>Contract</strong>. Use &quot;Start negotiation&quot; to create versioned contract drafts from your proposals.
        </p>
      ) : null}

      <section style={cardStyle}>
        <h2 style={{ margin: "0 0 10px", fontSize: 16 }}>Company & registration</h2>
        <div style={{ display: "grid", gap: 8, fontSize: 14 }}>
          {lead.business_id ? (
            <div>
              <span style={{ color: "#64748b" }}>Y-tunnus · </span>
              <strong>{lead.business_id}</strong>
              {businessIdWarning ? (
                <span style={{ color: "#b45309", marginLeft: 8 }}>{businessIdWarning}</span>
              ) : null}
            </div>
          ) : (
            <p style={{ margin: 0, color: "#64748b", fontSize: 13 }}>No Y-tunnus on file — add before invoicing.</p>
          )}
          {lead.vat_number ? (
            <div>
              <span style={{ color: "#64748b" }}>VAT (ALV) · </span>
              {lead.vat_number}
              {vatWarnDetail ? (
                <span style={{ color: "#b45309", marginLeft: 8, fontSize: 13 }}>{vatWarnDetail}</span>
              ) : null}
            </div>
          ) : null}
          {lead.company_type ? (
            <div>
              <span style={{ color: "#64748b" }}>Company type · </span>
              {lead.company_type}
            </div>
          ) : null}
          {lead.industry_sector ? (
            <div>
              <span style={{ color: "#64748b" }}>Industry · </span>
              {lead.industry_sector}
            </div>
          ) : null}
          {lead.company_size ? (
            <div>
              <span style={{ color: "#64748b" }}>Company size · </span>
              {lead.company_size} employees
            </div>
          ) : null}
          {lead.company_website ? (
            <div>
              <span style={{ color: "#64748b" }}>Website · </span>
              <a href={lead.company_website.startsWith("http") ? lead.company_website : `https://${lead.company_website}`} target="_blank" rel="noreferrer">
                {lead.company_website}
              </a>
            </div>
          ) : null}
          {lead.billing_street || lead.billing_postal_code || lead.billing_city ? (
            <div>
              <span style={{ color: "#64748b" }}>Billing address · </span>
              {[lead.billing_street, [lead.billing_postal_code, lead.billing_city].filter(Boolean).join(" ")].filter(Boolean).join(", ")}
            </div>
          ) : null}
          {lead.billing_email ? (
            <div>
              <span style={{ color: "#64748b" }}>Billing email · </span>
              {lead.billing_email}
            </div>
          ) : null}
          {lead.e_invoice_address || lead.e_invoice_operator_code ? (
            <div style={{ padding: 10, background: "#f0fdf4", borderRadius: 8, border: "1px solid #bbf7d0" }}>
              <strong style={{ display: "block", marginBottom: 6 }}>E-invoice (Finvoice)</strong>
              {lead.e_invoice_address ? (
                <div>
                  <span style={{ color: "#64748b" }}>Verkkolaskuosoite · </span>
                  {lead.e_invoice_address}
                </div>
              ) : null}
              {lead.e_invoice_operator_code ? (
                <div>
                  <span style={{ color: "#64748b" }}>Operator code · </span>
                  {lead.e_invoice_operator_code}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>

      <section style={cardStyle}>
        <h2 style={{ margin: "0 0 10px", fontSize: 16 }}>Contact person</h2>
        <p style={{ margin: "0 0 8px", color: "#374151" }}>
          {[lead.contact_first_name, lead.contact_last_name].filter(Boolean).join(" ").trim() || lead.contact_person_name}
          {lead.contact_title ? ` · ${lead.contact_title}` : ""}
        </p>
        <p style={{ margin: "0 0 8px", fontSize: 14 }}>
          <span style={{ color: "#64748b" }}>Email · </span>
          {lead.email}
        </p>
        {lead.phone ? (
          <p style={{ margin: "0 0 8px", fontSize: 14 }}>
            <span style={{ color: "#64748b" }}>Phone · </span>
            {lead.phone}
          </p>
        ) : null}
        {lead.contact_direct_phone ? (
          <p style={{ margin: "0 0 8px", fontSize: 14 }}>
            <span style={{ color: "#64748b" }}>Direct · </span>
            {lead.contact_direct_phone}
          </p>
        ) : null}
        <p style={{ margin: 0, fontSize: 14, color: "#64748b" }}>Source: {lead.source}</p>
      </section>

      {canManage && !lead.archived ? (
        <section style={{ ...cardStyle, display: "grid", gap: 10 }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>Pipeline actions</h2>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <button type="button" onClick={() => setOfferOpen(true)} style={{ padding: "8px 12px" }}>
              Add proposals / Offer
            </button>
            <button
              type="button"
              onClick={() => void enterNegotiation()}
              disabled={lead.stage === "contract" || !openProposals.length}
              style={{ padding: "8px 12px" }}
            >
              Start negotiation (contract drafts)
            </button>
            <button type="button" onClick={() => setWonOpen(true)} style={{ padding: "8px 12px" }}>
              Mark Won…
            </button>
            <button type="button" onClick={() => setLostOpen(true)} style={{ padding: "8px 12px" }}>
              Mark Lost…
            </button>
          </div>
          <label style={{ display: "grid", gap: 4, maxWidth: 360 }}>
            Stage
            <select
              value={lead.stage}
              onChange={(e) => void onStageSelect(e.target.value as LeadStage)}
              style={{ padding: 8 }}
            >
              {LEAD_STAGES.map((s) => (
                <option key={s} value={s}>{LEAD_STAGE_LABEL[s]}</option>
              ))}
            </select>
          </label>
        </section>
      ) : null}

      <section style={cardStyle}>
        <h2 style={{ margin: "0 0 10px", fontSize: 16 }}>Room proposals ({proposals.length})</h2>
        {!lead.property_id ? (
          <p style={{ color: "#64748b", margin: 0 }}>Link a property to this lead to pick rooms for proposals.</p>
        ) : null}
        {proposals.length === 0 ? <p style={{ margin: 0, color: "#64748b" }}>No proposals yet.</p> : null}
        <div style={{ display: "grid", gap: 8 }}>
          {proposals.map((p) => {
            const items = p.room_proposal_items ?? [];
            const totalMo = sumProposalMonthlyRent(items);
            return (
              <div key={p.id} style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 10 }}>
                <div style={{ fontWeight: 600 }}>Proposal {p.id.slice(0, 8)}…</div>
                <div style={{ fontSize: 13, marginTop: 4 }}>
                  Status: <strong>{p.status}</strong> · Total recurring: €{totalMo}/mo · Start {p.proposed_start_date}
                  {p.lease_length_months != null ? ` · ${p.lease_length_months} mo lease` : ""}
                </div>
                <div style={{ fontSize: 13 }}>Valid until {p.valid_until}</div>
                {items.length === 0 ? (
                  <p style={{ fontSize: 13, color: "#b45309", margin: "8px 0 0" }}>
                    No rooms on this proposal (apply the multi-room SQL migration if this looks wrong).
                  </p>
                ) : (
                  <ul style={{ fontSize: 13, margin: "8px 0 0", paddingLeft: 18 }}>
                    {items.map((it) => (
                      <li key={it.id} style={{ marginBottom: 4 }}>
                        <strong>{spaceLabel(it.bookable_spaces, it.space_id)}</strong>
                        {it.proposed_monthly_rent != null ? ` · €${it.proposed_monthly_rent}/mo` : ""}
                        {it.proposed_hourly_rate != null ? ` · €${it.proposed_hourly_rate}/h` : ""}
                        {it.notes ? <span> — {it.notes}</span> : null}
                      </li>
                    ))}
                  </ul>
                )}
                {p.special_conditions ? (
                  <div style={{ fontSize: 13, marginTop: 6, whiteSpace: "pre-wrap" }}>Conditions: {p.special_conditions}</div>
                ) : null}
                <button type="button" disabled style={{ marginTop: 8, padding: "6px 10px", opacity: 0.6 }}>
                  Generate proposal PDF (coming soon)
                </button>
              </div>
            );
          })}
        </div>
      </section>

      {contracts.length > 0 ? (
        <section style={cardStyle}>
          <h2 style={{ margin: "0 0 10px", fontSize: 16 }}>Contract drafts</h2>
          <p style={{ margin: "0 0 10px", fontSize: 13, color: "#64748b" }}>
            Spaces stay <strong>available</strong> until you mark the lead Won — then every space on the chosen proposal becomes{" "}
            <strong>reserved</strong>.
          </p>
          {contracts.map((c) => (
            <div key={c.id} style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 10, marginBottom: 8 }}>
              <div style={{ fontSize: 13 }}>
                v{c.negotiation_version} · {c.status} · €{c.monthly_rent}/mo base · {c.start_date}
                {c.source_proposal_id ? ` · proposal ${c.source_proposal_id.slice(0, 8)}…` : ""}
              </div>
              {c.room_contract_items?.length ? (
                <ul style={{ fontSize: 12, margin: "8px 0 0", paddingLeft: 18, color: "#374151" }}>
                  {c.room_contract_items.map((it) => (
                    <li key={it.space_id} style={{ marginBottom: 2 }}>
                      {spaceLabel(it.bookable_spaces, it.space_id)}
                      {it.monthly_rent ? ` · €${it.monthly_rent}/mo` : ""}
                      {it.hourly_rate != null ? ` · €${it.hourly_rate}/h` : ""}
                    </li>
                  ))}
                </ul>
              ) : null}
              {c.status === "draft" && canManage ? (
                <>
                  <textarea
                    defaultValue={c.contract_terms ?? ""}
                    id={`terms-${c.id}`}
                    rows={4}
                    style={{ width: "100%", marginTop: 8, padding: 8, fontFamily: "inherit" }}
                  />
                  <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                    <button
                      type="button"
                      style={{ padding: "6px 10px" }}
                      onClick={() => {
                        const el = document.getElementById(`terms-${c.id}`) as HTMLTextAreaElement | null;
                        void saveContractTerms(c.id, el?.value ?? "");
                      }}
                    >
                      Save terms
                    </button>
                    {c.source_proposal_id ? (
                      <button type="button" style={{ padding: "6px 10px" }} onClick={() => void newContractVersion(c.source_proposal_id!)}>
                        New version from proposal
                      </button>
                    ) : null}
                  </div>
                </>
              ) : (
                <pre style={{ fontSize: 12, marginTop: 8, whiteSpace: "pre-wrap" }}>{c.contract_terms ?? "—"}</pre>
              )}
            </div>
          ))}
        </section>
      ) : null}

      <section style={cardStyle}>
        <h3 style={{ margin: "0 0 8px", fontSize: 16 }}>Activity</h3>
        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          <input value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="Note…" style={{ padding: 8, flex: 1 }} />
          <button type="button" onClick={() => void addNote()} style={{ padding: "8px 12px" }}>Add</button>
        </div>
        {activities.map((a) => (
          <div key={a.id} style={{ borderBottom: "1px solid #f1f5f9", padding: "8px 0", fontSize: 14 }}>
            <span style={{ color: "#64748b" }}>{formatDateTime(a.occurred_at)}</span> · {a.summary}
            {a.details ? <div style={{ whiteSpace: "pre-wrap" }}>{a.details}</div> : null}
          </div>
        ))}
      </section>

      <section style={cardStyle}>
        <h3 style={{ margin: "0 0 8px", fontSize: 16 }}>Stage history</h3>
        {history.map((h) => (
          <div key={h.id} style={{ fontSize: 14, padding: "6px 0" }}>
            {formatDateTime(h.changed_at)}: {h.from_stage ?? "start"} → {h.to_stage}
            {h.notes ? ` — ${h.notes}` : ""}
          </div>
        ))}
      </section>

      {offerOpen ? (
        <div style={modalOverlay}>
          <div style={modalBoxOffer}>
            <h3 style={{ marginTop: 0 }}>Contract offer</h3>
            <p style={{ fontSize: 14, color: "#64748b", marginBottom: 12 }}>
              Use the same offer editor as the contract tool. Save your draft or mark as sent, then click below to move this lead to{" "}
              <strong>Offer</strong>.
            </p>
            <OfferEditor
              leadId={lead.id}
              offerId={leadOffers[0]?.id ?? null}
              initialData={{
                companyId: lead.id,
                customerName: lead.contact_person_name ?? "",
                customerEmail: lead.email,
                customerPhone: lead.phone ?? lead.contact_direct_phone ?? "",
                customerCompany: lead.company_name,
                propertyId: lead.property_id,
              }}
              onSaved={() => {
                void loadLead();
              }}
              onCancel={() => {
                setOfferOpen(false);
                router.replace(`/crm/leads/${lead.id}`);
              }}
            />
            <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end", borderTop: "1px solid #e5e7eb", paddingTop: 16 }}>
              <button type="button" onClick={() => void finalizeOfferStage()} style={{ padding: "8px 14px", fontWeight: 600 }}>
                Done — set stage to Offer
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {wonOpen ? (
        <div style={modalOverlay}>
          <div style={modalBox}>
            <h3 style={{ marginTop: 0 }}>Mark Won — choose accepted proposal</h3>
            <p style={{ fontSize: 14, color: "#64748b" }}>
              Every space on the winning proposal becomes <strong>reserved</strong>. Other open proposals are rejected; their spaces (if reserved) go back
              to available. One contract is activated with all rooms and prices.
            </p>
            {wonCandidates.length === 0 ? <p>No open proposals.</p> : null}
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {wonCandidates.map((p) => {
                const items = p.room_proposal_items ?? [];
                const totalMo = sumProposalMonthlyRent(items);
                return (
                  <li key={p.id} style={{ marginBottom: 8 }}>
                    <button
                      type="button"
                      style={{ padding: "10px 12px", width: "100%", textAlign: "left" }}
                      onClick={() => void completeWon(p.id)}
                    >
                      <div style={{ fontWeight: 600 }}>
                        {items.length} space(s) · ~€{totalMo}/mo recurring · {p.status}
                      </div>
                      <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>
                        {items.map((it) => (
                          <span key={it.id} style={{ display: "block" }}>
                            {spaceLabel(it.bookable_spaces, it.space_id)}
                            {it.proposed_monthly_rent != null ? ` · €${it.proposed_monthly_rent}/mo` : ""}
                            {it.proposed_hourly_rate != null ? ` · €${it.proposed_hourly_rate}/h` : ""}
                          </span>
                        ))}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
            <button type="button" onClick={() => setWonOpen(false)} style={{ marginTop: 12 }}>Cancel</button>
          </div>
        </div>
      ) : null}

      {lostOpen ? (
        <div style={modalOverlay}>
          <div style={modalBox}>
            <h3 style={{ marginTop: 0 }}>Mark Lost</h3>
            <p style={{ fontSize: 14 }}>Proposals will be closed and any reserved rooms from this deal released to available.</p>
            <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
              {LOST_REASONS.map((r) => (
                <button key={r} type="button" style={{ padding: 10, textAlign: "left" }} onClick={() => void completeLost(r)}>
                  {r}
                </button>
              ))}
            </div>
            <button type="button" onClick={() => setLostOpen(false)} style={{ marginTop: 12 }}>Cancel</button>
          </div>
        </div>
      ) : null}

      <LeadFormModal
        open={editLeadOpen}
        mode="edit"
        leadId={lead.id}
        tenantId={lead.tenant_id}
        properties={crmProperties}
        initial={{
          company_name: lead.company_name,
          contact_person_name: lead.contact_person_name,
          contact_first_name: lead.contact_first_name,
          contact_last_name: lead.contact_last_name,
          contact_title: lead.contact_title,
          contact_direct_phone: lead.contact_direct_phone,
          email: lead.email,
          phone: lead.phone,
          source: lead.source,
          property_id: lead.property_id,
          interested_space_type: lead.interested_space_type,
          approx_size_m2: lead.approx_size_m2,
          approx_budget_eur_month: lead.approx_budget_eur_month,
          preferred_move_in_date: lead.preferred_move_in_date
            ? lead.preferred_move_in_date.slice(0, 10)
            : null,
          notes: lead.notes,
          business_id: lead.business_id,
          vat_number: lead.vat_number,
          company_type: lead.company_type,
          industry_sector: lead.industry_sector,
          company_size: lead.company_size,
          company_website: lead.company_website,
          billing_street: lead.billing_street,
          billing_postal_code: lead.billing_postal_code,
          billing_city: lead.billing_city,
          billing_email: lead.billing_email,
          e_invoice_address: lead.e_invoice_address,
          e_invoice_operator_code: lead.e_invoice_operator_code,
        }}
        onClose={() => setEditLeadOpen(false)}
        onSaved={loadLead}
      />
    </div>
  );
}

export default function LeadDetailPage() {
  return (
    <Suspense fallback={<p>Loading…</p>}>
      <LeadDetailPageInner />
    </Suspense>
  );
}

const modalOverlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.45)",
  zIndex: 100,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
};

const modalBox: React.CSSProperties = {
  background: "#fff",
  borderRadius: 12,
  padding: 20,
  maxWidth: 640,
  width: "100%",
  maxHeight: "90vh",
  overflow: "auto",
};

const modalBoxOffer: React.CSSProperties = {
  ...modalBox,
  maxWidth: 960,
};
