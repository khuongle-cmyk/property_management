/** Basic Y-tunnus display format: seven digits, hyphen, one decimal check digit (0–9). */
const Y_TUNNUS_DISPLAY = /^\d{7}-\d$/;

export const COMPANY_TYPES = ["oy", "oyj", "ky", "ay", "toiminimi", "other"] as const;
export type LeadCompanyType = (typeof COMPANY_TYPES)[number];

export const COMPANY_SIZES = ["1-10", "11-50", "51-200", "200+"] as const;
export type LeadCompanySize = (typeof COMPANY_SIZES)[number];

/** Warning message if value looks wrong; null if empty or OK. Saving is still allowed. */
export function ytunnusFormatWarning(raw: string | null | undefined): string | null {
  const t = (raw ?? "").trim();
  if (!t) return null;
  if (!Y_TUNNUS_DISPLAY.test(t)) {
    return "Y-tunnus should look like 1234567-8: seven digits, a hyphen, then one check digit. You can still save if this is intentional.";
  }
  return null;
}

/** Soft check for Finnish VAT (ALV) numbers used in B2B invoices. */
export function vatFiFormatWarning(raw: string | null | undefined): string | null {
  const t = (raw ?? "").trim();
  if (!t) return null;
  if (!/^FI\d{8}$/i.test(t)) {
    return "Finnish VAT numbers are usually FI followed by eight digits (e.g. FI12345678). You can still save if this is intentional.";
  }
  return null;
}

export function isValidLeadCompanyType(v: string | null | undefined): v is LeadCompanyType {
  return v != null && (COMPANY_TYPES as readonly string[]).includes(v);
}

export function isValidLeadCompanySize(v: string | null | undefined): v is LeadCompanySize {
  return v != null && (COMPANY_SIZES as readonly string[]).includes(v);
}

export function normalizeLeadCompanyType(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim().toLowerCase();
  if (!s) return null;
  return (COMPANY_TYPES as readonly string[]).includes(s) ? s : null;
}

export function normalizeLeadCompanySize(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  return (COMPANY_SIZES as readonly string[]).includes(s) ? s : null;
}

/** Single full name or "first last" for DB `contact_person_name`. */
export function resolveContactPersonName(parts: {
  contact_person_name?: string | null;
  contact_name?: string | null;
  contact_first_name?: string | null;
  contact_last_name?: string | null;
}): string {
  const single = (parts.contact_person_name ?? parts.contact_name ?? "").trim();
  if (single) return single;
  return `${(parts.contact_first_name ?? "").trim()} ${(parts.contact_last_name ?? "").trim()}`.trim();
}
