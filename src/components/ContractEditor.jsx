"use client";

/**
 * ContractEditor — Contract tool (table public.contracts, CRM company = public.leads)
 */

import { useState, useEffect, useCallback, useMemo, Fragment } from "react";
import { getSupabaseClient } from "@/lib/supabase/browser";
import { VILLAGEWORKS_BRAND } from "@/lib/brand/villageworks";
import { useConfirm } from "@/hooks/useConfirm";

const c = VILLAGEWORKS_BRAND.colors;

const DEFAULT_INTRO = `This contract sets out the terms under which VillageWorks will provide the agreed workspace services.

We look forward to a successful partnership.`;

const DEFAULT_TERMS = `1. This contract enters into force when signed by both parties.
2. Rent is exclusive of VAT unless otherwise stated.
3. Specific commercial terms are summarised in the schedule below.`;

const CONTRACT_STATUS_COLORS = {
  draft: { bg: c.hover, fg: c.text },
  sent: { bg: c.border, fg: c.primary },
  signed_digital: { bg: c.hover, fg: c.accent },
  signed_paper: { bg: c.hover, fg: c.warning },
  active: { bg: c.hover, fg: c.success },
};

const NON_DRAFT_CONTRACT_STATUSES = ["sent", "signed_digital", "signed_paper", "active"];

const CONTRACT_STEPS = [
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

function Input({ value, onChange, placeholder, type = "text", ...rest }) {
  return <input type={type} value={value ?? ""} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} style={inputStyleBase} {...rest} />;
}

function Textarea({ value, onChange, placeholder, rows = 4 }) {
  return <textarea value={value ?? ""} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={rows} style={{ ...inputStyleBase, resize: "vertical", lineHeight: 1.6 }} />;
}

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
  const s = CONTRACT_STATUS_COLORS[status] ?? CONTRACT_STATUS_COLORS.draft;
  return (
    <span style={{ fontSize: 12, fontWeight: 600, padding: "3px 10px", borderRadius: 999, background: s.bg, color: s.fg }}>
      {status}
    </span>
  );
}

async function buildContractVersionChain(supabase, startId) {
  const chain = [];
  let cur = startId;
  const seen = new Set();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const { data } = await supabase.from("contracts").select("id,version,created_at,status,parent_contract_id").eq("id", cur).maybeSingle();
    if (!data) break;
    chain.push(data);
    cur = data.parent_contract_id;
  }
  return chain.reverse();
}

export default function ContractEditor({ leadId = null, initialData = {}, contractId = null, onSaved, onDeleted }) {
  const supabase = getSupabaseClient();

  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState(null);
  const [properties, setProperties] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [activeTab, setActiveTab] = useState("details");
  const [loadedRow, setLoadedRow] = useState(null);
  const [versionHistory, setVersionHistory] = useState([]);
  const [companyQuery, setCompanyQuery] = useState("");
  const [lastPaperFileName, setLastPaperFileName] = useState("");

  const [form, setForm] = useState({
    title: "Contract",
    status: "draft",
    version: 1,
    companyId: "",
    signingMethod: "esign",
    paperDocumentUrl: "",
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
    setCompanyQuery(row.company_name ?? "");
  }, []);

  useEffect(() => {
    if (!leadId || contractId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from("leads").select("id,company_name,email,phone,contact_person_name,contact_first_name,contact_last_name,contact_direct_phone").eq("id", leadId).maybeSingle();
      if (cancelled || !data) return;
      applyLeadProfile(data);
    })();
    return () => {
      cancelled = true;
    };
  }, [leadId, contractId, applyLeadProfile, supabase]);

  useEffect(() => {
    if (!contractId) {
      setLoadedRow(null);
      setVersionHistory([]);
      return;
    }
    let cancelled = false;
    supabase.from("contracts").select("*").eq("id", contractId).single().then(({ data }) => {
      if (cancelled || !data) return;
      setLoadedRow({ id: data.id, status: data.status ?? "draft", version: data.version ?? 1 });
      setForm({
        title: data.title ?? "Contract",
        status: data.status ?? "draft",
        version: data.version ?? 1,
        companyId: data.company_id ?? "",
        signingMethod: data.signing_method ?? "esign",
        paperDocumentUrl: data.paper_document_url ?? "",
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
      });
      setCompanyQuery(data.customer_company ?? "");
    });
    buildContractVersionChain(supabase, contractId).then((ch) => {
      if (!cancelled) setVersionHistory(ch);
    });
    return () => {
      cancelled = true;
    };
  }, [contractId, supabase]);

  useEffect(() => {
    supabase.from("properties").select("id,name,address,city").order("name").then(({ data }) => setProperties(data ?? []));
    supabase
      .from("contracts")
      .select("id,template_name,intro_text,terms_text,space_details,monthly_price,contract_length_months")
      .eq("is_template", true)
      .order("template_name")
      .then(({ data }) => setTemplates(data ?? []));
  }, [supabase]);

  const [companyOptions, setCompanyOptions] = useState([]);
  const [companyOpen, setCompanyOpen] = useState(false);

  useEffect(() => {
    const q = companyQuery.trim();
    if (q.length < 2) {
      setCompanyOptions([]);
      return;
    }
    const t = setTimeout(() => {
      supabase
        .from("leads")
        .select("id,company_name,email,phone,contact_person_name,contact_first_name,contact_last_name,contact_direct_phone")
        .or(`company_name.ilike.%${q}%,contact_person_name.ilike.%${q}%,email.ilike.%${q}%`)
        .limit(25)
        .then(({ data }) => setCompanyOptions(data ?? []));
    }, 280);
    return () => clearTimeout(t);
  }, [companyQuery, supabase]);

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

  async function onPaperFile(file) {
    if (!file) return;
    setLastPaperFileName(file.name);
    const path = `contract-paper/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const { error } = await supabase.storage.from("documents").upload(path, file, { upsert: true });
    if (error) {
      setSaveMsg({ type: "error", text: error.message || "Upload failed — add a public URL manually or configure the documents bucket." });
      return;
    }
    const { data: pub } = supabase.storage.from("documents").getPublicUrl(path);
    setForm((f) => ({ ...f, paperDocumentUrl: pub.publicUrl }));
  }

  async function save(newStatus) {
    setSaving(true);
    setSaveMsg(null);
    const effectiveStatus = newStatus ?? form.status;
    const payload = {
      title: form.title,
      status: effectiveStatus,
      lead_id: leadId,
      company_id: form.companyId || null,
      signing_method: form.signingMethod,
      paper_document_url: form.signingMethod === "paper" ? form.paperDocumentUrl || null : null,
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
      ...(effectiveStatus === "sent" ? { sent_at: new Date().toISOString() } : {}),
    };

    const rowStatus = loadedRow?.status ?? "draft";
    const shouldFork = Boolean(contractId) && !form.isTemplate && NON_DRAFT_CONTRACT_STATUSES.includes(rowStatus);

    let error;
    let resultId = contractId;

    if (shouldFork) {
      const nextVersion = (loadedRow?.version ?? form.version ?? 1) + 1;
      const { data: inserted, error: insErr } = await supabase
        .from("contracts")
        .insert({
          ...payload,
          version: nextVersion,
          parent_contract_id: contractId,
        })
        .select()
        .single();
      error = insErr;
      if (inserted) {
        resultId = inserted.id;
        setForm((f) => ({ ...f, version: nextVersion, status: effectiveStatus }));
        setLoadedRow({ id: inserted.id, status: effectiveStatus, version: nextVersion });
        buildContractVersionChain(supabase, inserted.id).then(setVersionHistory);
      }
    } else if (contractId) {
      ({ error } = await supabase.from("contracts").update(payload).eq("id", contractId));
    } else {
      const { data: inserted, error: insErr } = await supabase.from("contracts").insert(payload).select().single();
      error = insErr;
      if (inserted) {
        resultId = inserted.id;
        setLoadedRow({ id: inserted.id, status: effectiveStatus, version: inserted.version ?? 1 });
        setForm((f) => ({ ...f, version: inserted.version ?? 1 }));
        buildContractVersionChain(supabase, inserted.id).then(setVersionHistory);
      }
    }

    setSaving(false);
    if (error) {
      setSaveMsg({ type: "error", text: error.message });
      return { error };
    }
    setSaveMsg({ type: "ok", text: newStatus === "sent" ? "Contract marked as sent!" : shouldFork ? "Saved as new version." : "Saved." });
    onSaved?.({ newContractId: resultId !== contractId ? resultId : undefined });
    if (newStatus) setForm((f) => ({ ...f, status: newStatus }));
    return { error: null };
  }

  const selectedProperty = properties.find((p) => p.id === form.propertyId);

  const previewHtml = useMemo(() => {
    const rentCol = c.primary;
    return `
    <div style="font-family:Georgia,serif;max-width:680px;margin:0 auto;color:${c.text};line-height:1.7">
      <div style="border-bottom:3px solid ${c.primary};padding-bottom:16px;margin-bottom:24px">
        <div style="font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:${c.text};opacity:0.72">VillageWorks — Contract</div>
        <h1 style="margin:8px 0 4px;font-size:28px;font-weight:700;color:${c.text}">${form.title}</h1>
        <div style="font-size:13px;color:${c.text};opacity:0.72">Prepared for: <strong>${form.customerName || "—"}</strong>${form.customerCompany ? ` · ${form.customerCompany}` : ""}</div>
        <div style="font-size:12px;margin-top:6px;color:${c.text};opacity:0.65">Signing: ${form.signingMethod === "paper" ? "Paper" : "E-sign via link"}</div>
               </div>
      <p style="font-size:15px">${(form.introText || "").replace(/\n/g, "<br>")}</p>
      <table style="width:100%;border-collapse:collapse;margin:24px 0;font-size:14px">
        <tr style="background:${c.hover}"><td style="padding:10px 14px;font-weight:600">Space</td><td style="padding:10px 14px">${form.spaceDetails || "—"}</td></tr>
        <tr><td style="padding:10px 14px;font-weight:600">Location</td><td style="padding:10px 14px">${selectedProperty ? `${selectedProperty.name}, ${selectedProperty.address}, ${selectedProperty.city}` : "—"}</td></tr>
        <tr style="background:${c.hover}"><td style="padding:10px 14px;font-weight:600">Monthly rent</td><td style="padding:10px 14px;font-size:18px;font-weight:700;color:${rentCol}">${form.monthlyPrice ? `€${Number(form.monthlyPrice).toLocaleString("en-IE")} / month` : "—"}</td></tr>
        <tr><td style="padding:10px 14px;font-weight:600">Contract length</td><td style="padding:10px 14px">${form.contractLengthMonths ? `${form.contractLengthMonths} months` : "—"}</td></tr>
        <tr style="background:${c.hover}"><td style="padding:10px 14px;font-weight:600">Start</td><td style="padding:10px 14px">${form.startDate || "To be agreed"}</td></tr>
      </table>
      <h3 style="font-size:15px;border-bottom:1px solid ${c.border};padding-bottom:6px;color:${c.text}">Terms &amp; conditions</h3>
      <p style="font-size:13px;color:${c.text};opacity:0.85">${(form.termsText || "").replace(/\n/g, "<br>")}</p>
    </div>
  `;
  }, [form, selectedProperty]);

  const stepIndex = CONTRACT_STEPS.findIndex((s) => s.key === activeTab);
  const currentStep = stepIndex >= 0 ? stepIndex : 0;

  const verLabel = `v${form.version ?? 1}.0`;

  async function nextFromDetails() {
    const r = await save();
    if (!r?.error) {
      setActiveTab("content");
    }
  }

  const statusLocksDelete = ["signed_digital", "signed_paper", "active"].includes(form.status);

  async function deleteContract() {
    if (!loadedRow?.id || statusLocksDelete) return;
    const ok = await confirm({
      title: "Delete this contract?",
      message: "This cannot be undone.",
      confirmLabel: "Delete",
      confirmDanger: true,
    });
    if (!ok) return;
    const { error } = await supabase.from("contracts").delete().eq("id", loadedRow.id);
    if (error) {
      const msg = String(error.message || "");
      const text = msg.toLowerCase().includes("foreign key")
        ? "This contract cannot be deleted because it has linked records."
        : msg || "Failed to delete contract.";
      setSaveMsg({ type: "error", text });
      return;
    }
    onDeleted?.();
  }

  return (
    <div style={{ display: "grid", gap: 16, maxWidth: 860, margin: "0 auto" }}>
      <ConfirmModal />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <h1 className="vw-admin-page-title" style={{ margin: 0 }}>{form.title || "Contract editor"}</h1>
          <span style={{ fontSize: 13, fontWeight: 600, color: c.secondary }}>{verLabel}</span>
          <StatusBadge status={form.status} />
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
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
          {loadedRow?.id ? (
            <button
              type="button"
              onClick={() => void deleteContract()}
              disabled={statusLocksDelete}
              title={statusLocksDelete ? "Signed contracts can only be deleted by a Super Admin" : undefined}
              style={{
                padding: "8px 16px",
                borderRadius: 8,
                border: `1px solid ${c.danger}`,
                background: c.white,
                color: c.danger,
                fontWeight: 600,
                cursor: statusLocksDelete ? "not-allowed" : "pointer",
                fontSize: 13,
                opacity: statusLocksDelete ? 0.5 : 1,
              }}
            >
              Delete contract
            </button>
          ) : null}
          <button type="button" onClick={() => save()} disabled={saving} style={{ padding: "8px 16px", borderRadius: 8, border: `1px solid ${c.primary}`, background: c.white, color: c.primary, fontWeight: 600, cursor: "pointer", fontSize: 13 }}>
            {saving ? "Saving…" : "Save draft"}
          </button>
          <button type="button" onClick={() => save("sent")} disabled={saving} style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: c.primary, color: c.white, fontWeight: 600, cursor: "pointer", fontSize: 13 }}>
            Mark as sent
          </button>
        </div>
      </div>

      {saveMsg && (
        <div style={{ padding: "10px 14px", borderRadius: 8, fontSize: 13, fontWeight: 500, background: c.hover, color: saveMsg.type === "ok" ? c.success : c.danger, border: `1px solid ${c.border}` }}>
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
          {CONTRACT_STEPS.map((step, i) => {
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
                {i < CONTRACT_STEPS.length - 1 ? (
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
            <Field label="Search company">
              <div style={{ position: "relative" }}>
                <Input value={companyQuery} onChange={setCompanyQuery} placeholder="Type to search…" onFocus={() => setCompanyOpen(true)} onBlur={() => setTimeout(() => setCompanyOpen(false), 200)} />
                {companyOpen && companyOptions.length > 0 && (
                  <ul
                    style={{
                      position: "absolute",
                      zIndex: 10,
                      left: 0,
                      right: 0,
                      margin: 0,
                      padding: 0,
                      listStyle: "none",
                      background: c.white,
                      border: `1px solid ${c.border}`,
                      borderRadius: 8,
                      marginTop: 4,
                      maxHeight: 220,
                      overflow: "auto",
                      boxShadow: `0 8px 24px ${c.primary}14`,
                    }}
                  >
                    {companyOptions.map((row) => (
                      <li key={row.id}>
                        <button
                          type="button"
                          onClick={() => {
                            applyLeadProfile(row);
                            setCompanyOpen(false);
                          }}
                          style={{
                            width: "100%",
                            textAlign: "left",
                            padding: "10px 12px",
                            border: "none",
                            background: c.white,
                            cursor: "pointer",
                            fontSize: 13,
                            color: c.text,
                            borderBottom: `1px solid ${c.border}`,
                          }}
                        >
                          <strong>{row.company_name}</strong>
                          {row.email ? <span style={{ opacity: 0.75 }}> · {row.email}</span> : null}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </Field>
            {form.companyId ? (
              <p style={{ margin: 0, fontSize: 13, color: c.text, opacity: 0.75 }}>
                Selected lead ID: <code style={{ color: c.primary }}>{form.companyId}</code>
              </p>
            ) : null}
          </Section>

          <Section title="Signing">
            <Field label="Signing method">
              <div style={{ display: "flex", gap: 20, flexWrap: "wrap", color: c.text }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                  <input type="radio" name="signing_method" checked={form.signingMethod === "esign"} onChange={() => set("signingMethod")("esign")} />
                  E-sign via link
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                  <input type="radio" name="signing_method" checked={form.signingMethod === "paper"} onChange={() => set("signingMethod")("paper")} />
                  Paper — upload later
                </label>
              </div>
            </Field>
            {form.signingMethod === "paper" && (
              <>
                <Field label="Paper document" hint="Uploads to Supabase Storage bucket documents/ (configure bucket & public access as needed)">
                  <input
                    type="file"
                    accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/*"
                    style={{ fontSize: 13, color: c.text }}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void onPaperFile(f);
                    }}
                  />
                  {lastPaperFileName ? <span style={{ fontSize: 12, color: c.text, opacity: 0.7 }}>Last file: {lastPaperFileName}</span> : null}
                </Field>
                <Field label="Or paste document URL">
                  <Input value={form.paperDocumentUrl} onChange={set("paperDocumentUrl")} placeholder="https://…" type="url" />
                </Field>
              </>
            )}
          </Section>

          <Section title="Version history">
            {versionHistory.length === 0 ? (
              <p style={{ margin: 0, fontSize: 13, color: c.text, opacity: 0.65 }}>Save this contract to start a version history.</p>
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
                      background: row.id === contractId ? c.hover : c.background,
                      border: `1px solid ${c.border}`,
                      fontSize: 13,
                      color: c.text,
                    }}
                  >
                    <span style={{ fontWeight: 600 }}>
                      v{row.version ?? 1}.0 · {row.status}
                      {row.id === contractId ? <span style={{ marginLeft: 8, color: c.accent }}>(current)</span> : null}
                    </span>
                    <span style={{ opacity: 0.75 }}>{row.created_at ? new Date(row.created_at).toLocaleString("en-GB") : "—"}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Contact person">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <Field label="Full name">
                <Input value={form.customerName} onChange={set("customerName")} placeholder="Contact name" />
              </Field>
              <Field label="Email">
                <Input value={form.customerEmail} onChange={set("customerEmail")} type="email" placeholder="email@…" />
              </Field>
              <Field label="Phone">
                <Input value={form.customerPhone} onChange={set("customerPhone")} placeholder="+358 …" />
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
            <Field label="Space / room details">
              <Input value={form.spaceDetails} onChange={set("spaceDetails")} placeholder="Office 4B…" />
            </Field>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
              <Field label="Monthly rent (€)">
                <Input value={form.monthlyPrice} onChange={set("monthlyPrice")} type="number" placeholder="1200" />
              </Field>
              <Field label="Contract length (months)">
                <Input value={form.contractLengthMonths} onChange={set("contractLengthMonths")} type="number" placeholder="12" />
              </Field>
              <Field label="Start date">
                <Input value={form.startDate} onChange={set("startDate")} type="date" />
              </Field>
            </div>
          </Section>

          <Section title="Contract settings">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <Field label="Title">
                <Input value={form.title} onChange={set("title")} placeholder="Contract" />
              </Field>
              <Field label="Status">
                <select value={form.status} onChange={(e) => set("status")(e.target.value)} style={inputStyleBase}>
                  {["draft", "sent", "signed_digital", "signed_paper", "active"].map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="Internal notes">
              <Textarea value={form.notes} onChange={set("notes")} placeholder="Internal notes…" rows={3} />
            </Field>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <input type="checkbox" id="ct-template" checked={form.isTemplate} onChange={(e) => set("isTemplate")(e.target.checked)} />
              <label htmlFor="ct-template" style={{ fontSize: 14, cursor: "pointer", color: c.text }}>
                Save as reusable template
              </label>
            </div>
            {form.isTemplate && (
              <Field label="Template name">
                <Input value={form.templateName} onChange={set("templateName")} placeholder="Template name…" />
              </Field>
            )}
          </Section>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 24, paddingTop: 16, borderTop: `1px solid ${c.border}` }}>
            <div>{/* previous button or empty */}</div>
            <button
              type="button"
              onClick={() => void nextFromDetails()}
              style={{ padding: "10px 20px", borderRadius: 8, border: "none", background: c.primary, color: c.white, fontWeight: 600, cursor: "pointer", fontSize: 14 }}
            >
              {saving ? "Saving…" : "Next → Write content"}
            </button>
          </div>
        </>
      )}

      {activeTab === "content" && (
        <>
          <Section title="Introduction">
            <Field label="Opening" hint="Shown at the top of the contract">
              <Textarea value={form.introText} onChange={set("introText")} rows={8} />
            </Field>
          </Section>
          <Section title="Terms">
            <Field label="Terms" hint="Shown at the bottom of the contract">
              <Textarea value={form.termsText} onChange={set("termsText")} rows={10} />
            </Field>
          </Section>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 24, paddingTop: 16, borderTop: `1px solid ${c.border}` }}>
            <div>
              <button
                type="button"
                onClick={() => setActiveTab("details")}
                style={{ padding: "10px 20px", borderRadius: 8, border: `1px solid ${c.border}`, background: c.white, color: c.text, fontWeight: 600, cursor: "pointer", fontSize: 14 }}
              >
                ← Fill details
              </button>
            </div>
            <div>
              <button
                type="button"
                onClick={() => setActiveTab("preview")}
                style={{ padding: "10px 20px", borderRadius: 8, border: "none", background: c.primary, color: c.white, fontWeight: 600, cursor: "pointer", fontSize: 14 }}
              >
                Next → Preview & send
              </button>
            </div>
          </div>
        </>
      )}

      {activeTab === "preview" && (
        <div style={{ background: c.white, border: `1px solid ${c.border}`, borderRadius: 12, padding: 32 }}>
          <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
          <div style={{ marginTop: 24, paddingTop: 16, borderTop: `1px solid ${c.border}`, display: "flex", gap: 10 }}>
            <button type="button" onClick={() => window.open(`/api/contracts/${contractId ?? "preview"}/pdf`, "_blank")} style={{ padding: "9px 18px", borderRadius: 8, border: "none", background: c.primary, color: c.white, fontWeight: 600, cursor: "pointer", fontSize: 13 }}>
              Download PDF
            </button>
            {contractId ? (
              <button type="button" onClick={() => navigator.clipboard.writeText(`${window.location.origin}/contracts/${contractId}/view`)} style={{ padding: "9px 18px", borderRadius: 8, border: `1px solid ${c.primary}`, background: c.white, color: c.primary, fontWeight: 600, cursor: "pointer", fontSize: 13 }}>
                Copy link
              </button>
            ) : null}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 24, paddingTop: 16, borderTop: `1px solid ${c.border}` }}>
            <div>
              <button
                type="button"
                onClick={() => setActiveTab("content")}
                style={{ padding: "10px 20px", borderRadius: 8, border: `1px solid ${c.border}`, background: c.white, color: c.text, fontWeight: 600, cursor: "pointer", fontSize: 14 }}
              >
                ← Write content
              </button>
            </div>
            <div>{/* next button or empty */}</div>
          </div>
        </div>
      )}
    </div>
  );
}
