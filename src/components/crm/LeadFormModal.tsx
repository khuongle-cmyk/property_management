"use client";

import { useEffect, useMemo, useState } from "react";
import { LEAD_SOURCES } from "@/lib/crm";
import { COMPANY_SIZES, vatFiFormatWarning, ytunnusFormatWarning } from "@/lib/crm/finnish-company";

export type LeadFormProperty = { id: string; name: string | null; city: string | null };

const SPACE_TYPES: { value: string; label: string }[] = [
  { value: "", label: "—" },
  { value: "office", label: "Office" },
  { value: "meeting_room", label: "Meeting room" },
  { value: "venue", label: "Venue" },
  { value: "hot_desk", label: "Hot desk" },
];

const COMPANY_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "—" },
  { value: "oy", label: "Oy (osakeyhtiö)" },
  { value: "oyj", label: "Oyj (julkinen osakeyhtiö)" },
  { value: "ky", label: "Ky (kommandiittiyhtiö)" },
  { value: "ay", label: "Ay (avoin yhtiö / general partnership)" },
  { value: "toiminimi", label: "Toiminimi (sole trader)" },
  { value: "other", label: "Other" },
];

const COMPANY_SIZE_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "—" },
  ...COMPANY_SIZES.map((s) => ({ value: s, label: s === "200+" ? "200+ employees" : `${s} employees` })),
];

function splitLegacyContact(full: string): { first: string; last: string } {
  const t = full.trim();
  const i = t.indexOf(" ");
  if (i === -1) return { first: t, last: "" };
  return { first: t.slice(0, i), last: t.slice(i + 1).trim() };
}

export type LeadFormModalProps = {
  open: boolean;
  mode: "create" | "edit";
  leadId?: string;
  tenantId: string;
  properties: LeadFormProperty[];
  initial?: {
    company_name?: string;
    contact_person_name?: string;
    contact_first_name?: string | null;
    contact_last_name?: string | null;
    contact_title?: string | null;
    contact_direct_phone?: string | null;
    email?: string;
    phone?: string | null;
    source?: string;
    property_id?: string | null;
    interested_space_type?: string | null;
    approx_size_m2?: number | null;
    approx_budget_eur_month?: number | null;
    preferred_move_in_date?: string | null;
    notes?: string | null;
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
  };
  onClose: () => void;
  onSaved: () => void;
};

const overlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.45)",
  zIndex: 200,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
};

const box: React.CSSProperties = {
  background: "#fff",
  borderRadius: 12,
  padding: 20,
  maxWidth: 680,
  width: "100%",
  maxHeight: "90vh",
  overflow: "auto",
};

const sectionTitle: React.CSSProperties = { margin: "16px 0 8px", fontSize: 15, fontWeight: 700, color: "#0f172a" };

export function LeadFormModal({ open, mode, leadId, tenantId, properties, initial, onClose, onSaved }: LeadFormModalProps) {
  const [companyName, setCompanyName] = useState("");
  const [businessId, setBusinessId] = useState("");
  const [vatNumber, setVatNumber] = useState("");
  const [companyType, setCompanyType] = useState("");
  const [industrySector, setIndustrySector] = useState("");
  const [companySize, setCompanySize] = useState("");
  const [companyWebsite, setCompanyWebsite] = useState("");
  const [billingStreet, setBillingStreet] = useState("");
  const [billingPostal, setBillingPostal] = useState("");
  const [billingCity, setBillingCity] = useState("");
  const [billingEmail, setBillingEmail] = useState("");
  const [eInvoiceAddress, setEInvoiceAddress] = useState("");
  const [eInvoiceOperator, setEInvoiceOperator] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [contactTitle, setContactTitle] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [directPhone, setDirectPhone] = useState("");
  const [source, setSource] = useState<string>("other");
  const [propertyId, setPropertyId] = useState("");
  const [spaceType, setSpaceType] = useState("");
  const [sizeM2, setSizeM2] = useState("");
  const [budgetMonth, setBudgetMonth] = useState("");
  const [moveIn, setMoveIn] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const ytWarning = useMemo(() => ytunnusFormatWarning(businessId), [businessId]);
  const vatWarn = useMemo(() => vatFiFormatWarning(vatNumber), [vatNumber]);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setCompanyName(initial?.company_name ?? "");
    setBusinessId(initial?.business_id ?? "");
    setVatNumber(initial?.vat_number ?? "");
    setCompanyType(initial?.company_type ?? "");
    setIndustrySector(initial?.industry_sector ?? "");
    setCompanySize(initial?.company_size ?? "");
    setCompanyWebsite(initial?.company_website ?? "");
    setBillingStreet(initial?.billing_street ?? "");
    setBillingPostal(initial?.billing_postal_code ?? "");
    setBillingCity(initial?.billing_city ?? "");
    setBillingEmail(initial?.billing_email ?? "");
    setEInvoiceAddress(initial?.e_invoice_address ?? "");
    setEInvoiceOperator(initial?.e_invoice_operator_code ?? "");

    let fn = initial?.contact_first_name ?? "";
    let ln = initial?.contact_last_name ?? "";
    if (!fn && !ln && initial?.contact_person_name) {
      const sp = splitLegacyContact(initial.contact_person_name);
      fn = sp.first;
      ln = sp.last;
    }
    setFirstName(fn);
    setLastName(ln);
    setContactTitle(initial?.contact_title ?? "");
    setEmail(initial?.email ?? "");
    setPhone(initial?.phone ?? "");
    setDirectPhone(initial?.contact_direct_phone ?? "");
    setSource(initial?.source ?? "other");
    setPropertyId(initial?.property_id ?? "");
    setSpaceType(initial?.interested_space_type ?? "");
    setSizeM2(initial?.approx_size_m2 != null ? String(initial.approx_size_m2) : "");
    setBudgetMonth(initial?.approx_budget_eur_month != null ? String(initial.approx_budget_eur_month) : "");
    const mid = initial?.preferred_move_in_date;
    setMoveIn(mid ? mid.slice(0, 10) : "");
    setNotes(initial?.notes ?? "");
  }, [open, initial]);

  if (!open) return null;

  function buildPayload() {
    const sizeNum = sizeM2.trim() ? Number(sizeM2) : null;
    const budgetNum = budgetMonth.trim() ? Number(budgetMonth) : null;
    const contactPerson = `${firstName} ${lastName}`.trim();
    return {
      company_name: companyName.trim(),
      contact_person_name: contactPerson,
      contact_first_name: firstName.trim() || null,
      contact_last_name: lastName.trim() || null,
      contact_title: contactTitle.trim() || null,
      contact_direct_phone: directPhone.trim() || null,
      email: email.trim(),
      phone: phone.trim() || null,
      source,
      property_id: propertyId.trim() || null,
      interested_space_type: spaceType.trim() || null,
      approx_size_m2: sizeNum != null && Number.isFinite(sizeNum) ? sizeNum : null,
      approx_budget_eur_month: budgetNum != null && Number.isFinite(budgetNum) ? budgetNum : null,
      preferred_move_in_date: moveIn.trim() || null,
      notes: notes.trim() || null,
      business_id: businessId.trim() || null,
      vat_number: vatNumber.trim() || null,
      company_type: companyType.trim() || null,
      industry_sector: industrySector.trim() || null,
      company_size: companySize.trim() || null,
      company_website: companyWebsite.trim() || null,
      billing_street: billingStreet.trim() || null,
      billing_postal_code: billingPostal.trim() || null,
      billing_city: billingCity.trim() || null,
      billing_email: billingEmail.trim() || null,
      e_invoice_address: eInvoiceAddress.trim() || null,
      e_invoice_operator_code: eInvoiceOperator.trim() || null,
    };
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!companyName.trim() || !email.trim()) {
      setError("Company name and email are required.");
      return;
    }
    if (!firstName.trim() || !lastName.trim()) {
      setError("Contact first name and last name are required.");
      return;
    }
    setSaving(true);
    setError(null);
    const payload = buildPayload();
    if (mode === "create") {
      const res = await fetch("/api/crm/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId, ...payload }),
      });
      const j = (await res.json()) as { error?: string };
      setSaving(false);
      if (!res.ok) {
        setError(j.error ?? "Save failed");
        return;
      }
      onSaved();
      onClose();
      return;
    }
    if (!leadId) {
      setSaving(false);
      setError("Missing lead id");
      return;
    }
    const res = await fetch(`/api/crm/leads/${leadId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const j = (await res.json()) as { error?: string };
    setSaving(false);
    if (!res.ok) {
      setError(j.error ?? "Update failed");
      return;
    }
    onSaved();
    onClose();
  }

  const label: React.CSSProperties = { display: "grid", gap: 4 };

  return (
    <div style={overlay} role="presentation" onClick={onClose}>
      <div role="dialog" aria-modal style={box} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginTop: 0 }}>{mode === "create" ? "Add lead" : "Edit lead"}</h2>
        <p style={{ fontSize: 14, color: "#64748b", marginTop: 0 }}>
          {mode === "create"
            ? "Creates a lead in the New stage and assigns you as the agent."
            : "Updates this lead’s details. Y-tunnus and e-invoice fields support Finnish invoicing (Finvoice)."}
        </p>
        {error ? <p style={{ color: "#b91c1c" }}>{error}</p> : null}
        <form onSubmit={onSubmit} style={{ display: "grid", gap: 10 }}>
          <h3 style={{ ...sectionTitle, marginTop: 0 }}>Company details</h3>
          <label style={label}>
            Company name *
            <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} required style={{ padding: 8 }} />
          </label>
          <label style={label}>
            Business ID (Y-tunnus)
            <input
              value={businessId}
              onChange={(e) => setBusinessId(e.target.value)}
              placeholder="1234567-8"
              style={{ padding: 8 }}
              autoComplete="off"
            />
            {ytWarning ? <span style={{ fontSize: 13, color: "#b45309" }}>{ytWarning}</span> : null}
          </label>
          <label style={label}>
            VAT number (ALV-numero)
            <input
              value={vatNumber}
              onChange={(e) => setVatNumber(e.target.value)}
              placeholder="FI12345678"
              style={{ padding: 8 }}
            />
            {vatWarn ? <span style={{ fontSize: 13, color: "#b45309" }}>{vatWarn}</span> : null}
          </label>
          <label style={label}>
            Company type
            <select value={companyType} onChange={(e) => setCompanyType(e.target.value)} style={{ padding: 8 }}>
              {COMPANY_TYPE_OPTIONS.map((o) => (
                <option key={o.value || "empty"} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label style={label}>
            Industry / sector
            <input value={industrySector} onChange={(e) => setIndustrySector(e.target.value)} style={{ padding: 8 }} />
          </label>
          <label style={label}>
            Company size
            <select value={companySize} onChange={(e) => setCompanySize(e.target.value)} style={{ padding: 8 }}>
              {COMPANY_SIZE_OPTIONS.map((o) => (
                <option key={o.value || "empty"} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label style={label}>
            Website
            <input
              type="url"
              value={companyWebsite}
              onChange={(e) => setCompanyWebsite(e.target.value)}
              placeholder="https://"
              style={{ padding: 8 }}
            />
          </label>
          <h3 style={sectionTitle}>Billing address</h3>
          <label style={label}>
            Street
            <input value={billingStreet} onChange={(e) => setBillingStreet(e.target.value)} style={{ padding: 8 }} />
          </label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10 }}>
            <label style={label}>
              Postal code
              <input value={billingPostal} onChange={(e) => setBillingPostal(e.target.value)} style={{ padding: 8 }} />
            </label>
            <label style={label}>
              City
              <input value={billingCity} onChange={(e) => setBillingCity(e.target.value)} style={{ padding: 8 }} />
            </label>
          </div>
          <label style={label}>
            Billing email (if different from contact)
            <input type="email" value={billingEmail} onChange={(e) => setBillingEmail(e.target.value)} style={{ padding: 8 }} />
          </label>
          <h3 style={sectionTitle}>E-invoice (verkkolasku)</h3>
          <p style={{ margin: 0, fontSize: 13, color: "#64748b" }}>
            Finvoice routing address and operator / intermediary ID for Finnish B2B invoicing.
          </p>
          <label style={label}>
            E-invoice address (verkkolaskuosoite)
            <input value={eInvoiceAddress} onChange={(e) => setEInvoiceAddress(e.target.value)} style={{ padding: 8 }} />
          </label>
          <label style={label}>
            Operator code (operaattorin välittäjätunnus)
            <input value={eInvoiceOperator} onChange={(e) => setEInvoiceOperator(e.target.value)} style={{ padding: 8 }} />
          </label>

          <h3 style={sectionTitle}>Contact person</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <label style={label}>
              First name *
              <input value={firstName} onChange={(e) => setFirstName(e.target.value)} required style={{ padding: 8 }} />
            </label>
            <label style={label}>
              Last name *
              <input value={lastName} onChange={(e) => setLastName(e.target.value)} required style={{ padding: 8 }} />
            </label>
          </div>
          <label style={label}>
            Title / position
            <input value={contactTitle} onChange={(e) => setContactTitle(e.target.value)} style={{ padding: 8 }} />
          </label>
          <label style={label}>
            Email *
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required style={{ padding: 8 }} />
          </label>
          <label style={label}>
            Phone
            <input value={phone} onChange={(e) => setPhone(e.target.value)} style={{ padding: 8 }} />
          </label>
          <label style={label}>
            Direct phone
            <input value={directPhone} onChange={(e) => setDirectPhone(e.target.value)} style={{ padding: 8 }} />
          </label>

          <h3 style={sectionTitle}>Lead</h3>
          <label style={label}>
            Source
            <select value={source} onChange={(e) => setSource(e.target.value)} style={{ padding: 8 }}>
              {LEAD_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {s.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </label>
          <label style={label}>
            Interested property
            <select value={propertyId} onChange={(e) => setPropertyId(e.target.value)} style={{ padding: 8 }}>
              <option value="">—</option>
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {(p.name ?? "Property") + (p.city ? ` (${p.city})` : "")}
                </option>
              ))}
            </select>
          </label>
          <label style={label}>
            Space type
            <select value={spaceType} onChange={(e) => setSpaceType(e.target.value)} style={{ padding: 8 }}>
              {SPACE_TYPES.map((o) => (
                <option key={o.value || "empty"} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label style={label}>
            Size needed (m²)
            <input value={sizeM2} onChange={(e) => setSizeM2(e.target.value)} inputMode="decimal" style={{ padding: 8 }} />
          </label>
          <label style={label}>
            Budget (€ / month)
            <input value={budgetMonth} onChange={(e) => setBudgetMonth(e.target.value)} inputMode="decimal" style={{ padding: 8 }} />
          </label>
          <label style={label}>
            Preferred move-in date
            <input type="date" value={moveIn} onChange={(e) => setMoveIn(e.target.value)} style={{ padding: 8 }} />
          </label>
          <label style={label}>
            Notes
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} style={{ padding: 8 }} />
          </label>

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
            <button type="button" onClick={onClose} disabled={saving} style={{ padding: "8px 14px" }}>
              Cancel
            </button>
            <button type="submit" disabled={saving} style={{ padding: "8px 14px", fontWeight: 600 }}>
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
