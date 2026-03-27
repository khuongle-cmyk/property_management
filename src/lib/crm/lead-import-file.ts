import * as XLSX from "xlsx";
import {
  normalizeLeadCompanySize,
  normalizeLeadCompanyType,
} from "@/lib/crm/finnish-company";
import {
  normalizeLeadSource,
  normalizeSpaceType,
  parseLeadImportCsv,
  type ParsedImportRow,
} from "@/lib/crm/lead-import-parse";

function rowFromObject(obj: Record<string, unknown>, rowNumber: number): ParsedImportRow {
  const g = (keys: string[]) => {
    for (const k of keys) {
      const v = obj[k];
      if (v != null && String(v).trim() !== "") return String(v).trim();
    }
    return "";
  };
  const company = g(["company_name", "Company Name", "company"]);
  const cfirst = g(["contact_first_name", "Contact first name", "First name"]);
  const clast = g(["contact_last_name", "Contact last name", "Last name"]);
  let contact = g(["contact_name", "contact_person_name", "Contact Name", "Contact"]);
  if (!contact) contact = `${cfirst} ${clast}`.trim();
  const email = g(["email", "Email"]).toLowerCase();
  const sizeRaw = g(["size_m2", "approx_size_m2", "Size m2"]);
  const budgetRaw = g(["budget_month", "approx_budget_eur_month", "Budget month"]);
  const moveIn = g(["move_in_date", "preferred_move_in_date", "Move in date"]) || null;
  const vatRaw = g(["vat_number", "VAT number", "ALV"]);

  return {
    rowNumber,
    company_name: company,
    contact_person_name: contact,
    contact_first_name: cfirst,
    contact_last_name: clast,
    contact_title: g(["contact_title", "Title", "Position"]),
    contact_direct_phone: g(["contact_direct_phone", "direct_phone", "Direct phone"]) || null,
    email,
    phone: g(["phone", "Phone"]) || null,
    source: normalizeLeadSource(g(["source", "Source"]) || undefined),
    business_id: g(["business_id", "y_tunnus", "Y-tunnus"]) || null,
    vat_number: vatRaw ? vatRaw.toUpperCase() : null,
    company_type: normalizeLeadCompanyType(g(["company_type", "Company type"]) || undefined),
    industry_sector: g(["industry_sector", "Industry", "industry"]) || null,
    company_size: normalizeLeadCompanySize(g(["company_size", "Company size"]) || undefined),
    company_website: g(["company_website", "website", "Website"]) || null,
    billing_street: g(["billing_street", "Street", "street"]) || null,
    billing_postal_code: g(["billing_postal_code", "postal_code", "Postal code"]) || null,
    billing_city: g(["billing_city", "City"]) || null,
    billing_email: g(["billing_email", "Billing email"]).toLowerCase() || null,
    e_invoice_address: g(["e_invoice_address", "verkkolaskuosoite", "E-invoice address"]) || null,
    e_invoice_operator_code: g(["e_invoice_operator_code", "operator_code", "Operator code"]) || null,
    interested_property_raw: g(["interested_property", "property", "property_id", "Interested property"]),
    space_type: normalizeSpaceType(g(["space_type", "Space type"]) || undefined),
    approx_size_m2: sizeRaw ? Number(sizeRaw) : null,
    approx_budget_eur_month: budgetRaw ? Number(budgetRaw) : null,
    preferred_move_in_date: moveIn && moveIn.length ? moveIn : null,
    notes: g(["notes", "Notes"]) || null,
  };
}

export async function parseLeadImportFile(file: File): Promise<ParsedImportRow[]> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv")) {
    const text = await file.text();
    return parseLeadImportCsv(text);
  }
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return [];
  const sheet = wb.Sheets[sheetName];
  const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
  return json.map((row, i) => rowFromObject(row, i + 2));
}
