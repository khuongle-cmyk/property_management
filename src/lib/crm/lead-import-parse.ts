import { normalizeLeadCompanySize, normalizeLeadCompanyType } from "@/lib/crm/finnish-company";

/** Normalize CRM source to DB-allowed value. */
export function normalizeLeadSource(raw: string | undefined): string {
  const s = (raw ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  const allowed = new Set(["email", "website", "phone", "chatbot", "social_media", "referral", "other"]);
  if (allowed.has(s)) return s;
  if (s === "social" || s === "socialmedia") return "social_media";
  return "other";
}

export function normalizeSpaceType(raw: string | undefined): string | null {
  const s = (raw ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  const map: Record<string, string> = {
    office: "office",
    meeting_room: "meeting_room",
    meetingroom: "meeting_room",
    venue: "venue",
    hot_desk: "hot_desk",
    hotdesk: "hot_desk",
    desk: "hot_desk",
  };
  const v = map[s];
  return v ?? null;
}

export type ParsedImportRow = {
  rowNumber: number;
  company_name: string;
  contact_person_name: string;
  contact_first_name: string;
  contact_last_name: string;
  contact_title: string;
  contact_direct_phone: string | null;
  email: string;
  phone: string | null;
  source: string;
  business_id: string | null;
  vat_number: string | null;
  company_type: string | null;
  industry_sector: string | null;
  company_size: string | null;
  company_website: string | null;
  billing_street: string | null;
  billing_postal_code: string | null;
  billing_city: string | null;
  billing_email: string | null;
  e_invoice_address: string | null;
  e_invoice_operator_code: string | null;
  interested_property_raw: string;
  space_type: string | null;
  approx_size_m2: number | null;
  approx_budget_eur_month: number | null;
  preferred_move_in_date: string | null;
  notes: string | null;
};

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQ = !inQ;
      continue;
    }
    if (!inQ && c === ",") {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += c;
  }
  out.push(cur.trim());
  return out;
}

/** Map header string to canonical key. */
function normalizeHeader(h: string): string {
  return h
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[\uFEFF]/g, "");
}

const HEADER_ALIASES: Record<string, keyof Omit<ParsedImportRow, "rowNumber">> = {
  company_name: "company_name",
  contact_name: "contact_person_name",
  contact_person_name: "contact_person_name",
  contact_first_name: "contact_first_name",
  first_name: "contact_first_name",
  contact_last_name: "contact_last_name",
  last_name: "contact_last_name",
  contact_title: "contact_title",
  title: "contact_title",
  direct_phone: "contact_direct_phone",
  contact_direct_phone: "contact_direct_phone",
  email: "email",
  phone: "phone",
  source: "source",
  business_id: "business_id",
  y_tunnus: "business_id",
  vat_number: "vat_number",
  alv: "vat_number",
  company_type: "company_type",
  industry_sector: "industry_sector",
  industry: "industry_sector",
  company_size: "company_size",
  company_website: "company_website",
  website: "company_website",
  billing_street: "billing_street",
  billing_postal_code: "billing_postal_code",
  postal_code: "billing_postal_code",
  billing_city: "billing_city",
  billing_email: "billing_email",
  e_invoice_address: "e_invoice_address",
  verkkolaskuosoite: "e_invoice_address",
  e_invoice_operator_code: "e_invoice_operator_code",
  operator_code: "e_invoice_operator_code",
  interested_property: "interested_property_raw",
  property: "interested_property_raw",
  property_id: "interested_property_raw",
  space_type: "space_type",
  size_m2: "approx_size_m2",
  approx_size_m2: "approx_size_m2",
  budget_month: "approx_budget_eur_month",
  approx_budget_eur_month: "approx_budget_eur_month",
  move_in_date: "preferred_move_in_date",
  preferred_move_in_date: "preferred_move_in_date",
  notes: "notes",
};

export function parseLeadImportCsv(text: string): ParsedImportRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length);
  if (lines.length < 2) return [];

  const headerCells = parseCsvLine(lines[0]).map(normalizeHeader);
  const colIndex: Partial<Record<keyof Omit<ParsedImportRow, "rowNumber">, number>> = {};
  headerCells.forEach((h, i) => {
    const key = HEADER_ALIASES[h];
    if (key) colIndex[key] = i;
  });

  const rows: ParsedImportRow[] = [];
  for (let li = 1; li < lines.length; li++) {
    const cells = parseCsvLine(lines[li]);
    const get = (k: keyof Omit<ParsedImportRow, "rowNumber">) => {
      const idx = colIndex[k];
      if (idx === undefined) return "";
      return (cells[idx] ?? "").trim();
    };

    const company = get("company_name");
    let contact = get("contact_person_name");
    const cfirst = get("contact_first_name");
    const clast = get("contact_last_name");
    if (!contact) contact = `${cfirst} ${clast}`.trim();
    const email = get("email").toLowerCase();
    const sizeRaw = get("approx_size_m2");
    const budgetRaw = get("approx_budget_eur_month");
    const moveIn = get("preferred_move_in_date") || null;
    const vatRaw = get("vat_number");

    rows.push({
      rowNumber: li + 1,
      company_name: company,
      contact_person_name: contact,
      contact_first_name: cfirst,
      contact_last_name: clast,
      contact_title: get("contact_title"),
      contact_direct_phone: get("contact_direct_phone") || null,
      email,
      phone: get("phone") || null,
      source: normalizeLeadSource(get("source")),
      business_id: get("business_id") || null,
      vat_number: vatRaw ? vatRaw.toUpperCase() : null,
      company_type: normalizeLeadCompanyType(get("company_type") ?? undefined),
      industry_sector: get("industry_sector") || null,
      company_size: normalizeLeadCompanySize(get("company_size") ?? undefined),
      company_website: get("company_website") || null,
      billing_street: get("billing_street") || null,
      billing_postal_code: get("billing_postal_code") || null,
      billing_city: get("billing_city") || null,
      billing_email: get("billing_email").toLowerCase() || null,
      e_invoice_address: get("e_invoice_address") || null,
      e_invoice_operator_code: get("e_invoice_operator_code") || null,
      interested_property_raw: get("interested_property_raw"),
      space_type: normalizeSpaceType(get("space_type")),
      approx_size_m2: sizeRaw ? Number(sizeRaw) : null,
      approx_budget_eur_month: budgetRaw ? Number(budgetRaw) : null,
      preferred_move_in_date: moveIn && moveIn.length ? moveIn : null,
      notes: get("notes") || null,
    });
  }
  return rows;
}
