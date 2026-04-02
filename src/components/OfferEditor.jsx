"use client";

/**
 * OfferEditor — Contract tool offers (CRM contact = public.leads; same as CRM module)
 *
 *   <OfferEditor />
 *   <OfferEditor leadId="uuid" initialData={{ ... }} onOfferAccepted={() => {}} />
 */

import { useState, useEffect, useCallback, useMemo, Fragment } from "react";
import { getSupabaseClient } from "@/lib/supabase/browser";
import { VILLAGEWORKS_BRAND } from "@/lib/brand/villageworks";
import { useConfirm } from "@/hooks/useConfirm";
import ContactSearchWithCreate from "@/components/shared/ContactSearchWithCreate";
import CreateContactModal from "@/components/shared/CreateContactModal";

const c = VILLAGEWORKS_BRAND.colors;

const DEFAULT_INTRO = `Thank you for your interest in VillageWorks. We are pleased to present this offer for your consideration.

VillageWorks offers flexible, fully-serviced office spaces designed to support your business as it grows. Our spaces include high-speed internet, meeting room access, reception services, and a thriving community of like-minded professionals.`;

const DEFAULT_TERMS = `1. This offer is valid for 30 days from the date of issue.
2. The monthly price is exclusive of VAT (24%).
3. A security deposit of one month's rent is required upon signing.
4. The notice period is one calendar month unless otherwise agreed.
5. All prices are subject to annual indexation in line with the Finnish CPI.`;

const OFFER_STATUS_COLORS = {
  draft: { bg: c.hover, fg: c.text },
  sent: { bg: c.border, fg: c.primary },
  viewed: { bg: c.hover, fg: c.secondary },
  accepted: { bg: c.hover, fg: c.success },
  declined: { bg: c.hover, fg: c.danger },
  expired: { bg: c.border, fg: c.text },
};

const NON_DRAFT_STATUSES = ["sent", "viewed", "accepted", "declined", "expired"];

const OFFER_STEPS = [
  { key: "details", label: "Fill details" },
  { key: "content", label: "Write content" },
  { key: "preview", label: "Preview & send" },
];

const LIGHT_GREEN = "#dcfce7";

function Field({ label, children, hint }) {
  const muted = { fontSize: 12, fontWeight: 600, color: c.text, opacity: 0.65, textTransform: "uppercase", letterSpacing: "0.05em" };
  return (
    <div style={{ display: "grid", gap: 4 }}>
      <label style={muted}>{label}</label>
      {children}
      {hint && <span style={{ fontSize: 11, color: c.text, opacity: 0.55 }}>{hint}</span>}
    </div>
  );
}

function Input({ value, onChange, placeholder, type = "text", style, ...rest }) {
  return (
    <input
      type={type}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={{ ...inputStyleBase, ...style }}
      {...rest}
    />
  );
}

function Textarea({ value, onChange, placeholder, rows = 4 }) {
  return (
    <textarea
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      style={{ ...inputStyleBase, resize: "vertical", lineHeight: 1.6 }}
    />
  );
}

const inputStyleBase = {
  padding: "9px 12px",
  borderRadius: 8,
  border: `1px solid ${c.border}`,
  fontSize: 14,
  fontFamily: "inherit",
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
  background: c.white,
  color: c.text,
};

function Section({ title, children }) {
  return (
    <div style={{ background: c.white, border: `1px solid ${c.border}`, borderRadius: 12, padding: 20, display: "grid", gap: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: c.primary, textTransform: "uppercase", letterSpacing: "0.06em", borderBottom: `2px solid ${c.primary}`, paddingBottom: 8 }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function StatusBadge({ status }) {
  const s = OFFER_STATUS_COLORS[status] ?? OFFER_STATUS_COLORS.draft;
  return (
    <span style={{ fontSize: 12, fontWeight: 600, padding: "3px 10px", borderRadius: 999, background: s.bg, color: s.fg }}>
      {status}
    </span>
  );
}

async function buildOfferVersionChain(supabase, startId) {
  const chain = [];
  let cur = startId;
  const seen = new Set();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const { data } = await supabase.from("offers").select("id,version,created_at,sent_at,status,parent_offer_id").eq("id", cur).maybeSingle();
    if (!data) break;
    chain.push(data);
    cur = data.parent_offer_id;
  }
  return chain.reverse();
}

export default function OfferEditor({ leadId = null, initialData = {}, offerId = null, onSaved, onOfferAccepted, onDeleted }) {
  const supabase = getSupabaseClient();
  const [ConfirmModal, confirm] = useConfirm();

  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState(null);
  const [properties, setProperties] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [activeTab, setActiveTab] = useState("details");
  const [loadedRow, setLoadedRow] = useState(null);
  const [versionHistory, setVersionHistory] = useState([]);
  const [crmCompanyEmail, setCrmCompanyEmail] = useState("");
  const [primaryTenantId, setPrimaryTenantId] = useState(null);
  const [createContactOpen, setCreateContactOpen] = useState(false);
  const [createContactQuery, setCreateContactQuery] = useState("");
  const [savedOfferId, setSavedOfferId] = useState(offerId);
  const [sendEmailLoading, setSendEmailLoading] = useState(false);
  const [sendEmailMsg, setSendEmailMsg] = useState(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [markSentNote, setMarkSentNote] = useState(false);

  const [form, setForm] = useState({
    title: "Offer",
    status: "draft",
    version: 1,
    companyId: "",
    customerName: "",
    customerEmail: "",
    customerPhone: "",
    customerCompany: "",
    propertyId: "",
    spaceDetails: "",
    monthlyPrice: "",
    contractLengthMonths: 12,
    startDate: "",
    introText: DEFAULT_INTRO,
    termsText: DEFAULT_TERMS,
    notes: "",
    templateName: "",
    isTemplate: false,
    publicToken: "",
    ...initialData,
  });

  const applyLeadProfile = useCallback((row) => {
    setForm((f) => ({
      ...f,
      companyId: row.id,
      customerCompany: row.company_name ?? "",
      customerEmail: row.email ?? "",
      customerPhone: row.phone ?? row.contact_direct_phone ?? "",
      customerName: row.contact_person_name ?? [row.contact_first_name, row.contact_last_name].filter(Boolean).join(" ") ?? "",
    }));
  }, []);

  useEffect(() => {
    if (!leadId || offerId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from("leads").select("id,company_name,email,phone,contact_person_name,contact_first_name,contact_last_name,contact_direct_phone").eq("id", leadId).maybeSingle();
      if (cancelled || !data) return;
      applyLeadProfile(data);
    })();
    return () => {
      cancelled = true;
    };
  }, [leadId, offerId, applyLeadProfile, supabase]);

  useEffect(() => {
    if (!form.companyId) {
      setCrmCompanyEmail("");
      return;
    }
    let cancelled = false;
    supabase
      .from("leads")
      .select("*")
      .eq("id", form.companyId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        setCrmCompanyEmail((data?.email ?? "").trim());
      });
    return () => {
      cancelled = true;
    };
  }, [form.companyId, supabase]);

  useEffect(() => {
    if (!offerId) {
      setLoadedRow(null);
      setVersionHistory([]);
      return;
    }
    let cancelled = false;
    supabase.from("offers").select("*").eq("id", offerId).single().then(({ data }) => {
      if (cancelled || !data) return;
      setSavedOfferId(data.id);
      setLoadedRow({ id: data.id, status: data.status ?? "draft", version: data.version ?? 1, parentOfferId: data.parent_offer_id ?? null });
      setForm({
        title: data.title ?? "Offer",
        status: data.status ?? "draft",
        version: data.version ?? 1,
        companyId: data.lead_id ?? data.company_id ?? "",
        customerName: data.customer_name ?? "",
        customerEmail: data.customer_email ?? "",
        customerPhone: data.customer_phone ?? "",
        customerCompany: data.customer_company ?? "",
        propertyId: data.property_id ?? "",
        spaceDetails: data.space_details ?? "",
        monthlyPrice: data.monthly_price ?? "",
        contractLengthMonths: data.contract_length_months ?? 12,
        startDate: data.start_date ?? "",
        introText: data.intro_text ?? DEFAULT_INTRO,
        termsText: data.terms_text ?? DEFAULT_TERMS,
        notes: data.notes ?? "",
        templateName: data.template_name ?? "",
        isTemplate: data.is_template ?? false,
        publicToken: data.public_token ?? "",
      });
    });
    buildOfferVersionChain(supabase, offerId).then((ch) => {
      if (!cancelled) setVersionHistory(ch);
    });
    return () => {
      cancelled = true;
    };
  }, [offerId, supabase]);

  useEffect(() => {
    supabase.from("properties").select("id,name,address,city,tenant_id").order("name").then(({ data }) => setProperties(data ?? []));
    supabase
      .from("offers")
      .select("id,template_name,intro_text,terms_text,space_details,monthly_price,contract_length_months")
      .eq("is_template", true)
      .order("template_name")
      .then(({ data }) => setTemplates(data ?? []));
  }, [supabase]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || cancelled) return;
      const { data: mem } = await supabase.from("memberships").select("tenant_id, role").eq("user_id", user.id);
      const rows = mem ?? [];
      const prefer = rows.filter(
        (m) => m.tenant_id && ["super_admin", "owner", "manager"].includes((m.role ?? "").toLowerCase()),
      );
      const tid = prefer[0]?.tenant_id ?? rows.find((m) => m.tenant_id)?.tenant_id ?? null;
      if (!cancelled) setPrimaryTenantId(tid);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  const selectedLeadForSearch = useMemo(() => {
    if (!form.companyId) return null;
    return {
      id: form.companyId,
      company_name: form.customerCompany || null,
      contact_person_name: form.customerName || null,
      email: form.customerEmail || null,
      phone: form.customerPhone || null,
    };
  }, [form.companyId, form.customerCompany, form.customerName, form.customerEmail, form.customerPhone]);

  const clearCrmSelection = useCallback(() => {
    setForm((f) => ({
      ...f,
      companyId: "",
      customerName: "",
      customerEmail: "",
      customerPhone: "",
      customerCompany: "",
    }));
    setCrmCompanyEmail("");
  }, []);

  function set(field) {
    return (val) => setForm((f) => ({ ...f, [field]: val }));
  }

  function applyTemplate(templateId) {
    const t = templates.find((x) => x.id === templateId);
    if (!t) return;
    setForm((f) => ({
      ...f,
      introText: t.intro_text ?? f.introText,
      termsText: t.terms_text ?? f.termsText,
      spaceDetails: t.space_details ?? f.spaceDetails,
      monthlyPrice: t.monthly_price ?? f.monthlyPrice,
      contractLengthMonths: t.contract_length_months ?? f.contractLengthMonths,
    }));
  }

  async function ensureContractDraftFromOffer(sourceOfferId) {
    const { data: existing } = await supabase.from("contracts").select("id").eq("source_offer_id", sourceOfferId).limit(1).maybeSingle();
    if (existing) {
      onOfferAccepted?.();
      return;
    }

    const { error } = await supabase.from("contracts").insert({
      company_id: form.companyId || null,
      lead_id: form.companyId || leadId || null,
      source_offer_id: sourceOfferId,
      title: `Contract — ${form.title}`,
      status: "draft",
      signing_method: "esign",
      customer_name: form.customerName || null,
      customer_email: form.customerEmail || null,
      customer_phone: form.customerPhone || null,
      customer_company: form.customerCompany || null,
      property_id: form.propertyId || null,
      space_details: form.spaceDetails || null,
      monthly_price: form.monthlyPrice ? Number(form.monthlyPrice) : null,
      contract_length_months: form.contractLengthMonths ? Number(form.contractLengthMonths) : null,
      start_date: form.startDate || null,
      intro_text: form.introText || null,
      terms_text: form.termsText || null,
      notes: form.notes || null,
      version: 1,
      parent_contract_id: null,
    });
    if (!error) onOfferAccepted?.();
  }

  function resolvePublicTokenForSave(shouldFork) {
    if (form.isTemplate) return null;
    if (shouldFork) return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : null;
    const existing = form.publicToken?.trim();
    if (existing) return existing;
    return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : null;
  }

  async function save(newStatus) {
    setSaving(true);
    setSaveMsg(null);
    const effectiveStatus = newStatus ?? form.status;
    const rowStatus = loadedRow?.status ?? "draft";
    const shouldFork = Boolean(offerId) && !form.isTemplate && NON_DRAFT_STATUSES.includes(rowStatus);
    const public_token = resolvePublicTokenForSave(shouldFork);

    const payload = {
      title: form.title,
      status: effectiveStatus,
      lead_id: form.companyId || leadId || null,
      company_id: form.companyId || null,
      customer_name: form.customerName || null,
      customer_email: form.customerEmail || null,
      customer_phone: form.customerPhone || null,
      customer_company: form.customerCompany || null,
      property_id: form.propertyId || null,
      space_details: form.spaceDetails || null,
      monthly_price: form.monthlyPrice ? Number(form.monthlyPrice) : null,
      contract_length_months: form.contractLengthMonths ? Number(form.contractLengthMonths) : null,
      start_date: form.startDate || null,
      intro_text: form.introText || null,
      terms_text: form.termsText || null,
      notes: form.notes || null,
      template_name: form.isTemplate ? form.templateName || null : null,
      is_template: form.isTemplate,
      ...(form.isTemplate ? { public_token: null } : public_token ? { public_token } : {}),
      ...(effectiveStatus === "sent" ? { sent_at: new Date().toISOString() } : {}),
    };

    let error;
    let resultId = offerId;

    if (shouldFork) {
      const nextVersion = (loadedRow?.version ?? form.version ?? 1) + 1;
      const { data: inserted, error: insErr } = await supabase
        .from("offers")
        .insert({
          ...payload,
          version: nextVersion,
          parent_offer_id: offerId,
        })
        .select()
        .single();
      error = insErr;
      if (inserted) {
        resultId = inserted.id;
        setSavedOfferId(inserted.id);
        setForm((f) => ({
          ...f,
          version: nextVersion,
          status: effectiveStatus,
          publicToken: inserted.public_token ?? f.publicToken ?? "",
        }));
        setLoadedRow({ id: inserted.id, status: effectiveStatus, version: nextVersion, parentOfferId: offerId });
        buildOfferVersionChain(supabase, inserted.id).then(setVersionHistory);
      }
    } else if (offerId) {
      const { data: updated, error: upErr } = await supabase.from("offers").update(payload).eq("id", offerId).select().single();
      error = upErr;
      if (updated?.public_token) {
        setForm((f) => ({ ...f, publicToken: updated.public_token }));
      }
    } else {
      const { data: inserted, error: insErr } = await supabase.from("offers").insert(payload).select().single();
      error = insErr;
      if (inserted) {
        resultId = inserted.id;
        setSavedOfferId(inserted.id);
        setLoadedRow({ id: inserted.id, status: effectiveStatus, version: inserted.version ?? 1, parentOfferId: inserted.parent_offer_id ?? null });
        setForm((f) => ({
          ...f,
          version: inserted.version ?? 1,
          publicToken: inserted.public_token ?? f.publicToken ?? "",
        }));
        buildOfferVersionChain(supabase, inserted.id).then(setVersionHistory);
      }
    }

    setSaving(false);
    if (error) {
      setSaveMsg({ type: "error", text: error.message });
      return { error };
    }

    setSaveMsg({ type: "ok", text: newStatus === "sent" ? "Offer marked as sent!" : shouldFork ? "Saved as new version." : "Saved." });
    onSaved?.({ newOfferId: resultId !== offerId ? resultId : undefined });
    if (newStatus) setForm((f) => ({ ...f, status: newStatus }));
    if (offerId && !shouldFork) {
      setLoadedRow((lr) => (lr ? { ...lr, status: effectiveStatus, version: lr.version ?? form.version ?? 1 } : lr));
    }

    if (effectiveStatus === "accepted" && resultId) {
      await ensureContractDraftFromOffer(resultId);
    }
    return { error: null };
  }

  async function markAsSentNoEmail() {
    if (!savedOfferId) return;
    setMarkSentNote(false);
    const r = await save("sent");
    if (!r?.error) {
      setMarkSentNote(true);
      setSendEmailMsg(null);
    }
  }

  async function deleteOffer() {
    if (!loadedRow?.id) return;
    const { data: linked, error: linkedErr } = await supabase
      .from("contracts")
      .select("id")
      .or(`offer_id.eq.${loadedRow.id},source_offer_id.eq.${loadedRow.id}`)
      .limit(1);
    if (linkedErr) {
      setSaveMsg({ type: "error", text: linkedErr.message });
      return;
    }

    const hasLinked = Boolean(linked && linked.length > 0);
    const ok = hasLinked
      ? await confirm({
          title: "Delete this offer?",
          message:
            "This offer has a linked contract draft. Deleting the offer will also remove the contract draft. Continue?",
          confirmLabel: "Continue",
          confirmDanger: true,
        })
      : await confirm({
          title: "Delete this offer?",
          message: "Are you sure you want to delete this offer? This cannot be undone.",
          confirmLabel: "Delete",
          confirmDanger: true,
        });
    if (!ok) return;

    if (hasLinked) {
      const { error: unlinkErr } = await supabase
        .from("contracts")
        .update({ offer_id: null, source_offer_id: null })
        .or(`offer_id.eq.${loadedRow.id},source_offer_id.eq.${loadedRow.id}`);
      if (unlinkErr) {
        setSaveMsg({ type: "error", text: unlinkErr.message });
        return;
      }
    }

    const { error } = await supabase.from("offers").delete().eq("id", loadedRow.id);
    if (error) {
      setSaveMsg({ type: "error", text: error.message });
      return;
    }
    onDeleted?.();
  }

  async function sendOfferEmail() {
    const idToUse = savedOfferId ?? offerId ?? loadedRow?.id;
    if (!idToUse || !crmCompanyEmail) {
      setSendEmailMsg({ type: "error", text: !idToUse ? "Please save the offer first." : "No email on file." });
      return;
    }
    setSendEmailLoading(true);
    setSendEmailMsg(null);
    setMarkSentNote(false);
    try {
      const res = await fetch("/api/offers/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ offerId: idToUse, emailType: "offer_sent" }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof j.error === "string" ? j.error : "Failed to send email");
      const { error: upErr } = await supabase.from("offers").update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", idToUse);
      if (upErr) throw new Error(upErr.message);
      setForm((f) => ({ ...f, status: "sent" }));
      setLoadedRow((lr) => (lr ? { ...lr, status: "sent" } : lr));
      setSendEmailMsg({ type: "ok", text: `Email sent to ${crmCompanyEmail}` });
    } catch (e) {
      setSendEmailMsg({ type: "error", text: e instanceof Error ? e.message : "Failed to send email" });
    } finally {
      setSendEmailLoading(false);
    }
  }

  function copyPublicOfferLink() {
    if (!savedOfferId) return;
    const tok = form.publicToken?.trim();
    if (!tok) return;
    const url = `${window.location.origin}/offers/${tok}`;
    void navigator.clipboard.writeText(url);
    setCopiedLink(true);
    window.setTimeout(() => setCopiedLink(false), 2000);
  }

  const selectedProperty = properties.find((p) => p.id === form.propertyId);

  const previewHtml = useMemo(() => {
    const rentCol = c.primary;
    return `
    <div style="font-family:Georgia,serif;max-width:680px;margin:0 auto;color:${c.text};line-height:1.7">
      <div style="border-bottom:3px solid ${c.primary};padding-bottom:16px;margin-bottom:24px">
        <div style="font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:${c.text};opacity:0.72">VillageWorks</div>
        <h1 style="margin:8px 0 4px;font-size:28px;font-weight:700;color:${c.text}">${form.title}</h1>
        <div style="font-size:13px;color:${c.text};opacity:0.72">Prepared for: <strong>${form.customerName || "—"}</strong>${form.customerCompany ? ` · ${form.customerCompany}` : ""}</div>
      </div>
      <p style="font-size:15px">${(form.introText || "").replace(/\n/g, "<br>")}</p>
      <table style="width:100%;border-collapse:collapse;margin:24px 0;font-size:14px">
        <tr style="background:${c.hover}"><td style="padding:10px 14px;font-weight:600">Space</td><td style="padding:10px 14px">${form.spaceDetails || "—"}</td></tr>
        <tr><td style="padding:10px 14px;font-weight:600">Location</td><td style="padding:10px 14px">${selectedProperty ? `${selectedProperty.name}, ${selectedProperty.address}, ${selectedProperty.city}` : "—"}</td></tr>
        <tr style="background:${c.hover}"><td style="padding:10px 14px;font-weight:600">Monthly rent</td><td style="padding:10px 14px;font-size:18px;font-weight:700;color:${rentCol}">${form.monthlyPrice ? `€${Number(form.monthlyPrice).toLocaleString("en-IE")} / month` : "—"}</td></tr>
        <tr><td style="padding:10px 14px;font-weight:600">Contract length</td><td style="padding:10px 14px">${form.contractLengthMonths ? `${form.contractLengthMonths} months` : "—"}</td></tr>
        <tr style="background:${c.hover}"><td style="padding:10px 14px;font-weight:600">Proposed start</td><td style="padding:10px 14px">${form.startDate || "To be agreed"}</td></tr>
      </table>
      <h3 style="font-size:15px;border-bottom:1px solid ${c.border};padding-bottom:6px;color:${c.text}">Terms &amp; conditions</h3>
      <p style="font-size:13px;color:${c.text};opacity:0.85">${(form.termsText || "").replace(/\n/g, "<br>")}</p>
    </div>
  `;
  }, [form, selectedProperty]);

  const stepIndex = OFFER_STEPS.findIndex((s) => s.key === activeTab);
  const currentStep = stepIndex >= 0 ? stepIndex : 0;

  const verLabel = `v${form.version ?? 1}.0`;

  async function nextFromDetails() {
    const r = await save();
    if (!r?.error) {
      setActiveTab("content");
    }
  }

  return (
    <div style={{ display: "grid", gap: 16, maxWidth: 860, margin: "0 auto" }}>
      <CreateContactModal
        isOpen={createContactOpen}
        onClose={() => setCreateContactOpen(false)}
        initialCompanyName={createContactQuery}
        defaultTenantId={primaryTenantId ?? ""}
        properties={properties}
        onCreated={(row) => {
          applyLeadProfile(row);
          setCreateContactOpen(false);
          window.setTimeout(() => void save(), 0);
        }}
      />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <h1 className="vw-admin-page-title" style={{ margin: 0 }}>{form.title || "Offer editor"}</h1>
          <span style={{ fontSize: 13, fontWeight: 600, color: c.secondary }}>{verLabel}</span>
          <StatusBadge status={form.status} />
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {loadedRow?.id ? (
            <button
              onClick={() => void deleteOffer()}
              disabled={saving}
              style={{
                padding: "8px 16px",
                borderRadius: 8,
                border: `1px solid ${c.danger}`,
                background: c.white,
                color: c.danger,
                fontWeight: 600,
                cursor: "pointer",
                fontSize: 13
              }}
            >
              Delete offer
            </button>
          ) : null}
          {templates.length > 0 && (
            <select onChange={(e) => applyTemplate(e.target.value)} defaultValue="" style={{ ...inputStyleBase, width: "auto", fontSize: 13 }}>
              <option value="" disabled>
                Load template…
              </option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.template_name}
                </option>
              ))}
            </select>
          )}
          <button
            onClick={() => save()}
            disabled={saving}
            style={{ padding: "8px 16px", borderRadius: 8, border: `1px solid ${c.primary}`, background: c.white, color: c.primary, fontWeight: 600, cursor: "pointer", fontSize: 13 }}
          >
            {saving ? "Saving…" : "Save draft"}
          </button>
          <button
            onClick={() => save("sent")}
            disabled={saving}
            style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: c.primary, color: c.white, fontWeight: 600, cursor: "pointer", fontSize: 13 }}
          >
            Mark as sent
          </button>
        </div>
      </div>

      {saveMsg && (
        <div
          style={{
            padding: "10px 14px",
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 500,
            background: saveMsg.type === "ok" ? c.hover : c.hover,
            color: saveMsg.type === "ok" ? c.success : c.danger,
            border: `1px solid ${c.border}`,
          }}
        >
          {saveMsg.text}
        </div>
      )}

      <div
        style={{
          background: c.white,
          border: `1px solid ${c.border}`,
          borderRadius: 12,
          padding: "20px 16px 24px",
          marginBottom: 4,
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 0, width: "100%", maxWidth: 720, margin: "0 auto" }}>
          {OFFER_STEPS.map((step, i) => {
            const active = i === currentStep;
            const completed = i < currentStep;
            const upcoming = i > currentStep;
            const circleSize = 36;
            const circleBase = {
              width: circleSize,
              height: circleSize,
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 14,
              fontWeight: 700,
              flexShrink: 0,
              boxSizing: "border-box",
            };
            let circleStyle;
            if (completed) {
              circleStyle = { ...circleBase, background: LIGHT_GREEN, color: c.success, border: `2px solid ${c.success}` };
            } else if (active) {
              circleStyle = { ...circleBase, background: c.primary, color: c.white, border: `2px solid ${c.primary}` };
            } else {
              circleStyle = {
                ...circleBase,
                background: "transparent",
                color: c.text,
                border: `2px solid ${c.border}`,
                opacity: 0.85,
              };
            }
            const labelOpacity = upcoming ? 0.45 : 1;
            const labelWeight = active ? 700 : 500;

            return (
              <Fragment key={step.key}>
                <button
                  type="button"
                  onClick={() => setActiveTab(step.key)}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 10,
                    background: "none",
                    border: "none",
                    padding: 0,
                    cursor: "pointer",
                    flex: "0 0 auto",
                    minWidth: 0,
                    maxWidth: 130,
                  }}
                >
                  <span style={circleStyle}>{completed ? "✓" : i + 1}</span>
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: labelWeight,
                      color: c.text,
                      opacity: labelOpacity,
                      textAlign: "center",
                      lineHeight: 1.3,
                    }}
                  >
                    {step.label}
                  </span>
                </button>
                {i < OFFER_STEPS.length - 1 ? (
                  <div
                    aria-hidden
                    style={{
                      flex: "1 1 auto",
                      minWidth: 12,
                      height: circleSize,
                      display: "flex",
                      alignItems: "center",
                      alignSelf: "flex-start",
                    }}
                  >
                    <div
                      style={{
                        width: "100%",
                        height: 3,
                        borderRadius: 2,
                        background: i < currentStep ? c.success : c.border,
                      }}
                    />
                  </div>
                ) : null}
              </Fragment>
            );
          })}
        </div>
      </div>

      {activeTab === "details" && (
        <>
          <Section title="Company (CRM)">
            <Field
              label="CRM contact"
              hint="Single source: public.leads (same as CRM). Search, pick, or create a new lead — contact fields below fill from the selection."
            >
              <ContactSearchWithCreate
                colors={c}
                selectedLead={selectedLeadForSearch}
                onSelect={applyLeadProfile}
                onClearSelection={clearCrmSelection}
                onRequestCreate={(q) => {
                  setCreateContactQuery(q);
                  setCreateContactOpen(true);
                }}
                createDisabled={!primaryTenantId}
                createDisabledHint={!primaryTenantId ? "Sign in with a workspace membership to create contacts from here." : undefined}
              />
              <button
                type="button"
                disabled={!primaryTenantId}
                onClick={() => {
                  setCreateContactQuery("");
                  setCreateContactOpen(true);
                }}
                style={{
                  marginTop: 10,
                  padding: "8px 14px",
                  borderRadius: 8,
                  border: `1px solid ${c.primary}`,
                  background: c.white,
                  color: c.primary,
                  fontWeight: 600,
                  cursor: primaryTenantId ? "pointer" : "not-allowed",
                  fontSize: 13,
                  width: "fit-content",
                }}
              >
                + Create new contact
              </button>
            </Field>
            {form.companyId ? (
              crmCompanyEmail ? (
                <p style={{ margin: "6px 0 0", fontSize: 12, color: c.text, opacity: 0.55 }}>
                  CRM email on file: {crmCompanyEmail}
                </p>
              ) : (
                <p style={{ margin: "6px 0 0", fontSize: 12, color: c.danger, lineHeight: 1.45 }}>
                  No email on file — add one in{" "}
                  <a href="/crm/contacts" style={{ color: c.danger, fontWeight: 700, textDecoration: "underline" }}>
                    CRM
                  </a>{" "}
                  before sending
                </p>
              )
            ) : null}
            {form.companyId ? (
              <p style={{ margin: "8px 0 0", fontSize: 13, color: c.text, opacity: 0.75 }}>
                <a href={`/crm/leads/${form.companyId}`} style={{ color: c.primary, fontWeight: 600 }}>
                  Open in CRM →
                </a>
              </p>
            ) : null}
          </Section>

          <Section title="Version history">
            {versionHistory.length === 0 ? (
              <p style={{ margin: 0, fontSize: 13, color: c.text, opacity: 0.65 }}>Save this offer to start a version history.</p>
            ) : (
              <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 8 }}>
                {versionHistory.map((row) => (
                  <li
                    key={row.id}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: "8px 12px",
                      borderRadius: 8,
                      background: row.id === offerId ? c.hover : c.background,
                      border: `1px solid ${c.border}`,
                      fontSize: 13,
                      color: c.text,
                    }}
                  >
                    <span style={{ fontWeight: 600 }}>
                      v{row.version ?? 1}.0 · {row.status}
                      {row.id === offerId ? <span style={{ marginLeft: 8, color: c.accent }}>(current)</span> : null}
                    </span>
                    <span style={{ opacity: 0.75 }}>{row.created_at ? new Date(row.created_at).toLocaleString("en-GB") : "—"}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Contact person">
            {form.companyId ? (
              <p style={{ margin: 0, fontSize: 12, color: c.text, opacity: 0.65 }}>
                Filled from CRM. Use <strong>Change</strong> above to pick a different lead, or edit if you need a one-off override.
              </p>
            ) : null}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <Field label="Full name">
                <Input
                  value={form.customerName}
                  onChange={set("customerName")}
                  placeholder="Contact name"
                  readOnly={Boolean(form.companyId)}
                  style={form.companyId ? { ...inputStyleBase, opacity: 0.92, cursor: "default" } : undefined}
                />
              </Field>
              <Field label="Email">
                <Input
                  value={form.customerEmail}
                  onChange={set("customerEmail")}
                  placeholder="email@company.fi"
                  type="email"
                  readOnly={Boolean(form.companyId)}
                  style={form.companyId ? { ...inputStyleBase, opacity: 0.92, cursor: "default" } : undefined}
                />
              </Field>
              <Field label="Phone">
                <Input
                  value={form.customerPhone}
                  onChange={set("customerPhone")}
                  placeholder="+358 …"
                  readOnly={Boolean(form.companyId)}
                  style={form.companyId ? { ...inputStyleBase, opacity: 0.92, cursor: "default" } : undefined}
                />
              </Field>
            </div>
          </Section>

          <Section title="Space & pricing">
            <Field label="Property">
              <select value={form.propertyId} onChange={(e) => set("propertyId")(e.target.value)} style={inputStyleBase}>
                <option value="">Select property…</option>
                {properties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} — {p.city}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Space / room details" hint="e.g. Office 4B, 2nd floor, 24 m²">
              <Input value={form.spaceDetails} onChange={set("spaceDetails")} placeholder="Office 4B…" />
            </Field>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
              <Field label="Monthly rent (€)" hint="Excl. VAT">
                <Input value={form.monthlyPrice} onChange={set("monthlyPrice")} placeholder="1200" type="number" />
              </Field>
              <Field label="Contract length (months)">
                <Input value={form.contractLengthMonths} onChange={set("contractLengthMonths")} placeholder="12" type="number" />
              </Field>
              <Field label="Proposed start date">
                <Input value={form.startDate} onChange={set("startDate")} type="date" />
              </Field>
            </div>
          </Section>

          <Section title="Offer settings">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <Field label="Offer title">
                <Input value={form.title} onChange={set("title")} placeholder="Offer" />
              </Field>
              <Field label="Status">
                <select value={form.status} onChange={(e) => set("status")(e.target.value)} style={inputStyleBase}>
                  {["draft", "sent", "viewed", "accepted", "declined", "expired"].map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="Internal notes" hint="Not shown to customer">
              <Textarea value={form.notes} onChange={set("notes")} placeholder="Internal notes…" rows={3} />
            </Field>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <input type="checkbox" id="is-template" checked={form.isTemplate} onChange={(e) => set("isTemplate")(e.target.checked)} />
              <label htmlFor="is-template" style={{ fontSize: 14, cursor: "pointer", color: c.text }}>
                Save as reusable template
              </label>
            </div>
            {form.isTemplate && (
              <Field label="Template name">
                <Input value={form.templateName} onChange={set("templateName")} placeholder="e.g. Standard 12-month office" />
              </Field>
            )}
          </Section>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 24, paddingTop: 16, borderTop: `1px solid ${c.border}` }}>
            <div />
            <button
              type="button"
              onClick={() => void nextFromDetails()}
              style={{
                padding: "10px 20px",
                borderRadius: 8,
                border: "none",
                background: c.primary,
                color: c.white,
                fontWeight: 600,
                cursor: "pointer",
                fontSize: 14
              }}
            >
              {saving ? "Saving…" : "Next → Write content"}
            </button>
          </div>
        </>
      )}

      {activeTab === "content" && (
        <>
          <Section title="Introduction text">
            <Field label="Opening paragraph" hint="Shown at the top of the offer">
              <Textarea value={form.introText} onChange={set("introText")} rows={8} />
            </Field>
          </Section>
          <Section title="Terms & conditions">
            <Field label="Terms" hint="Shown at the bottom of the offer">
              <Textarea value={form.termsText} onChange={set("termsText")} rows={10} />
            </Field>
          </Section>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 24, paddingTop: 16, borderTop: `1px solid ${c.border}` }}>
            <button
              type="button"
              onClick={() => setActiveTab("details")}
              style={{
                padding: "10px 20px",
                borderRadius: 8,
                border: `1px solid ${c.border}`,
                background: c.white,
                color: c.text,
                fontWeight: 600,
                cursor: "pointer",
                fontSize: 14
              }}
            >
              ← Fill details
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("preview")}
              style={{
                padding: "10px 20px",
                borderRadius: 8,
                border: "none",
                background: c.primary,
                color: c.white,
                fontWeight: 600,
                cursor: "pointer",
                fontSize: 14
              }}
            >
              Next → Preview & send
            </button>
          </div>
        </>
      )}

      {activeTab === "preview" && (
        <div style={{ background: c.white, border: `1px solid ${c.border}`, borderRadius: 12, padding: 32 }}>
          {!loadedRow?.id && (
            <div style={{
              padding: "12px 16px",
              borderRadius: 8,
              background: "#fef3c7",
              border: "1px solid #fcd34d",
              color: "#92400e",
              fontSize: 13,
              fontWeight: 500,
              marginBottom: 16
            }}>
              Save the offer as a draft first before sending — use the "Save draft" button at the top right.
            </div>
          )}
          {!form.isTemplate ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginBottom: 16 }}>
              <button
                type="button"
                disabled={!loadedRow?.id || !crmCompanyEmail}
                title={!loadedRow?.id ? "Save the offer first" : !crmCompanyEmail && form.companyId ? "No email on file for this company" : undefined}
                onClick={() => void sendOfferEmail()}
                style={{
                  padding: "10px 18px",
                  borderRadius: 8,
                  border: "none",
                  background: !loadedRow?.id || !crmCompanyEmail ? c.border : c.primary,
                  color: c.white,
                  fontWeight: 600,
                  cursor: !loadedRow?.id || !crmCompanyEmail ? "not-allowed" : "pointer",
                  fontSize: 13,
                }}
              >
                {sendEmailLoading ? "Sending…" : "Send email"}
              </button>
              <button
                type="button"
                onClick={() =>
                  void confirm({
                    variant: "info",
                    title: "PDF",
                    message: "PDF generation coming soon",
                    confirmLabel: "Got it",
                  })
                }
                style={{
                  padding: "10px 18px",
                  borderRadius: 8,
                  border: `1px solid ${c.primary}`,
                  background: c.white,
                  color: c.primary,
                  fontWeight: 600,
                  cursor: "pointer",
                  fontSize: 13,
                }}
              >
                Download PDF
              </button>
              <button
                type="button"
                disabled={saving || !loadedRow?.id}
                onClick={() => void markAsSentNoEmail()}
                style={{
                  padding: "10px 14px",
                  borderRadius: 8,
                  border: "none",
                  background: "transparent",
                  color: c.primary,
                  fontWeight: 600,
                  opacity: saving || !loadedRow?.id ? 0.5 : 1,
                  cursor: saving || !loadedRow?.id ? "not-allowed" : "pointer",
                  fontSize: 13,
                  textDecoration: "underline",
                  textUnderlineOffset: 3,
                }}
              >
                Mark as sent
              </button>
              <button
                type="button"
                disabled={!loadedRow?.id || !form.publicToken?.trim()}
                onClick={copyPublicOfferLink}
                style={{
                  padding: "10px 14px",
                  borderRadius: 8,
                  border: "none",
                  background: "transparent",
                  color: c.primary,
                  fontWeight: 600,
                  opacity: !loadedRow?.id || !form.publicToken?.trim() ? 0.5 : 1,
                  cursor: !loadedRow?.id || !form.publicToken?.trim() ? "not-allowed" : "pointer",
                  fontSize: 13,
                  textDecoration: "underline",
                  textUnderlineOffset: 3,
                }}
              >
                {copiedLink ? "Copied!" : "Copy link"}
              </button>
            </div>
          ) : null}

          {!form.isTemplate && !form.publicToken?.trim() && offerId ? (
            <p style={{ margin: "0 0 16px", fontSize: 13, color: c.text, opacity: 0.75 }}>Save the offer to generate a public share link for copying.</p>
          ) : null}

          {sendEmailMsg ? (
            <div
              style={{
                marginBottom: 14,
                padding: "10px 14px",
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 500,
                background: c.hover,
                color: sendEmailMsg.type === "ok" ? c.success : c.danger,
                border: `1px solid ${c.border}`,
              }}
            >
              {sendEmailMsg.text}
            </div>
          ) : null}

          {markSentNote ? <p style={{ margin: "0 0 16px", fontSize: 12, color: c.text, opacity: 0.55 }}>Marked as sent — no email was sent</p> : null}

          <div dangerouslySetInnerHTML={{ __html: previewHtml }} />

          {loadedRow?.parentOfferId ? (
            <div style={{ marginTop: 28, paddingTop: 20, borderTop: `1px solid ${c.border}` }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: c.primary, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 12 }}>Version history</div>
              {versionHistory.filter((row) => row.id !== offerId).length === 0 ? (
                <p style={{ margin: 0, fontSize: 13, color: c.text, opacity: 0.65 }}>No previous versions loaded.</p>
              ) : (
                <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 8 }}>
                  {versionHistory
                    .filter((row) => row.id !== offerId)
                    .map((row) => (
                      <li
                        key={row.id}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr 1fr 1fr",
                          gap: 8,
                          alignItems: "center",
                          padding: "10px 12px",
                          borderRadius: 8,
                          background: c.background,
                          border: `1px solid ${c.border}`,
                          fontSize: 13,
                          color: c.text,
                        }}
                      >
                        <span style={{ fontWeight: 700 }}>v{row.version ?? 1}.0</span>
                        <span style={{ opacity: 0.85 }}>{row.sent_at ? new Date(row.sent_at).toLocaleString("en-GB") : "—"}</span>
                        <span style={{ fontWeight: 600 }}>{row.status}</span>
                      </li>
                    ))}
                </ul>
              )}
            </div>
          ) : null}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 24, paddingTop: 16, borderTop: `1px solid ${c.border}` }}>
            <button
              type="button"
              onClick={() => setActiveTab("content")}
              style={{
                padding: "10px 20px",
                borderRadius: 8,
                border: `1px solid ${c.border}`,
                background: c.white,
                color: c.text,
                fontWeight: 600,
                cursor: "pointer",
                fontSize: 14
              }}
            >
              ← Write content
            </button>
            <div />
          </div>
        </div>
      )}
    </div>
  );
}
