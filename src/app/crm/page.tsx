"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/browser";
import { LEAD_STAGE_LABEL, LEAD_STAGES, type LeadStage, LOST_REASONS } from "@/lib/crm";

type LeadRow = {
  id: string;
  tenant_id: string;
  property_id: string | null;
  company_name: string;
  contact_person_name: string;
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
  created_at: string;
};

type PropertyRow = { id: string; name: string | null; city: string | null };
type MembershipRow = { tenant_id: string | null; role: string | null };
type TenantUser = { id: string; email: string; display_name: string | null };
type ActivityRow = { id: string; activity_type: string; summary: string; details: string | null; occurred_at: string };
type StageHistoryRow = { id: string; from_stage: string | null; to_stage: string; notes: string | null; changed_at: string };
type RoomRow = { id: string; room_name: string | null; room_number: string | null };

type ViewMode = "kanban" | "list" | "import";

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

export default function CRMPage() {
  const supabase = useMemo(() => getSupabaseClient(), []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("kanban");
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [properties, setProperties] = useState<PropertyRow[]>([]);
  const [memberships, setMemberships] = useState<MembershipRow[]>([]);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [propertyFilter, setPropertyFilter] = useState("all");
  const [sortBy, setSortBy] = useState<"created_at" | "company_name" | "stage">("created_at");
  const [activities, setActivities] = useState<ActivityRow[]>([]);
  const [history, setHistory] = useState<StageHistoryRow[]>([]);
  const [tenantUsers, setTenantUsers] = useState<TenantUser[]>([]);
  const [roomsForLead, setRoomsForLead] = useState<RoomRow[]>([]);
  const [noteText, setNoteText] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const myRoles = useMemo(() => new Set(memberships.map((m) => (m.role ?? "").toLowerCase())), [memberships]);
  const canManage = myRoles.has("super_admin") || myRoles.has("owner") || myRoles.has("manager");

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [leadsQ, propertiesQ, membershipsQ] = await Promise.all([
      supabase.from("leads").select("*").order("created_at", { ascending: false }),
      supabase.from("properties").select("id,name,city").order("name", { ascending: true }),
      supabase.from("memberships").select("tenant_id,role"),
    ]);
    if (leadsQ.error) {
      setError(leadsQ.error.message);
      setLoading(false);
      return;
    }
    setLeads((leadsQ.data as LeadRow[]) ?? []);
    setProperties((propertiesQ.data as PropertyRow[]) ?? []);
    setMemberships((membershipsQ.data as MembershipRow[]) ?? []);
    setLoading(false);
  }, [supabase]);

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

  const selectedLead = useMemo(
    () => filteredLeads.find((l) => l.id === selectedLeadId) ?? leads.find((l) => l.id === selectedLeadId) ?? null,
    [filteredLeads, leads, selectedLeadId]
  );

  const loadLeadDetails = useCallback(
    async (leadId: string) => {
      const [actQ, histQ] = await Promise.all([
        supabase.from("lead_activities").select("id,activity_type,summary,details,occurred_at").eq("lead_id", leadId).order("occurred_at", { ascending: false }),
        supabase.from("lead_stage_history").select("id,from_stage,to_stage,notes,changed_at").eq("lead_id", leadId).order("changed_at", { ascending: false }),
      ]);
      setActivities((actQ.data as ActivityRow[]) ?? []);
      setHistory((histQ.data as StageHistoryRow[]) ?? []);
    },
    [supabase]
  );

  useEffect(() => {
    if (!selectedLeadId) return;
    loadLeadDetails(selectedLeadId);
  }, [loadLeadDetails, selectedLeadId]);

  useEffect(() => {
    const run = async () => {
      if (!selectedLead?.tenant_id) {
        setTenantUsers([]);
        return;
      }
      const resp = await fetch(`/api/bookings/tenant-users?tenantId=${encodeURIComponent(selectedLead.tenant_id)}`);
      if (!resp.ok) return;
      const data = (await resp.json()) as { users?: TenantUser[] };
      setTenantUsers(data.users ?? []);
    };
    run();
  }, [selectedLead?.tenant_id]);

  useEffect(() => {
    const run = async () => {
      if (!selectedLead?.property_id) {
        setRoomsForLead([]);
        return;
      }
      const { data } = await supabase
        .from("bookable_spaces")
        .select("id,room_name,room_number")
        .eq("property_id", selectedLead.property_id)
        .order("room_name", { ascending: true });
      setRoomsForLead((data as RoomRow[]) ?? []);
    };
    run();
  }, [selectedLead?.property_id, supabase]);

  const patchLead = useCallback(
    async (leadId: string, patch: Partial<LeadRow>) => {
      setBusyId(leadId);
      const { error: uErr } = await supabase.from("leads").update(patch).eq("id", leadId);
      setBusyId(null);
      if (uErr) {
        setError(uErr.message);
        return false;
      }
      await loadAll();
      await loadLeadDetails(leadId);
      return true;
    },
    [loadAll, loadLeadDetails, supabase]
  );

  async function onDropLead(leadId: string, toStage: LeadStage) {
    const lead = leads.find((l) => l.id === leadId);
    if (!lead || lead.stage === toStage) return;
    const stageNote = window.prompt(`Optional note for moving ${lead.company_name} to ${LEAD_STAGE_LABEL[toStage]}`, "") ?? "";
    await patchLead(leadId, {
      stage: toStage,
      stage_notes: stageNote || null,
      stage_changed_at: new Date().toISOString(),
      lost_reason: toStage === "lost" ? lead.lost_reason ?? "other" : null,
    });
  }

  async function addNoteActivity() {
    if (!selectedLead || !noteText.trim()) return;
    const { error: aErr } = await supabase.from("lead_activities").insert({
      lead_id: selectedLead.id,
      activity_type: "note_added",
      summary: "Note added",
      details: noteText.trim(),
    });
    if (aErr) {
      setError(aErr.message);
      return;
    }
    setNoteText("");
    await loadLeadDetails(selectedLead.id);
  }

  if (loading) return <p>Loading CRM...</p>;
  if (error) return <p style={{ color: "#b91c1c" }}>{error}</p>;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <section style={{ ...cardStyle, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>CRM & Sales Pipeline</h1>
        <span style={{ flex: 1 }} />
        <button onClick={() => setViewMode("kanban")} style={{ padding: "8px 10px" }}>Kanban</button>
        <button onClick={() => setViewMode("list")} style={{ padding: "8px 10px" }}>List</button>
        <button onClick={() => setViewMode("import")} style={{ padding: "8px 10px" }}>Marketing import</button>
      </section>

      <section style={{ ...cardStyle, display: "flex", gap: 10, flexWrap: "wrap" }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search company, contact, email..."
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
      </section>

      {viewMode === "kanban" ? (
        <section style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(210px, 1fr))", gap: 12, overflowX: "auto" }}>
          {LEAD_STAGES.map((stage) => (
            <div
              key={stage}
              style={{ ...cardStyle, minHeight: 380, background: "#fafafa" }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={async (e) => {
                e.preventDefault();
                const leadId = e.dataTransfer.getData("text/plain");
                if (leadId) await onDropLead(leadId, stage);
              }}
            >
              <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
                <strong>{LEAD_STAGE_LABEL[stage]}</strong>
                <span style={{ marginLeft: "auto", color: "#666", fontSize: 12 }}>{(leadsByStage.get(stage) ?? []).length}</span>
              </div>
              <div style={{ display: "grid", gap: 8 }}>
                {(leadsByStage.get(stage) ?? []).map((lead) => (
                  <div
                    key={lead.id}
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData("text/plain", lead.id)}
                    onClick={() => setSelectedLeadId(lead.id)}
                    style={{
                      border: selectedLeadId === lead.id ? "2px solid #111" : "1px solid #e2e8f0",
                      borderRadius: 10,
                      background: "#fff",
                      padding: 10,
                      cursor: "pointer",
                      opacity: busyId === lead.id ? 0.6 : 1,
                    }}
                  >
                    <div style={{ fontWeight: 600 }}>{lead.company_name}</div>
                    <div style={{ fontSize: 13, color: "#374151" }}>{lead.contact_person_name}</div>
                    <div style={{ fontSize: 12, color: "#666", marginTop: 6 }}>{lead.email}</div>
                    <div style={{ marginTop: 8, display: "flex", gap: 6, alignItems: "center" }}>
                      <span style={stageBadge(lead.stage)}>{LEAD_STAGE_LABEL[lead.stage]}</span>
                    </div>
                  </div>
                ))}
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
                  {["Company", "Contact", "Email", "Source", "Stage", "Next action"].map((h) => (
                    <th key={h} style={{ textAlign: "left", borderBottom: "1px solid #e5e7eb", padding: "8px 6px" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredLeads.map((lead) => (
                  <tr key={lead.id} onClick={() => setSelectedLeadId(lead.id)} style={{ cursor: "pointer" }}>
                    <td style={{ padding: "8px 6px", borderBottom: "1px solid #f1f5f9" }}>{lead.company_name}</td>
                    <td style={{ padding: "8px 6px", borderBottom: "1px solid #f1f5f9" }}>{lead.contact_person_name}</td>
                    <td style={{ padding: "8px 6px", borderBottom: "1px solid #f1f5f9" }}>{lead.email}</td>
                    <td style={{ padding: "8px 6px", borderBottom: "1px solid #f1f5f9" }}>{lead.source}</td>
                    <td style={{ padding: "8px 6px", borderBottom: "1px solid #f1f5f9" }}><span style={stageBadge(lead.stage)}>{LEAD_STAGE_LABEL[lead.stage]}</span></td>
                    <td style={{ padding: "8px 6px", borderBottom: "1px solid #f1f5f9" }}>{lead.next_action ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {viewMode === "import" ? <MarketingImportCard onImported={loadAll} /> : null}

      {selectedLead ? (
        <section style={{ ...cardStyle, display: "grid", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <h2 style={{ margin: 0 }}>{selectedLead.company_name}</h2>
            <span style={stageBadge(selectedLead.stage)}>{LEAD_STAGE_LABEL[selectedLead.stage]}</span>
          </div>
          <p style={{ margin: 0, color: "#374151" }}>
            {selectedLead.contact_person_name} · {selectedLead.email} {selectedLead.phone ? `· ${selectedLead.phone}` : ""}
          </p>

          <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
            <label style={{ display: "grid", gap: 4 }}>
              Stage
              <select
                value={selectedLead.stage}
                onChange={(e) => patchLead(selectedLead.id, { stage: e.target.value as LeadStage, stage_changed_at: new Date().toISOString() })}
                style={{ padding: 8 }}
              >
                {LEAD_STAGES.map((s) => (
                  <option key={s} value={s}>{LEAD_STAGE_LABEL[s]}</option>
                ))}
              </select>
            </label>
            <label style={{ display: "grid", gap: 4 }}>
              Lost reason
              <select
                value={selectedLead.lost_reason ?? ""}
                onChange={(e) => patchLead(selectedLead.id, { lost_reason: e.target.value || null })}
                style={{ padding: 8 }}
                disabled={selectedLead.stage !== "lost"}
              >
                <option value="">Select reason</option>
                {LOST_REASONS.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </label>
            <label style={{ display: "grid", gap: 4 }}>
              Next action
              <input
                value={selectedLead.next_action ?? ""}
                onChange={(e) => patchLead(selectedLead.id, { next_action: e.target.value || null })}
                style={{ padding: 8 }}
              />
            </label>
            <label style={{ display: "grid", gap: 4 }}>
              Next action date
              <input
                type="date"
                value={selectedLead.next_action_date ?? ""}
                onChange={(e) => patchLead(selectedLead.id, { next_action_date: e.target.value || null })}
                style={{ padding: 8 }}
              />
            </label>
            {canManage ? (
              <label style={{ display: "grid", gap: 4 }}>
                Assigned agent
                <select
                  value={selectedLead.assigned_agent_user_id ?? ""}
                  onChange={(e) => patchLead(selectedLead.id, { assigned_agent_user_id: e.target.value || null })}
                  style={{ padding: 8 }}
                >
                  <option value="">Unassigned</option>
                  {tenantUsers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.display_name?.trim() || u.email}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label style={{ display: "grid", gap: 4 }}>
              Won room (for auto proposal)
              <select
                value={selectedLead.won_room_id ?? ""}
                onChange={(e) => patchLead(selectedLead.id, { won_room_id: e.target.value || null })}
                style={{ padding: 8 }}
              >
                <option value="">No room selected</option>
                {roomsForLead.map((r) => (
                  <option key={r.id} value={r.id}>
                    {(r.room_name ?? "Room") + (r.room_number ? ` (${r.room_number})` : "")}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label style={{ display: "grid", gap: 4 }}>
            Stage notes
            <textarea
              rows={3}
              value={selectedLead.stage_notes ?? ""}
              onChange={(e) => patchLead(selectedLead.id, { stage_notes: e.target.value || null })}
              style={{ padding: 8 }}
            />
          </label>

          <div style={{ display: "grid", gap: 8 }}>
            <h3 style={{ margin: 0, fontSize: 16 }}>Activity timeline</h3>
            <div style={{ display: "flex", gap: 8 }}>
              <input value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="Add note..." style={{ padding: 8, flex: 1 }} />
              <button onClick={addNoteActivity} style={{ padding: "8px 12px" }}>Add note</button>
            </div>
            {activities.length === 0 ? <p style={{ margin: 0, color: "#666" }}>No activities yet.</p> : null}
            {activities.map((a) => (
              <div key={a.id} style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 8 }}>
                <div style={{ fontSize: 12, color: "#666" }}>{new Date(a.occurred_at).toLocaleString()} · {a.activity_type}</div>
                <div style={{ fontWeight: 600 }}>{a.summary}</div>
                {a.details ? <div style={{ whiteSpace: "pre-wrap" }}>{a.details}</div> : null}
              </div>
            ))}
          </div>

          <div style={{ display: "grid", gap: 8 }}>
            <h3 style={{ margin: 0, fontSize: 16 }}>Stage history</h3>
            {history.length === 0 ? <p style={{ margin: 0, color: "#666" }}>No stage changes yet.</p> : null}
            {history.map((h) => (
              <div key={h.id} style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 8 }}>
                <div style={{ fontSize: 12, color: "#666" }}>{new Date(h.changed_at).toLocaleString()}</div>
                <div>
                  {(h.from_stage ? LEAD_STAGE_LABEL[h.from_stage as LeadStage] : "Start")} {" -> "} {LEAD_STAGE_LABEL[h.to_stage as LeadStage] ?? h.to_stage}
                </div>
                {h.notes ? <div style={{ color: "#374151" }}>{h.notes}</div> : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function MarketingImportCard({ onImported }: { onImported: () => Promise<void> }) {
  const [tenantId, setTenantId] = useState("");
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [mappedRows, setMappedRows] = useState<Array<Record<string, unknown>>>([]);
  const [results, setResults] = useState<Array<{ rowNumber: number; success: boolean; error?: string }>>([]);
  const [loading, setLoading] = useState(false);

  function parseCsv(text: string): Record<string, string>[] {
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length);
    if (!lines.length) return [];
    const headers = lines[0].split(",").map((h) => h.trim());
    return lines.slice(1).map((line) => {
      const cols = line.split(",");
      const out: Record<string, string> = {};
      headers.forEach((h, i) => {
        out[h] = (cols[i] ?? "").trim();
      });
      return out;
    });
  }

  function mapRows(inputRows: Record<string, string>[]) {
    const mapped = inputRows.map((r) => ({
      company_name: r.company_name ?? r.company ?? "",
      contact_person_name: r.contact_person_name ?? r.contact_name ?? r.name ?? "",
      email: r.email ?? "",
      phone: r.phone ?? "",
      source: r.source ?? "social_media",
      interested_space_type: r.interested_space_type ?? r.space_type ?? null,
      approx_size_m2: r.approx_size_m2 ? Number(r.approx_size_m2) : null,
      approx_budget_eur_month: r.approx_budget_eur_month ? Number(r.approx_budget_eur_month) : null,
      preferred_move_in_date: r.preferred_move_in_date ?? null,
      notes: r.notes ?? null,
      property_id: r.property_id ?? null,
    }));
    setMappedRows(mapped);
  }

  async function onPickFile(file: File) {
    const text = await file.text();
    const parsed = parseCsv(text);
    setRows(parsed);
    mapRows(parsed);
  }

  async function importRows() {
    if (!tenantId.trim() || mappedRows.length === 0) return;
    setLoading(true);
    const resp = await fetch("/api/leads/marketing-import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId: tenantId.trim(), rows: mappedRows }),
    });
    const data = (await resp.json()) as { results?: Array<{ rowNumber: number; success: boolean; error?: string }> };
    setLoading(false);
    setResults(data.results ?? []);
    await onImported();
  }

  return (
    <section style={{ ...cardStyle, display: "grid", gap: 10 }}>
      <h2 style={{ margin: 0, fontSize: 18 }}>Marketing CSV import</h2>
      <label style={{ display: "grid", gap: 4 }}>
        Tenant ID (target tenant)
        <input value={tenantId} onChange={(e) => setTenantId(e.target.value)} placeholder="tenant uuid" style={{ padding: 8 }} />
      </label>
      <input
        type="file"
        accept=".csv,text/csv"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void onPickFile(file);
        }}
      />
      {rows.length ? <p style={{ margin: 0, color: "#374151" }}>Preview rows: {rows.length}</p> : null}
      {mappedRows.length ? (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["company_name", "contact_person_name", "email", "source"].map((h) => (
                  <th key={h} style={{ textAlign: "left", borderBottom: "1px solid #e5e7eb", padding: 6 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {mappedRows.slice(0, 10).map((r, idx) => (
                <tr key={idx}>
                  <td style={{ borderBottom: "1px solid #f1f5f9", padding: 6 }}>{String(r.company_name ?? "")}</td>
                  <td style={{ borderBottom: "1px solid #f1f5f9", padding: 6 }}>{String(r.contact_person_name ?? "")}</td>
                  <td style={{ borderBottom: "1px solid #f1f5f9", padding: 6 }}>{String(r.email ?? "")}</td>
                  <td style={{ borderBottom: "1px solid #f1f5f9", padding: 6 }}>{String(r.source ?? "")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <button onClick={importRows} style={{ padding: "10px 12px", width: 170 }} disabled={loading || !mappedRows.length}>
        {loading ? "Importing..." : "Import mapped rows"}
      </button>
      {results.length ? (
        <div style={{ display: "grid", gap: 4 }}>
          {results.map((r) => (
            <div key={r.rowNumber} style={{ color: r.success ? "#166534" : "#b91c1c" }}>
              Row {r.rowNumber}: {r.success ? "Success" : r.error ?? "Error"}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

