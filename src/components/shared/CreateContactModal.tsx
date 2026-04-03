"use client";

import { useEffect, useMemo, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/browser";
import type { LeadStage } from "@/lib/crm";
import { normalizeLeadSource, normalizeSpaceType } from "@/lib/crm/lead-import-parse";
import { formatPropertyLabel } from "@/lib/properties/label";
import type { CrmLeadSearchRow } from "@/components/shared/ContactSearchWithCreate";

export type CreateContactPropertyRow = {
  id: string;
  name: string | null;
  city: string | null;
  tenant_id: string;
};

export type CreateContactAssignableUser = {
  id: string;
  display_name: string | null;
  email: string | null;
};

export type CreateContactModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (lead: CrmLeadSearchRow) => void;
  initialCompanyName?: string;
  properties: CreateContactPropertyRow[];
  defaultTenantId?: string;
  assignableUsers?: CreateContactAssignableUser[];
};

const PETROL = "#0D4F4F";

const CONTACT_CREATE_STATUSES = ["Lead", "Pipeline lead", "Active", "Inactive", "Lost"] as const;
const CONTACT_CREATE_STAGE_LABELS = ["New", "Viewing", "Proposal", "Negotiation", "Contacted", "Won", "Lost"] as const;
const SPACE_TYPE_OPTIONS = ["Office", "Meeting room", "Venue", "Coworking", "Virtual Office"] as const;
const SOURCE_OPTIONS = ["Website", "Chatbot", "Referral", "Cold call", "Email campaign", "Walk-in", "Other"] as const;
const COMPANY_SIZE_OPTIONS = ["1-5", "6-10", "11-25", "26-50", "51-100", "100+"] as const;

const LEAD_SELECT =
  "id,company_name,email,phone,contact_person_name,contact_first_name,contact_last_name,contact_direct_phone";

function mapUiStageToLeadStage(label: string): LeadStage {
  const m: Record<string, LeadStage> = {
    New: "new",
    Viewing: "viewing",
    Proposal: "offer",
    Negotiation: "contract",
    Contacted: "contacted",
    Won: "won",
    Lost: "lost",
  };
  return m[label] ?? "new";
}

function mapUiSourceToDbSource(ui: string): string {
  const raw: Record<string, string> = {
    Website: "website",
    Chatbot: "chatbot",
    Referral: "referral",
    "Cold call": "phone",
    "Email campaign": "email",
    "Walk-in": "other",
    Other: "other",
  };
  return normalizeLeadSource(raw[ui] ?? "other");
}

function mapUiSpaceTypeToDb(ui: string): string | null {
  if (ui === "Virtual Office") return null;
  const raw: Record<string, string> = {
    Office: "office",
    "Meeting room": "meeting_room",
    Venue: "venue",
    Coworking: "coworking",
  };
  const key = raw[ui];
  if (!key) return null;
  const n = normalizeSpaceType(key === "coworking" ? "hot_desk" : key);
  return n;
}

const defaultCreateForm = () => ({
  companyName: "",
  businessId: "",
  contactPerson: "",
  email: "",
  phone: "",
  contactStatus: "Lead" as (typeof CONTACT_CREATE_STATUSES)[number],
  stageUi: "New" as (typeof CONTACT_CREATE_STAGE_LABELS)[number],
  propertyId: "",
  spaceType: "Office" as (typeof SPACE_TYPE_OPTIONS)[number],
  source: "Website" as (typeof SOURCE_OPTIONS)[number],
  companySize: "1-5" as (typeof COMPANY_SIZE_OPTIONS)[number],
  industry: "",
  notes: "",
  assignedAgentUserId: "",
});

const modalInput: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid #e5e7eb",
  fontSize: 14,
  boxSizing: "border-box",
};
const modalLabel: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: "#334155", display: "block", marginBottom: 6 };

export default function CreateContactModal({
  isOpen,
  onClose,
  onCreated,
  initialCompanyName = "",
  properties,
  defaultTenantId = "",
  assignableUsers: assignableUsersProp,
}: CreateContactModalProps) {
  const supabase = useMemo(() => getSupabaseClient(), []);
  const [createForm, setCreateForm] = useState(defaultCreateForm);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedAssignable, setLoadedAssignable] = useState<CreateContactAssignableUser[]>([]);

  const assignableUsers = assignableUsersProp ?? loadedAssignable;

  useEffect(() => {
    if (!isOpen) return;
    setCreateForm(() => ({
      ...defaultCreateForm(),
      companyName: initialCompanyName.trim(),
    }));
    setError(null);
  }, [isOpen, initialCompanyName]);

  useEffect(() => {
    if (!isOpen || assignableUsersProp !== undefined) return;
    const tenantIds = [...new Set(properties.map((p) => p.tenant_id).filter(Boolean))];
    if (!tenantIds.length) {
      setLoadedAssignable([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data: roleMems } = await supabase
        .from("memberships")
        .select("user_id")
        .in("tenant_id", tenantIds)
        .in("role", ["owner", "manager", "agent", "super_admin"]);
      const assignIds = [...new Set((roleMems ?? []).map((m) => m.user_id).filter(Boolean))] as string[];
      if (!assignIds.length) {
        if (!cancelled) setLoadedAssignable([]);
        return;
      }
      const { data: urows } = await supabase
        .from("users")
        .select("id, display_name, email")
        .in("id", assignIds)
        .order("display_name", { ascending: true });
      if (!cancelled) setLoadedAssignable((urows ?? []) as CreateContactAssignableUser[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, assignableUsersProp, properties, supabase]);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const company = createForm.companyName.trim();
    const contact = createForm.contactPerson.trim();
    const email = createForm.email.trim().toLowerCase();
    if (!company || !contact || !email) {
      setError("Company name, contact person, and email are required.");
      return;
    }

    setSubmitting(true);
    setError(null);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setError("You must be signed in.");
      setSubmitting(false);
      return;
    }

    const prop = createForm.propertyId ? properties.find((p) => p.id === createForm.propertyId) : undefined;
    const tenant_id = prop?.tenant_id ?? defaultTenantId;
    if (!tenant_id) {
      setError("Select a property, or ensure your account is linked to an organization.");
      setSubmitting(false);
      return;
    }

    let stage: LeadStage = mapUiStageToLeadStage(createForm.stageUi);
    const archived = createForm.contactStatus === "Inactive";
    if (createForm.contactStatus === "Lost") {
      stage = "lost";
    }

    const payload = {
      tenant_id,
      pipeline_owner: tenant_id,
      company_name: company,
      business_id: createForm.businessId.trim() || null,
      contact_person_name: contact,
      email,
      phone: createForm.phone.trim() || null,
      stage,
      archived,
      property_id: createForm.propertyId || null,
      interested_space_type: mapUiSpaceTypeToDb(createForm.spaceType),
      source: mapUiSourceToDbSource(createForm.source),
      company_size: createForm.companySize || null,
      industry_sector: createForm.industry.trim() || null,
      notes: createForm.notes.trim() || null,
      assigned_agent_user_id: createForm.assignedAgentUserId || null,
      created_by_user_id: user.id,
    };

    const { data: inserted, error: insErr } = await supabase.from("leads").insert(payload).select(LEAD_SELECT).single();
    if (insErr) {
      setError(insErr.message);
      setSubmitting(false);
      return;
    }

    onCreated(inserted as CrmLeadSearchRow);
    onClose();
    setCreateForm(defaultCreateForm());
    setSubmitting(false);
  }

  if (!isOpen) return null;

  return (
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
      onClick={() => {
        if (!submitting) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-contact-title"
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
        <h2 id="create-contact-title" style={{ margin: "0 0 16px", fontSize: 20, fontWeight: 700, color: "#0f172a" }}>
          Create Contact
        </h2>
        <p style={{ margin: "0 0 16px", fontSize: 13, color: "#64748b", lineHeight: 1.45 }}>
          New records are saved to the CRM pipeline (<code style={{ fontSize: 12 }}>leads</code>).
        </p>
        <form onSubmit={(e) => void submit(e)} style={{ display: "grid", gap: 14 }}>
          <label style={modalLabel}>
            Company name *
            <input
              required
              value={createForm.companyName}
              onChange={(e) => setCreateForm((f) => ({ ...f, companyName: e.target.value }))}
              style={modalInput}
            />
          </label>
          <label style={modalLabel}>
            Y-tunnus
            <input
              type="text"
              value={createForm.businessId}
              onChange={(e) => setCreateForm((f) => ({ ...f, businessId: e.target.value }))}
              placeholder="e.g. 1234567-8"
              style={modalInput}
            />
          </label>
          <label style={modalLabel}>
            Contact person *
            <input
              required
              value={createForm.contactPerson}
              onChange={(e) => setCreateForm((f) => ({ ...f, contactPerson: e.target.value }))}
              style={modalInput}
            />
          </label>
          <label style={modalLabel}>
            Email *
            <input
              required
              type="email"
              value={createForm.email}
              onChange={(e) => setCreateForm((f) => ({ ...f, email: e.target.value }))}
              style={modalInput}
            />
          </label>
          <label style={modalLabel}>
            Phone
            <input
              value={createForm.phone}
              onChange={(e) => setCreateForm((f) => ({ ...f, phone: e.target.value }))}
              style={modalInput}
            />
          </label>
          <label style={modalLabel}>
            Status
            <select
              value={createForm.contactStatus}
              onChange={(e) =>
                setCreateForm((f) => ({ ...f, contactStatus: e.target.value as (typeof CONTACT_CREATE_STATUSES)[number] }))
              }
              style={modalInput}
            >
              {CONTACT_CREATE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label style={modalLabel}>
            Stage
            <select
              value={createForm.stageUi}
              onChange={(e) =>
                setCreateForm((f) => ({ ...f, stageUi: e.target.value as (typeof CONTACT_CREATE_STAGE_LABELS)[number] }))
              }
              style={modalInput}
            >
              {CONTACT_CREATE_STAGE_LABELS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label style={modalLabel}>
            Property
            <select
              value={createForm.propertyId}
              onChange={(e) => setCreateForm((f) => ({ ...f, propertyId: e.target.value }))}
              style={modalInput}
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
              value={createForm.spaceType}
              onChange={(e) => setCreateForm((f) => ({ ...f, spaceType: e.target.value as (typeof SPACE_TYPE_OPTIONS)[number] }))}
              style={modalInput}
            >
              {SPACE_TYPE_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label style={modalLabel}>
            Source
            <select
              value={createForm.source}
              onChange={(e) => setCreateForm((f) => ({ ...f, source: e.target.value as (typeof SOURCE_OPTIONS)[number] }))}
              style={modalInput}
            >
              {SOURCE_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label style={modalLabel}>
            Company size
            <select
              value={createForm.companySize}
              onChange={(e) =>
                setCreateForm((f) => ({ ...f, companySize: e.target.value as (typeof COMPANY_SIZE_OPTIONS)[number] }))
              }
              style={modalInput}
            >
              {COMPANY_SIZE_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label style={modalLabel}>
            Industry
            <input
              value={createForm.industry}
              onChange={(e) => setCreateForm((f) => ({ ...f, industry: e.target.value }))}
              style={modalInput}
            />
          </label>
          <label style={modalLabel}>
            Notes
            <textarea
              value={createForm.notes}
              onChange={(e) => setCreateForm((f) => ({ ...f, notes: e.target.value }))}
              rows={4}
              style={{ ...modalInput, resize: "vertical", fontFamily: "inherit" }}
            />
          </label>
          <label style={modalLabel}>
            Assigned agent
            <select
              value={createForm.assignedAgentUserId}
              onChange={(e) => setCreateForm((f) => ({ ...f, assignedAgentUserId: e.target.value }))}
              style={modalInput}
            >
              <option value="">— None —</option>
              {assignableUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.display_name ?? u.email ?? u.id.slice(0, 8)}
                </option>
              ))}
            </select>
          </label>

          {error ? <p style={{ margin: 0, fontSize: 13, color: "#b91c1c" }}>{error}</p> : null}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              disabled={submitting}
              onClick={() => onClose()}
              style={{
                padding: "10px 18px",
                borderRadius: 8,
                border: "1px solid #e5e7eb",
                background: "#fff",
                color: "#334155",
                fontWeight: 600,
                cursor: submitting ? "not-allowed" : "pointer",
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              style={{
                padding: "10px 18px",
                borderRadius: 8,
                border: "none",
                background: PETROL,
                color: "#fff",
                fontWeight: 600,
                cursor: submitting ? "not-allowed" : "pointer",
                opacity: submitting ? 0.7 : 1,
              }}
            >
              {submitting ? "Saving…" : "Create contact"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
