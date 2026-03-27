import { normalizeLeadCompanySize, normalizeLeadCompanyType } from "@/lib/crm/finnish-company";

export function strOrNull(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

const COMPANY_KEYS = [
  "business_id",
  "vat_number",
  "company_type",
  "industry_sector",
  "company_size",
  "company_website",
  "billing_street",
  "billing_postal_code",
  "billing_city",
  "billing_email",
  "e_invoice_address",
  "e_invoice_operator_code",
  "contact_first_name",
  "contact_last_name",
  "contact_title",
  "contact_direct_phone",
] as const;

/** Maps API/form JSON to DB columns for lead company & contact extension fields. */
export function leadCompanyFieldsFromBody(body: Record<string, unknown>): Record<string, unknown> {
  const ct = normalizeLeadCompanyType(strOrNull(body.company_type) ?? undefined);
  const cs = normalizeLeadCompanySize(strOrNull(body.company_size) ?? undefined);
  const vat = strOrNull(body.vat_number);
  return {
    business_id: strOrNull(body.business_id),
    vat_number: vat ? vat.toUpperCase() : null,
    company_type: ct,
    industry_sector: strOrNull(body.industry_sector),
    company_size: cs,
    company_website: strOrNull(body.company_website),
    billing_street: strOrNull(body.billing_street),
    billing_postal_code: strOrNull(body.billing_postal_code),
    billing_city: strOrNull(body.billing_city),
    billing_email: strOrNull(body.billing_email)?.toLowerCase() ?? null,
    e_invoice_address: strOrNull(body.e_invoice_address),
    e_invoice_operator_code: strOrNull(body.e_invoice_operator_code),
    contact_first_name: strOrNull(body.contact_first_name),
    contact_last_name: strOrNull(body.contact_last_name),
    contact_title: strOrNull(body.contact_title),
    contact_direct_phone: strOrNull(body.contact_direct_phone),
  };
}

/** For PATCH: only include company/contact keys that appear on `body`. */
export function leadCompanyPatchFromBody(body: Record<string, unknown>): Record<string, unknown> {
  const full = leadCompanyFieldsFromBody(body);
  const out: Record<string, unknown> = {};
  for (const k of COMPANY_KEYS) {
    if (body[k] !== undefined) out[k] = full[k];
  }
  return out;
}
