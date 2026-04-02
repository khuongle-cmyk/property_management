"use client";

import Link from "next/link";
import { useMemo, useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { getSupabaseClient } from "@/lib/supabase/browser";
import { LEAD_STAGE_LABEL, type LeadStage } from "@/lib/crm";
import { formatDate, formatDateTime } from "@/lib/date/format";
import EmailComposer from "@/components/shared/EmailComposer";

type TabKey = "overview" | "timeline" | "proposals" | "contracts" | "invoices" | "bookings" | "notes";
type LeadRow = Record<string, unknown> & {
  id: string;
  tenant_id: string;
  company_name: string;
  contact_person_name: string;
  email: string;
  phone: string | null;
  stage: LeadStage;
  notes: string | null;
};
type ProposalRow = {
  id: string;
  property_id: string;
  tenant_company_name: string;
  contact_person: string;
  status: string;
  created_at: string;
  lead_id: string | null;
};
type ContractRow = {
  id: string;
  tenant_id: string;
  property_id: string;
  status: string;
  start_date: string;
  end_date: string | null;
  monthly_rent: number;
  source_proposal_id: string | null;
  created_at: string;
};
type ActivityRow = { id: string; activity_type: string; summary: string; details: string | null; occurred_at: string };
type InvoiceRow = { id: string; billing_month: string; due_date: string; total_amount: number; status: string; paid_date: string | null };
type BookingRow = { id: string; start_at: string; end_at: string; status: string | null; visitor_name: string | null; visitor_email: string | null };
type PropertyRow = { id: string; name: string | null; city: string | null };

type EmailHistoryItem = {
  recipientId: string;
  emailAddress: string;
  recipientStatus: string | null;
  recipientSentAt: string | null;
  email: {
    id: string;
    subject: string | null;
    source: string | null;
    related_type: string | null;
    related_id: string | null;
    tenant_id: string | null;
    created_at: string | null;
    sent_at: string | null;
    status: string | null;
    from_name: string | null;
    from_email: string | null;
  } | null;
};

const tabs: Array<{ key: TabKey; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "timeline", label: "Activity timeline" },
  { key: "proposals", label: "Proposals" },
  { key: "contracts", label: "Contracts" },
  { key: "invoices", label: "Invoices" },
  { key: "bookings", label: "Bookings" },
  { key: "notes", label: "Notes" },
];

const cardStyle: React.CSSProperties = { background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 12 };

export default function ContactDetailPage() {
  const params = useParams();
  const contactId = decodeURIComponent((params.id as string) ?? "");
  const supabase = useMemo(() => getSupabaseClient(), []);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("overview");

  const [lead, setLead] = useState<LeadRow | null>(null);
  const [proposals, setProposals] = useState<ProposalRow[]>([]);
  const [contracts, setContracts] = useState<ContractRow[]>([]);
  const [activities, setActivities] = useState<ActivityRow[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [propertiesMap, setPropertiesMap] = useState<Map<string, string>>(new Map());
  const [noteText, setNoteText] = useState("");
  const [emailHistory, setEmailHistory] = useState<EmailHistoryItem[]>([]);
  const [emailHistoryLoading, setEmailHistoryLoading] = useState(false);
  const [showEmailComposer, setShowEmailComposer] = useState(false);

  const isLeadContact = contactId.startsWith("lead_");
  const leadId = isLeadContact ? contactId.slice("lead_".length) : null;
  const tenantToken = !isLeadContact && contactId.startsWith("tenant_") ? contactId.split("_")[1] : null;

  async function loadEmailHistoryForEmail(email: string | null) {
    if (!email?.trim()) {
      setEmailHistory([]);
      return;
    }
    setEmailHistoryLoading(true);
    try {
      const res = await fetch(`/api/crm/emails/history?email=${encodeURIComponent(email.trim().toLowerCase())}`, {
        credentials: "include",
      });
      const j = (await res.json()) as { items?: EmailHistoryItem[] };
      setEmailHistory(res.ok && j.items ? j.items : []);
    } finally {
      setEmailHistoryLoading(false);
    }
  }

  async function loadAll() {
    setLoading(true);
    setError(null);
    const { data: propRows } = await supabase.from("properties").select("id,name,city");
    const pMap = new Map(((propRows ?? []) as PropertyRow[]).map((p) => [p.id, `${p.name ?? "Property"}${p.city ? ` (${p.city})` : ""}`]));
    setPropertiesMap(pMap);

    if (leadId) {
      const { data: l, error: lErr } = await supabase.from("leads").select("*").eq("id", leadId).maybeSingle();
      if (lErr || !l) {
        setError(lErr?.message ?? "Contact not found");
        setLoading(false);
        return;
      }
      const leadRow = l as LeadRow;
      setLead(leadRow);

      await loadEmailHistoryForEmail(leadRow.email ?? null);

      const [propQ, ctrQ, actQ] = await Promise.all([
        supabase.from("room_proposals").select("id,property_id,tenant_company_name,contact_person,status,created_at,lead_id").eq("lead_id", leadRow.id).order("created_at", { ascending: false }),
        supabase.from("room_contracts").select("id,tenant_id,property_id,status,start_date,end_date,monthly_rent,source_proposal_id,created_at").eq("lead_id", leadRow.id).order("created_at", { ascending: false }),
        supabase.from("lead_activities").select("id,activity_type,summary,details,occurred_at").eq("lead_id", leadRow.id).order("occurred_at", { ascending: false }),
      ]);
      setProposals((propQ.data ?? []) as ProposalRow[]);
      const ctrs = (ctrQ.data ?? []) as ContractRow[];
      setContracts(ctrs);
      setActivities((actQ.data ?? []) as ActivityRow[]);

      if (ctrs.length) {
        const contractIds = ctrs.map((c) => c.id);
        const { data: inv } = await supabase
          .from("lease_invoices")
          .select("id,billing_month,due_date,total_amount,status,paid_date,contract_id")
          .in("contract_id", contractIds)
          .order("billing_month", { ascending: false });
        setInvoices((inv ?? []) as InvoiceRow[]);
      } else setInvoices([]);

      if (leadRow.email) {
        const { data: b } = await supabase
          .from("bookings")
          .select("id,start_at,end_at,status,visitor_name,visitor_email")
          .eq("visitor_email", leadRow.email.toLowerCase())
          .order("start_at", { ascending: false })
          .limit(100);
        setBookings((b ?? []) as BookingRow[]);
      } else setBookings([]);
    } else if (tenantToken) {
      const tenantId = tenantToken;
      const { data: ctrQ, error: cErr } = await supabase
        .from("room_contracts")
        .select("id,tenant_id,property_id,status,start_date,end_date,monthly_rent,source_proposal_id,created_at")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false });
      if (cErr) {
        setError(cErr.message);
        setLoading(false);
        return;
      }
      const ctrs = (ctrQ ?? []) as ContractRow[];
      setContracts(ctrs);
      const propIds = [...new Set(ctrs.map((c) => c.source_proposal_id).filter(Boolean))] as string[];
      if (propIds.length) {
        const { data: p } = await supabase
          .from("room_proposals")
          .select("id,property_id,tenant_company_name,contact_person,status,created_at,lead_id")
          .in("id", propIds);
        setProposals((p ?? []) as ProposalRow[]);
        const first = ((p ?? []) as ProposalRow[])[0];
        if (first) {
          setLead({
            id: `tenant_${tenantId}`,
            tenant_id: tenantId,
            company_name: first.tenant_company_name,
            contact_person_name: first.contact_person,
            email: "",
            phone: null,
            stage: "won",
            notes: null,
          });
        }
      } else {
        setProposals([]);
        setLead({
          id: `tenant_${tenantId}`,
          tenant_id: tenantId,
          company_name: `Organization ${tenantId.slice(0, 8)}`,
          contact_person_name: "—",
          email: "",
          phone: null,
          stage: "won",
          notes: null,
        });
      }

      if (ctrs.length) {
        const { data: inv } = await supabase
          .from("lease_invoices")
          .select("id,billing_month,due_date,total_amount,status,paid_date,contract_id")
          .in(
            "contract_id",
            ctrs.map((c) => c.id),
          )
          .order("billing_month", { ascending: false });
        setInvoices((inv ?? []) as InvoiceRow[]);
      } else setInvoices([]);
      setActivities([]);
      setBookings([]);
    } else {
      setError("Invalid contact id.");
    }
    setLoading(false);
  }

  useEffect(() => {
    void loadAll();
  }, [contactId]);

  async function addNote() {
    if (!leadId || !noteText.trim()) return;
    const { error: aErr } = await supabase.from("lead_activities").insert({
      lead_id: leadId,
      activity_type: "note_added",
      summary: "Note added",
      details: noteText.trim(),
    });
    if (aErr) {
      alert(aErr.message);
      return;
    }
    setNoteText("");
    await loadAll();
  }

  if (loading) return <p>Loading contact profile…</p>;
  if (error) return <p style={{ color: "#b91c1c" }}>{error}</p>;
  if (!lead) return <p>Not found.</p>;

  return (
    <main style={{ display: "grid", gap: 12 }}>
      <section style={{ ...cardStyle, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <Link href="/crm/contacts" style={{ color: "#2563eb" }}>← Contacts</Link>
        <h1 className="vw-admin-page-title" style={{ margin: 0 }}>{lead.company_name}</h1>
        {lead.stage ? <span style={{ fontSize: 12, padding: "2px 8px", borderRadius: 999, background: "#e2e8f0" }}>{LEAD_STAGE_LABEL[lead.stage]}</span> : null}
      </section>

      <section style={{ ...cardStyle, display: "flex", gap: 8, flexWrap: "wrap" }}>
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            style={{
              padding: "8px 10px",
              borderRadius: 8,
              border: `1px solid ${tab === t.key ? "#111" : "#ddd"}`,
              background: tab === t.key ? "#111" : "#fff",
              color: tab === t.key ? "#fff" : "#111",
            }}
          >
            {t.label}
          </button>
        ))}
      </section>

      {tab === "overview" ? (
        <section style={cardStyle}>
          <h2 style={{ marginTop: 0 }}>Company profile</h2>
          <div style={{ display: "grid", gap: 6, fontSize: 14 }}>
            <div><strong>Company:</strong> {lead.company_name}</div>
            <div><strong>Contact:</strong> {lead.contact_person_name}</div>
            <div><strong>Email:</strong> {lead.email || "—"}</div>
            <div><strong>Phone:</strong> {lead.phone || "—"}</div>
            <div><strong>Y-tunnus:</strong> {String(lead.business_id ?? "—")}</div>
            <div><strong>VAT:</strong> {String(lead.vat_number ?? "—")}</div>
            <div><strong>Billing address:</strong> {[lead.billing_street, lead.billing_postal_code, lead.billing_city].filter(Boolean).join(", ") || "—"}</div>
            <div><strong>Billing email:</strong> {String(lead.billing_email ?? "—")}</div>
            <div><strong>E-invoice address:</strong> {String(lead.e_invoice_address ?? "—")}</div>
            <div><strong>E-invoice operator:</strong> {String(lead.e_invoice_operator_code ?? "—")}</div>
          </div>
          {leadId && lead.email && lead.tenant_id ? (
            <section style={{ marginTop: 18 }}>
              <h3 style={{ marginTop: 0, fontSize: 16 }}>Email history</h3>
              {emailHistoryLoading ? (
                <p style={{ color: "#64748b", fontSize: 14 }}>Loading…</p>
              ) : emailHistory.length === 0 ? (
                <p style={{ color: "#64748b", fontSize: 14 }}>No logged emails to this address yet.</p>
              ) : (
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14 }}>
                  {emailHistory.map((h) => (
                    <li key={h.recipientId} style={{ marginBottom: 8 }}>
                      <strong>{h.email?.subject ?? "(no subject)"}</strong>
                      <span style={{ color: "#64748b" }}>
                        {" "}
                        · {h.email?.source ?? "—"}
                        {h.email?.related_type ? ` · ${h.email.related_type}` : ""}
                        {" · "}
                        {(() => {
                          const ts = h.email?.sent_at ?? h.recipientSentAt ?? h.email?.created_at;
                          return ts ? formatDateTime(ts) : "—";
                        })()}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null}

          <div style={{ marginTop: 14, display: "flex", gap: 8, flexWrap: "wrap" }}>
            {leadId && lead.email && lead.tenant_id ? (
              <button type="button" onClick={() => setShowEmailComposer(true)}>
                Send email
              </button>
            ) : (
              <button type="button" disabled title="Pipeline lead with email required">
                Send email
              </button>
            )}
            <button type="button">Log a call</button>
            <button type="button">Schedule viewing</button>
            <button type="button">Create proposal</button>
            <button type="button">Create invoice</button>
            <button type="button">Add note</button>
            <button type="button">Move pipeline stage</button>
          </div>
        </section>
      ) : null}

      {tab === "timeline" ? (
        <section style={cardStyle}>
          <h2 style={{ marginTop: 0 }}>Activity timeline</h2>
          {activities.length === 0 ? <p style={{ color: "#64748b" }}>No timeline events yet.</p> : null}
          {activities.map((a) => (
            <div key={a.id} style={{ borderBottom: "1px solid #f1f5f9", padding: "8px 0" }}>
              <div style={{ fontSize: 12, color: "#64748b" }}>{formatDateTime(a.occurred_at)}</div>
              <div style={{ fontWeight: 600 }}>{a.summary}</div>
              {a.details ? <div style={{ whiteSpace: "pre-wrap" }}>{a.details}</div> : null}
            </div>
          ))}
        </section>
      ) : null}

      {tab === "proposals" ? (
        <section style={cardStyle}>
          <h2 style={{ marginTop: 0 }}>Proposals</h2>
          {proposals.length === 0 ? <p style={{ color: "#64748b" }}>No proposals.</p> : null}
          {proposals.map((p) => (
            <div key={p.id} style={{ borderBottom: "1px solid #f1f5f9", padding: "8px 0" }}>
              <div style={{ fontWeight: 600 }}>{p.tenant_company_name}</div>
              <div style={{ fontSize: 13 }}>
                {p.status} · {propertiesMap.get(p.property_id) ?? p.property_id} · {formatDate(p.created_at)}
              </div>
            </div>
          ))}
        </section>
      ) : null}

      {tab === "contracts" ? (
        <section style={cardStyle}>
          <h2 style={{ marginTop: 0 }}>Contracts</h2>
          {contracts.length === 0 ? <p style={{ color: "#64748b" }}>No contracts.</p> : null}
          {contracts.map((c) => (
            <div key={c.id} style={{ borderBottom: "1px solid #f1f5f9", padding: "8px 0" }}>
              <div style={{ fontWeight: 600 }}>{c.status}</div>
              <div style={{ fontSize: 13 }}>
                {propertiesMap.get(c.property_id) ?? c.property_id} · €{c.monthly_rent}/mo · {c.start_date} → {c.end_date ?? "open"}
              </div>
            </div>
          ))}
        </section>
      ) : null}

      {tab === "invoices" ? (
        <section style={cardStyle}>
          <h2 style={{ marginTop: 0 }}>Invoices</h2>
          {invoices.length === 0 ? <p style={{ color: "#64748b" }}>No invoices.</p> : null}
          {invoices.map((i) => (
            <div key={i.id} style={{ borderBottom: "1px solid #f1f5f9", padding: "8px 0" }}>
              <div style={{ fontWeight: 600 }}>€{i.total_amount}</div>
              <div style={{ fontSize: 13 }}>{i.status} · due {i.due_date} · month {i.billing_month}</div>
            </div>
          ))}
        </section>
      ) : null}

      {tab === "bookings" ? (
        <section style={cardStyle}>
          <h2 style={{ marginTop: 0 }}>Bookings</h2>
          {bookings.length === 0 ? <p style={{ color: "#64748b" }}>No linked bookings found.</p> : null}
          {bookings.map((b) => (
            <div key={b.id} style={{ borderBottom: "1px solid #f1f5f9", padding: "8px 0" }}>
              <div style={{ fontWeight: 600 }}>{b.status ?? "—"}</div>
              <div style={{ fontSize: 13 }}>{formatDateTime(b.start_at)} → {formatDateTime(b.end_at)}</div>
            </div>
          ))}
        </section>
      ) : null}

      {tab === "notes" ? (
        <section style={cardStyle}>
          <h2 style={{ marginTop: 0 }}>Notes</h2>
          {leadId ? (
            <>
              <div style={{ display: "flex", gap: 8 }}>
                <input value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="Add new note" style={{ flex: 1, padding: 8 }} />
                <button type="button" onClick={() => void addNote()}>Add note</button>
              </div>
              <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                {activities.filter((a) => a.activity_type === "note_added").map((a) => (
                  <div key={a.id} style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 8 }}>
                    <div style={{ fontSize: 12, color: "#64748b" }}>{formatDateTime(a.occurred_at)}</div>
                    <div>{a.details ?? a.summary}</div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p style={{ color: "#64748b" }}>Notes are available for pipeline leads.</p>
          )}
        </section>
      ) : null}

      {showEmailComposer && leadId && lead.tenant_id && lead.email ? (
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
          onClick={() => setShowEmailComposer(false)}
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
            <p style={{ marginTop: 0, fontSize: 13, color: "#64748b" }}>{lead.company_name}</p>
            <EmailComposer
              source="crm"
              mode="single"
              tenantId={String(lead.tenant_id)}
              leadId={leadId}
              relatedType="lead"
              defaultTo={lead.email}
              onCancel={() => setShowEmailComposer(false)}
              onSent={() => {
                setShowEmailComposer(false);
                void loadEmailHistoryForEmail(lead.email ?? null);
              }}
            />
          </div>
        </div>
      ) : null}
    </main>
  );
}
