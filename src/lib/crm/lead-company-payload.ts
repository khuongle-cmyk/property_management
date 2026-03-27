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

function pick(body: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) {
    if (body[k] !== undefined) return body[k];
  }
  return undefined;
}

/** Maps API/form JSON to DB columns for lead company & contact extension fields. */
export function leadCompanyFieldsFromBody(body: Record<string, unknown>): Record<string, unknown> {
  const ct = normalizeLeadCompanyType(strOrNull(pick(body, "company_type")) ?? undefined);
  const cs = normalizeLeadCompanySize(strOrNull(pick(body, "company_size")) ?? undefined);
  const vat = strOrNull(pick(body, "vat_number"));
  return {
    business_id: strOrNull(pick(body, "business_id", "company_registration")),
    vat_number: vat ? vat.toUpperCase() : null,
    company_type: ct,
    industry_sector: strOrNull(pick(body, "industry_sector", "industry")),
    company_size: cs,
    company_website: strOrNull(pick(body, "company_website", "website")),
    billing_street: strOrNull(pick(body, "billing_street", "billing_address")),
    billing_postal_code: strOrNull(body.billing_postal_code),
    billing_city: strOrNull(body.billing_city),
    billing_email: strOrNull(body.billing_email)?.toLowerCase() ?? null,
    e_invoice_address: strOrNull(body.e_invoice_address),
    e_invoice_operator_code: strOrNull(pick(body, "e_invoice_operator_code", "e_invoice_operator")),
    contact_first_name: strOrNull(body.contact_first_name),
    contact_last_name: strOrNull(body.contact_last_name),
    contact_title: strOrNull(body.contact_title),
    contact_direct_phone: strOrNull(pick(body, "contact_direct_phone", "contact_phone_direct")),
  };
}

/** For PATCH: only include company/contact keys that appear on `body`. */
export function leadCompanyPatchFromBody(body: Record<string, unknown>): Record<string, unknown> {
  const full = leadCompanyFieldsFromBody(body);
  const out: Record<string, unknown> = {};
  for (const k of COMPANY_KEYS) {
    if (body[k] !== undefined) out[k] = full[k];
  }
  if (body.company_registration !== undefined) out.business_id = full.business_id;
  if (body.industry !== undefined) out.industry_sector = full.industry_sector;
  if (body.website !== undefined) out.company_website = full.company_website;
  if (body.billing_address !== undefined) out.billing_street = full.billing_street;
  if (body.e_invoice_operator !== undefined) out.e_invoice_operator_code = full.e_invoice_operator_code;
  if (body.contact_phone_direct !== undefined) out.contact_direct_phone = full.contact_direct_phone;
  return out;
}
